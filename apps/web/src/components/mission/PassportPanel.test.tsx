import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { toast, Toaster } from "@/components/ui";
import { CONFIG, type Call, device, fakeMesh } from "@/features/devices/fakes";
import type { MandateView } from "@/lib/api";
import { MANDATE_KEY_PREFIX, type MeshClient } from "@/lib/mesh";
import { MeshProvider } from "@/lib/mesh-context";
import type { Envelope } from "@/lib/passport";
import { expectNoA11yViolations } from "@/test/a11y";
import { PassportPanel } from "./PassportPanel";

// The signed mandate the Python tests make (fixtures/passport): a real Face ID (ES256) signature.
const FIXTURE = resolve(__dirname, "../../../../../fixtures/passport/signed_mandate.json");
const envelope = (): Envelope => JSON.parse(readFileSync(FIXTURE, "utf-8")) as Envelope;

const MANDATE: MandateView = {
  id: "md_7f3a9c2e1b44",
  status: "active",
  counterparty: "Broadbandly",
  may: ["claim", "call", "accept_cash"],
  may_not: ["accept_voucher", "discuss_other_accounts", "change_contract", "share_personal_data"],
  max_gbp: "32.31",
  expires_at: "2026-10-26T08:00:00Z",
  account_ref: "****4417",
  assurance: "device-biometric",
  digest: "0052b34e13d52e1c60676125af0e1f43e9d7dc4649fc7dc343a129176fd84e58",
};

const MISSION = { id: "m_ofcom_demo", state: "waiting" as const };

function verdict(call: Call): [number, unknown] {
  const body = JSON.parse(call.init.body as string) as { action: string };
  return body.action === "claim"
    ? [200, { ok: true, reason: "ok", message: "This mandate is signed, still valid and covers this.", assurance: "device-biometric", checked_at: "", latency_ms: 0.42 }]
    : [200, { ok: false, reason: "action_not_allowed", message: "This mandate does not cover other accounts.", assurance: "device-biometric", checked_at: "", latency_ms: 0.11 }];
}

function inMesh(mesh: MeshClient, children: ReactNode) {
  return (
    <MeshProvider config={CONFIG} showcase={false} client={mesh} canPasskey>
      <main>{children}</main>
      <Toaster />
    </MeshProvider>
  );
}

beforeEach(() => {
  toast.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-25T12:00:00Z")); // inside the fixture's window
});

afterEach(() => vi.useRealTimers());

test("the card says who it's for, what Tempo may and may not do, how it was signed, and the browser checks the signature", async () => {
  const { mesh, storage } = fakeMesh({ "GET /mesh/devices": [device({ passkey: true })] });
  storage.setItem(`${MANDATE_KEY_PREFIX}${MANDATE.id}`, JSON.stringify(envelope()));
  const { container } = render(inMesh(mesh, <PassportPanel mandate={MANDATE} mission={MISSION} />));

  expect(screen.getByText("For Broadbandly, account ****4417")).toBeInTheDocument();
  expect(screen.getByText("active")).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Tempo may" })).getByText("Claim this money for you")).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Tempo may not" })).getByText("Talk about your other accounts, like your mobile contract")).toBeInTheDocument();
  expect(screen.getByText(/up to £32.31/)).toBeInTheDocument();
  expect(screen.getByText("0052b34e13d5")).toBeInTheDocument();
  expect(await screen.findByText("Signed with Face ID on Margaret")).toBeInTheDocument();
  expect(await screen.findByText("Signature checked in your browser: ok")).toBeInTheDocument();
  expect(screen.getByText("No company has checked it yet.")).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("Let the company check it: a claim is allowed, her mobile contract is refused, each with its reason and latency", async () => {
  const calls: Call[] = [];
  const { mesh, storage } = fakeMesh({ "GET /mesh/devices": [device({ passkey: true })], "POST /mandates/verify": verdict }, { calls });
  storage.setItem(`${MANDATE_KEY_PREFIX}${MANDATE.id}`, JSON.stringify(envelope()));
  const { container } = render(inMesh(mesh, <PassportPanel mandate={MANDATE} mission={MISSION} />));

  const claim = await screen.findByRole("button", { name: "Check: claim £32.31" });
  await waitFor(() => expect(claim).toBeEnabled());
  await userEvent.click(claim);
  await userEvent.click(screen.getByRole("button", { name: "Check: discuss her mobile contract" }));

  const results = await screen.findByRole("list", { name: "Check results" });
  await waitFor(() => expect(within(results).getAllByRole("listitem")).toHaveLength(2));
  expect(within(results).getByText(/This mandate is signed, still valid and covers this/).closest("li")).toHaveTextContent("Allowed: claim £32.31.");
  expect(within(results).getByText(/0.42 ms/)).toBeInTheDocument();
  const refused = within(results).getByText(/This mandate does not cover other accounts/).closest("li")!;
  expect(refused).toHaveTextContent("Refused: discuss her mobile contract.");
  expect(refused).toHaveTextContent("action not allowed · 0.11 ms");

  const asked = calls.filter((c) => c.url === "http://gw.test/mandates/verify").map((c) => JSON.parse(c.init.body as string));
  expect(asked).toEqual([
    { envelope: envelope(), counterparty: "Broadbandly", action: "claim", amount_gbp: "32.31" },
    { envelope: envelope(), counterparty: "Broadbandly", action: "discuss_other_accounts", amount_gbp: null },
  ]);
  expect(calls.find((c) => c.url.endsWith("/mandates/verify"))!.init.headers).not.toHaveProperty("Authorization");
  await expectNoA11yViolations(container);
});

