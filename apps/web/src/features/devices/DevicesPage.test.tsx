import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { toast, Toaster } from "@/components/ui";
import { Gateway } from "@/lib/api";
import { DEVICE_ID_KEY, DEVICE_KEY, type MeshClient } from "@/lib/mesh";
import { MeshProvider } from "@/lib/mesh-context";
import { ShowcaseGateway } from "@/lib/showcase";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import DevicesPage from "./DevicesPage";
import { CONFIG, device, fakeMesh } from "./fakes";

function props(params: Record<string, string> = {}, showcase = false): PageProps {
  return {
    gateway: showcase ? new ShowcaseGateway() : new Gateway(CONFIG),
    user: { id: "u_margaret", name: "Margaret", profileId: null },
    showcase,
    health: null,
    events: [],
    language: "en",
    params,
    speak: vi.fn(),
    setProfile: () => undefined,
  };
}

function inMesh(mesh: MeshClient, children: ReactNode, canPasskey = true) {
  return (
    <MeshProvider config={CONFIG} showcase={false} client={mesh} canPasskey={canPasskey}>
      <main>{children}</main>
      <Toaster />
    </MeshProvider>
  );
}

const QR = '<svg width="164" height="164" class="segno"><path d="M2 2.5h7"/></svg>';

beforeEach(() => {
  toast.clear();
  window.location.hash = "#/devices";
});

test("a browser that isn't a device offers to become one, then to add Face ID", async () => {
  let me = device({ name: "Chrome on Mac" });
  const { mesh, storage, calls, authenticator } = fakeMesh(
    {
      "POST /mesh/devices": () => [201, { device: me, token: "fresh-token" }],
      "GET /mesh/devices": () => [200, [me]],
      "POST /mesh/devices/me/passkey/options": { challenge_id: "c1", options: { challenge: "AQI", user: { id: "dV8x", name: "u_margaret" }, rp: { id: "localhost" } } },
      "POST /mesh/devices/me/passkey": () => {
        me = { ...me, passkey: true };
        return [200, me];
      },
      "GET /mesh/config": { rp_id: "localhost", vapid_public_key: null },
    },
    { id: null },
  );
  const { container } = render(inMesh(mesh, <DevicesPage {...props()} />));

  expect(screen.getByRole("heading", { level: 1, name: "Devices" })).toBeInTheDocument();
  const use = await screen.findByRole("button", { name: "Use this browser for approvals" });
  await expectNoA11yViolations(container);

  await userEvent.click(use);
  const register = calls.find((c) => c.url.endsWith("/mesh/devices") && c.init.method === "POST")!;
  expect(JSON.parse(register.init.body as string)).toMatchObject({ user_id: "u_margaret" });
  expect((register.init.headers as Record<string, string>).Authorization).toBe("Bearer owner");
  expect(storage.getItem(DEVICE_KEY)).toBe("fresh-token");
  expect(storage.getItem(DEVICE_ID_KEY)).toBe("d_1");
  expect(await screen.findByText(/This browser is now one of your devices/)).toBeInTheDocument();

  await userEvent.click(await screen.findByRole("button", { name: "Add Face ID or fingerprint" }));
  expect(authenticator.created).toBe(1);
  expect(await screen.findByText("Face ID on")).toBeInTheDocument();
  expect(screen.getByText("Face ID is on for approvals.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add Face ID or fingerprint" })).not.toBeInTheDocument();
});

test("on a page that isn't secure, Add Face ID is off and says why", async () => {
  const { mesh } = fakeMesh({ "GET /mesh/devices": [device()], "GET /mesh/config": { rp_id: "localhost", vapid_public_key: null } });
  render(inMesh(mesh, <DevicesPage {...props()} />, false));

  expect(await screen.findByRole("button", { name: "Add Face ID or fingerprint" })).toBeDisabled();
  expect(screen.getByText(/needs Tempo on localhost or over https/)).toBeInTheDocument();
});

