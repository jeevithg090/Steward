import { CONFIG, FakeAuthenticator, fakeFetch, fakeMesh, MemoryStorage, type Call } from "@/features/devices/fakes";
import { DEVICE_ID_KEY, DEVICE_KEY, MANDATE_KEY_PREFIX, MeshClient, creationOptions, formatCode, meshWords, requestOptions, toB64url, toBytes } from "./mesh";

const buf = (...bytes: number[]) => new Uint8Array(bytes).buffer;

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
  const calls: Call[] = [];
  const { mesh } = fakeMesh(
    {
      "POST /mesh/approvals/r1/options": { challenge_id: "ch1", options: { challenge: "AQI", allowCredentials: [] } },
      "POST /mesh/approvals/r1": { id: "m_1", state: "waiting" },
    },
    { calls },
  );
  const view = await mesh.answer("r1", true);
  expect(view.state).toBe("waiting");
  expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ approved: true, limits: { auto_accept_max_gbp: "50" } });
  const signed = JSON.parse(calls[1]!.init.body as string);
  expect(signed.challenge_id).toBe("ch1");
  expect(signed.credential.response).toEqual({ clientDataJSON: "BQ", authenticatorData: "Bg", signature: "Bw", userHandle: null });
  expect((calls[1]!.init.headers as Record<string, string>)["X-Tempo-Device"]).toBe("token-d_1");
});

test("joining from a QR link stores this device's token", async () => {
  const storage = new MemoryStorage();
  const calls: Call[] = [];
  const mesh = new MeshClient(CONFIG, storage, new FakeAuthenticator(), fakeFetch({ "POST /mesh/pairings/p1/claim": { device: { id: "d_2" }, token: "new-token", code: "042917" } }, calls));
  expect(await mesh.claim("http://localhost:3000/#pair=p1.s3cret", "Laptop")).toBe("042917");
  expect(JSON.parse(calls[0]!.init.body as string).secret).toBe("s3cret");
  expect(storage.getItem(DEVICE_KEY)).toBe("new-token");
  expect(storage.getItem(DEVICE_ID_KEY)).toBe("d_2");
  await expect(mesh.claim("http://localhost:3000/#/devices", "Laptop")).rejects.toThrow("That isn't a Tempo pairing link.");
});

test("a signed mandate is kept on this device; otherwise it is fetched for one of her devices", async () => {
  const envelope = { mandate: { mandate_id: "md_1", counterparty: "GWR" }, signature: { kind: "webauthn" } };
  const { mesh, storage } = fakeMesh({
    "POST /mesh/mandates/options": { challenge_id: "ch1", options: { challenge: "AQI" } },
    "POST /mesh/mandates": envelope,
    "GET /mesh/mandates/md_2": { ...envelope, mandate: { mandate_id: "md_2" } },
  });
  expect(await mesh.signMandate("m_1")).toEqual(envelope);
  expect(JSON.parse(storage.getItem(`${MANDATE_KEY_PREFIX}md_1`)!)).toEqual(envelope);
  expect(await mesh.envelope("md_1")).toEqual(envelope);
  expect((await mesh.envelope("md_2"))?.mandate.mandate_id).toBe("md_2");

  const { mesh: stranger } = fakeMesh({}, { id: null });
  expect(await stranger.envelope("md_9")).toBeNull();
});

test("turning notifications off tells the Gateway to forget the subscription", async () => {
  const calls: Call[] = [];
  const { mesh } = fakeMesh({ "PUT /mesh/devices/me/push": { push: false }, "GET /mesh/config": { rp_id: "localhost", vapid_public_key: null } }, { calls });
  await mesh.disablePush();
  expect(calls[0]!.init.body).toBe("{}");
  expect(await mesh.meshConfig()).toEqual({ rp_id: "localhost", vapid_public_key: null });
});

test("Mesh and WebAuthn failures come out as plain sentences", () => {
  expect(meshWords(new DOMException("timed out", "NotAllowedError"))).toMatch(/cancelled or timed out/);
  expect(meshWords(new TypeError("Failed to fetch"))).toMatch(/can't reach Tempo's Gateway/);
  expect(meshWords(new Error("that pairing link expired; make a new one"))).toBe("That pairing link expired; make a new one.");
  expect(meshWords(new Error("POST /mesh/pairings: HTTP 502"))).toMatch(/hit a problem/);
});