test("after a reload the envelope comes back from the Gateway for one of her devices", async () => {
  const { mesh, storage } = fakeMesh({ "GET /mesh/devices": [device({ passkey: true })], [`GET /mesh/mandates/${MANDATE.id}`]: envelope() });
  render(inMesh(mesh, <PassportPanel mandate={MANDATE} mission={MISSION} />));

  await waitFor(() => expect(screen.getByRole("button", { name: "Check: claim £32.31" })).toBeEnabled());
  expect(storage.getItem(`${MANDATE_KEY_PREFIX}${MANDATE.id}`)).not.toBeNull();
});

test("without the envelope the check buttons are off and say why", async () => {
  const { mesh } = fakeMesh({ "GET /mesh/devices": [] }, { id: null });
  render(inMesh(mesh, <PassportPanel mandate={MANDATE} mission={MISSION} />));

  expect(await screen.findByText(/This browser doesn't hold the signed mandate/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check: claim £32.31" })).toBeDisabled();
});

test("what the company checked, live, with reasons and latency", () => {
  const events = [
    { type: "mandate_refused", mission_id: "m_ofcom_demo", action: "discuss_other_accounts", reason: "action_not_allowed", latency_ms: 0.08, counterparty: "Broadbandly" },
    { type: "mandate_verified", mission_id: "m_ofcom_demo", action: "claim", reason: "ok", latency_ms: 0.07, counterparty: "Broadbandly" },
  ];
  const { mesh } = fakeMesh({ "GET /mesh/devices": [] }, { id: null });
  render(inMesh(mesh, <PassportPanel mandate={MANDATE} mission={MISSION} events={events} />));

  const list = screen.getByRole("list", { name: "What the company checked" });
  expect(within(list).getByText("Refused: other accounts, for Broadbandly (the mandate doesn't allow that) · 0.08 ms")).toBeInTheDocument();
  expect(within(list).getByText("Allowed: claim, for Broadbandly · 0.07 ms")).toBeInTheDocument();
});

test("revoking asks once more, then calls back with the id", async () => {
  const onRevoke = vi.fn();
  const { mesh } = fakeMesh({ "GET /mesh/devices": [] }, { id: null });
  render(inMesh(mesh, <PassportPanel mandate={MANDATE} mission={MISSION} onRevoke={onRevoke} />));

  await userEvent.click(screen.getByRole("button", { name: "Revoke this mandate" }));
  await userEvent.click(screen.getByRole("button", { name: "Yes, revoke it" }));
  expect(onRevoke).toHaveBeenCalledWith(MANDATE.id);
});

test("with Face ID on this device and a yes given, it signs a mandate and shows it at once", async () => {
  const calls: Call[] = [];
  const onChanged = vi.fn();
  const { mesh, authenticator, storage } = fakeMesh(
    {
      "GET /mesh/devices": [device({ passkey: true })],
      "POST /mesh/mandates/options": { challenge_id: "ch1", options: { challenge: "AQI", allowCredentials: [] } },
      "POST /mesh/mandates": envelope(),
    },
    { calls },
  );
  const { container } = render(inMesh(mesh, <PassportPanel mandate={null} mission={MISSION} onChanged={onChanged} />));

  const sign = await screen.findByRole("button", { name: "Sign a mandate with Face ID" });
  await expectNoA11yViolations(container);
  await userEvent.click(sign);

  expect(await screen.findByText("For Broadbandly, account ****4417")).toBeInTheDocument();
  expect(screen.getByText("Mandate signed with Face ID. A company can check it now.")).toBeInTheDocument();
  expect(authenticator.requests).toHaveLength(1);
  expect(JSON.parse(calls.find((c) => c.url.endsWith("/mesh/mandates/options"))!.init.body as string)).toEqual({ mission_id: "m_ofcom_demo" });
  expect(onChanged).toHaveBeenCalled();
  expect(storage.getItem(`${MANDATE_KEY_PREFIX}${MANDATE.id}`)).not.toBeNull();
  expect(screen.getByText("0052b34e13d5")).toBeInTheDocument(); // the same digest Python computes
});

test("without Face ID here, it points to Devices; before a yes, it waits", async () => {
  const { mesh } = fakeMesh({ "GET /mesh/devices": [device({ passkey: false })] });
  const { rerender, container } = render(inMesh(mesh, <PassportPanel mandate={null} mission={MISSION} />));

  expect(await screen.findByText("Signing a mandate needs Face ID on this device.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Set up Face ID on Devices" })).toHaveAttribute("href", "#/devices");
  await expectNoA11yViolations(container);

  rerender(inMesh(mesh, <PassportPanel mandate={null} mission={{ id: "m_1", state: "awaiting_consent" }} />));
  expect(screen.getByText(/Answer Tempo's question first/)).toBeInTheDocument();
});

test("in the showcase it says honestly that nothing can be signed", async () => {
  const { container } = render(
    <main>
      <PassportPanel mandate={null} mission={MISSION} />
    </main>,
  );
  expect(screen.getByText(/In the showcase there's no Gateway, so nothing can be signed/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Sign a mandate/ })).not.toBeInTheDocument();
  await expectNoA11yViolations(container);
});