test("the device list, a pairing QR code, then the code both screens show; confirm adds it", async () => {
  const phone = device({ passkey: true });
  let list = [phone];
  const { mesh, calls } = fakeMesh({
    "GET /mesh/devices": () => [200, list],
    "GET /mesh/config": { rp_id: "localhost", vapid_public_key: null },
    "POST /mesh/pairings": { pairing_id: "p1", link: "http://localhost:3000/#pair=p1.s3cret", qr_svg: QR, expires_at: new Date(Date.now() + 120_000).toISOString() },
    "GET /mesh/pairings/p1": { claimed: true, code: "042917", device_name: "Chrome on Mac" },
    "POST /mesh/pairings/p1/confirm": () => {
      list = [phone, device({ id: "d_2", name: "Chrome on Mac" })];
      return [200, list[1]];
    },
  });
  const { container } = render(inMesh(mesh, <DevicesPage {...props()} pollMs={10} />));

  const devices = await screen.findByRole("list", { name: "Your devices" });
  expect(within(devices).getByText("Safari on iPhone")).toBeInTheDocument();
  expect(within(devices).getByText("this one")).toBeInTheDocument();
  expect(within(devices).getByText("Face ID or fingerprint")).toBeInTheDocument();
  expect(screen.getByText("Face ID on")).toBeInTheDocument();
  await expectNoA11yViolations(container);

  await userEvent.click(screen.getByRole("button", { name: "Add another device" }));
  const qr = await screen.findByRole("img", { name: /QR code for adding your other device/ });
  expect(qr.innerHTML).toContain('viewBox="0 0 164 164"');
  expect(screen.getByTestId("pairing-link")).toHaveTextContent("http://localhost:3000/#pair=p1.s3cret");
  expect(screen.getByText(/Works for \d:\d\d more/)).toBeInTheDocument();

  expect(await screen.findByText("Pairing code: 0 4 2 9 1 7")).toBeInTheDocument();
  expect(screen.getByText("042 917")).toBeInTheDocument();
  expect(screen.getByText(/Do both screens show the same code/)).toBeInTheDocument();
  await expectNoA11yViolations(container);
  await userEvent.click(screen.getByRole("button", { name: "Yes, the codes match" }));

  expect(await screen.findByText("Chrome on Mac is added.")).toBeInTheDocument();
  await waitFor(() => expect(within(screen.getByRole("list", { name: "Your devices" })).getByText("Chrome on Mac")).toBeInTheDocument());
  expect(calls.some((c) => c.url.endsWith("/mesh/pairings/p1/confirm"))).toBe(true);
});

test("No, cancel keeps the other device out", async () => {
  const phone = device({ passkey: true });
  const stranger = device({ id: "d_9", name: "Someone's laptop", active: false });
  const { mesh, calls } = fakeMesh({
    "GET /mesh/devices": [phone, stranger],
    "GET /mesh/config": { rp_id: "localhost", vapid_public_key: null },
    "POST /mesh/pairings": { pairing_id: "p1", link: "http://localhost:3000/#pair=p1.s", qr_svg: QR, expires_at: new Date(Date.now() + 120_000).toISOString() },
    "GET /mesh/pairings/p1": { claimed: true, code: "111222", device_name: "Someone's laptop" },
    "DELETE /mesh/devices/d_9": { removed: true },
  });
  render(inMesh(mesh, <DevicesPage {...props()} pollMs={10} />));

  await userEvent.click(await screen.findByRole("button", { name: "Add another device" }));
  await userEvent.click(await screen.findByRole("button", { name: "No, cancel" }));

  expect(await screen.findByText(/Not added. Someone's laptop can't do anything for you./)).toBeInTheDocument();
  expect(calls.some((c) => c.init.method === "DELETE" && c.url.endsWith("/mesh/devices/d_9"))).toBe(true);
});

test("removing another device asks once more", async () => {
  let list = [device({ passkey: true }), device({ id: "d_2", name: "Old laptop" })];
  const { mesh } = fakeMesh({
    "GET /mesh/devices": () => [200, list],
    "GET /mesh/config": { rp_id: "localhost", vapid_public_key: null },
    "DELETE /mesh/devices/d_2": () => {
      list = [list[0]!];
      return [200, { removed: true }];
    },
  });
  const { container } = render(inMesh(mesh, <DevicesPage {...props()} />));

  expect(screen.queryByRole("button", { name: "Remove Safari on iPhone" })).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "Remove Old laptop" }));
  expect(screen.getByRole("group", { name: "Remove Old laptop?" })).toBeInTheDocument();
  await expectNoA11yViolations(container);
  await userEvent.click(screen.getByRole("button", { name: "Yes, remove it" }));

  expect(await screen.findByText("Old laptop is removed.")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("Old laptop")).not.toBeInTheDocument());
});

