import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DevicePanel, JoinMesh } from "@/components/DevicePanel";
import { MissionControl } from "@/components/MissionControl";
import { Gateway, type MissionView } from "@/lib/api";
import {
  type Authenticator, DEVICE_ID_KEY, DEVICE_KEY, MeshClient, creationOptions, formatCode, requestOptions,
  toB64url, toBytes,
} from "@/lib/mesh";

const CONFIG = { url: "http://gw.test", token: "owner" };

class MemoryStorage {
  data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
}

const buf = (...bytes: number[]) => new Uint8Array(bytes).buffer;

class FakeAuthenticator implements Authenticator {
  requests: CredentialRequestOptions[] = [];
  async create(): Promise<Credential> {
    return {
      id: "cred", type: "public-key", rawId: buf(1, 2),
      response: { clientDataJSON: buf(3), attestationObject: buf(4) },
      getClientExtensionResults: () => ({}),
    } as unknown as Credential;
  }
  async get(options: CredentialRequestOptions): Promise<Credential> {
    this.requests.push(options);
    return {
      id: "cred", type: "public-key", rawId: buf(1, 2),
      response: { clientDataJSON: buf(5), authenticatorData: buf(6), signature: buf(7), userHandle: null },
      getClientExtensionResults: () => ({}),
    } as unknown as Credential;
  }
}

type Call = { url: string; init: RequestInit };

function fakeFetch(routes: Record<string, unknown>, calls: Call[]): typeof fetch {
  return (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const key = `${init.method ?? "GET"} ${url.replace("http://gw.test/mesh", "")}`;
    if (!(key in routes)) return new Response(JSON.stringify({ detail: `no route ${key}` }), { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  }) as typeof fetch;
}

test("base64url converts both ways, without padding", () => {
  const bytes = buf(251, 255, 0, 1);
  expect(toB64url(bytes)).toBe("-_8AAQ");
  expect(new Uint8Array(toBytes("-_8AAQ"))).toEqual(new Uint8Array(bytes));
  expect(toB64url(null)).toBeNull();
  expect(formatCode("123456")).toBe("123 456");
});

test("WebAuthn options get their challenge and ids as bytes", () => {
  const create = creationOptions({ challenge: "AQI", user: { id: "dV8x", name: "u_1" }, rp: { id: "localhost" } });
  const get = requestOptions({ challenge: "AQI", allowCredentials: [{ id: "AQI", type: "public-key" }] });

  expect(new Uint8Array(create.publicKey!.challenge as ArrayBuffer)).toEqual(new Uint8Array([1, 2]));
  expect(new TextDecoder().decode(create.publicKey!.user.id as ArrayBuffer)).toBe("u_1");
  expect(new Uint8Array(get.publicKey!.allowCredentials![0]!.id as ArrayBuffer)).toEqual(new Uint8Array([1, 2]));
});

test("an answer is signed on this device and sent with its token", async () => {
  const storage = new MemoryStorage();
  storage.setItem(DEVICE_KEY, "device-token");
  const calls: Call[] = [];
  const authenticator = new FakeAuthenticator();
  const mesh = new MeshClient(CONFIG, storage, authenticator, fakeFetch({
    "POST /approvals/r1/options": { challenge_id: "ch1", options: { challenge: "AQI", allowCredentials: [] } },
    "POST /approvals/r1": { id: "m_1", state: "waiting" },
  }, calls));

  const view = await mesh.answer("r1", true);

  expect(view.state).toBe("waiting");
  expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ approved: true, limits: { auto_accept_max_gbp: "50" } });
  const signed = JSON.parse(calls[1]!.init.body as string);
  expect(signed.challenge_id).toBe("ch1");
  expect(signed.credential.response).toEqual({ clientDataJSON: "BQ", authenticatorData: "Bg", signature: "Bw", userHandle: null });
  expect((calls[1]!.init.headers as Record<string, string>)["X-Tempo-Device"]).toBe("device-token");
});

test("joining from a QR link stores this device's token and shows the code", async () => {
  const storage = new MemoryStorage();
  const calls: Call[] = [];
  const mesh = new MeshClient(CONFIG, storage, new FakeAuthenticator(), fakeFetch({
    "POST /pairings/p1/claim": { device: { id: "d_2" }, token: "new-token", code: "042917" },
  }, calls));

  render(<JoinMesh mesh={mesh} link="http://localhost:3000/#pair=p1.s3cret" />);
  await userEvent.click(screen.getByRole("button", { name: "Join" }));

  expect(await screen.findByText("042 917")).toBeInTheDocument();
  expect(JSON.parse(calls[0]!.init.body as string).secret).toBe("s3cret");
  expect(storage.getItem(DEVICE_KEY)).toBe("new-token");
  expect(storage.getItem(DEVICE_ID_KEY)).toBe("d_2");
});

test("adding a device shows the QR code, then the matching code to confirm", async () => {
  const storage = new MemoryStorage();
  storage.setItem(DEVICE_KEY, "phone-token");
  storage.setItem(DEVICE_ID_KEY, "d_1");
  const calls: Call[] = [];
  const phone = { id: "d_1", name: "iPhone", capabilities: [], active: true, passkey: true, push: true, last_active: "" };
  const mesh = new MeshClient(CONFIG, storage, new FakeAuthenticator(), fakeFetch({
    "GET /devices": [phone],
    "POST /pairings": { pairing_id: "p1", link: "http://localhost:3000/#pair=p1.s", qr_svg: "<svg></svg>", expires_at: "" },
    "GET /pairings/p1": { claimed: true, code: "042917", device_name: "Laptop" },
    "POST /pairings/p1/confirm": { ...phone, id: "d_2", name: "Laptop" },
  }, calls));

  render(<DevicePanel mesh={mesh} userId="u_margaret" pollMs={10} />);
  await userEvent.click(await screen.findByRole("button", { name: "Add another device" }));
  expect(await screen.findByRole("img", { name: "Pairing QR code" })).toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "Yes, the codes match" }));

  expect(screen.getByRole("status")).toHaveTextContent("Device added.");
  expect(screen.getByText("iPhone", { exact: true })).toBeInTheDocument();
  expect(screen.getByText(/\(this one\)/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add Face ID or fingerprint" })).not.toBeInTheDocument();
  expect(calls.some((c) => c.url.endsWith("/pairings/p1/confirm"))).toBe(true);
});

test("with a passkey on this device, Mission Control answers through it", async () => {
  globalThis.WebSocket = class { close() {} } as unknown as typeof WebSocket;
  const storage = new MemoryStorage();
  storage.setItem(DEVICE_KEY, "phone-token");
  storage.setItem(DEVICE_ID_KEY, "d_1");
  const waiting: MissionView = {
    id: "m_1", user_id: "u_margaret", state: "awaiting_consent", message: "Shall I claim £14.20 for you?",
    ask: { request_id: "r1", summary: "Shall I claim £14.20 for you?", amount_gbp: "14.20", proof_trace: null },
    outcome: null, timeline: [], trace_url: null, court: null,
  };
  const authenticator = new FakeAuthenticator();
  const mesh = new MeshClient(CONFIG, storage, authenticator, fakeFetch({
    "GET /devices": [{ id: "d_1", name: "iPhone", capabilities: [], active: true, passkey: true, push: false, last_active: "" }],
    "POST /approvals/r1/options": { challenge_id: "ch1", options: { challenge: "AQI" } },
    "POST /approvals/r1": { ...waiting, state: "waiting", ask: null },
  }, []));
  const gateway = new Gateway(CONFIG);
  gateway.health = async () => ({ status: "ok", mode: "replay", demo: false, simulated: [] });
  gateway.missions = async () => [waiting];
  gateway.ledger = async () => ({ minutes_returned: "0", hours_returned: "0", gbp_recovered: "0" });
  gateway.memories = async () => ({ memories: {}, timeline: [] });
  gateway.privacy = async () => { throw new Error("not in this test"); };
  gateway.answer = async () => { throw new Error("must not use the unsigned path"); };

  render(<MissionControl gateway={gateway} mesh={mesh} />);
  expect(await screen.findByText(/You'll confirm with Face ID/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Yes, claim £14.20" }));

  await waitFor(() => expect(authenticator.requests).toHaveLength(1));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