test("notifications say honestly when the Gateway has no VAPID key", async () => {
  const { mesh } = fakeMesh({ "GET /mesh/devices": [device({ passkey: true })], "GET /mesh/config": { rp_id: "localhost", vapid_public_key: null } });
  render(inMesh(mesh, <DevicesPage {...props()} />));

  const toggle = await screen.findByRole("switch", { name: "Wake this device when Tempo needs an answer" });
  await waitFor(() => expect(toggle).toBeDisabled());
  expect(screen.getByText(/no Web Push key \(VAPID\)/)).toBeInTheDocument();
  expect(screen.getByText(/A push says only "sync"/)).toBeInTheDocument();
});

test("a device whose code isn't confirmed yet is told to confirm it on the other screen", async () => {
  const { mesh } = fakeMesh({ "GET /mesh/devices": () => [403, { detail: "confirm the pairing code on your other device first" }] });
  render(inMesh(mesh, <DevicesPage {...props()} />));

  expect(await screen.findByText(/the code hasn't been confirmed yet/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
});

test("the Join view: name this device, join, compare the code, then add Face ID once confirmed", async () => {
  let confirmed = false;
  const { mesh, storage, calls, authenticator } = fakeMesh(
    {
      "POST /mesh/pairings/p1/claim": { device: device({ id: "d_2", active: false }), token: "laptop-token", code: "042917" },
      "GET /mesh/devices": () => (confirmed ? [200, [device(), device({ id: "d_2", name: "Laptop" })]] : [403, { detail: "confirm the pairing code on your other device first" }]),
      "POST /mesh/devices/me/passkey/options": { challenge_id: "c1", options: { challenge: "AQI", user: { id: "dV8x", name: "u_margaret" }, rp: { id: "localhost" } } },
      "POST /mesh/devices/me/passkey": device({ id: "d_2", passkey: true }),
    },
    { id: null },
  );
  window.location.hash = "#pair=p1.s3cret";
  const { container } = render(inMesh(mesh, <DevicesPage {...props({ link: "http://localhost:3000/#pair=p1.s3cret" })} pollMs={10} />));

  expect(screen.getByRole("heading", { level: 1, name: "Devices" })).toBeInTheDocument();
  const name = screen.getByLabelText("What should Tempo call this device?");
  await expectNoA11yViolations(container);
  await userEvent.clear(name);
  await userEvent.type(name, "Laptop");
  await userEvent.click(screen.getByRole("button", { name: "Join" }));

  expect(await screen.findByText("Pairing code: 0 4 2 9 1 7")).toBeInTheDocument();
  expect(screen.getByText("042 917")).toBeInTheDocument();
  const claim = calls.find((c) => c.url.endsWith("/mesh/pairings/p1/claim"))!;
  expect(JSON.parse(claim.init.body as string)).toMatchObject({ secret: "s3cret", name: "Laptop" });
  expect(storage.getItem(DEVICE_KEY)).toBe("laptop-token");
  expect(window.location.hash).toBe("#/pair"); // the spent secret is out of the address bar
  await expectNoA11yViolations(container);

  confirmed = true;
  await userEvent.click(await screen.findByRole("button", { name: "Now add Face ID" }));
  expect(authenticator.created).toBe(1);
  expect(await screen.findByText("Face ID is on for this device.")).toBeInTheDocument();
});

test("a spent or expired link says what to do next", async () => {
  const { mesh } = fakeMesh({ "POST /mesh/pairings/p1/claim": () => [409, { detail: "this pairing link was already used" }] }, { id: null });
  render(inMesh(mesh, <DevicesPage {...props({ link: "http://localhost:3000/#pair=p1.s3cret" })} />));

  await userEvent.click(screen.getByRole("button", { name: "Join" }));
  expect(await screen.findByText(/This pairing link was already used. Ask your other device for a new code./)).toBeInTheDocument();
});

test("the showcase explains that pairing needs a running Gateway", async () => {
  const { container } = render(
    <main>
      <DevicesPage {...props({}, true)} />
    </main>,
  );
  expect(screen.getByRole("heading", { level: 1, name: "Devices" })).toBeInTheDocument();
  expect(screen.getByText("Pairing needs a running Gateway")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "#/settings");
  await expectNoA11yViolations(container);
});
