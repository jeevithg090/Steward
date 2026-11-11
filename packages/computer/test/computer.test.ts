/**
 * The computer against real Chromium (Playwright 1.64's cached build) and a local test site.
 * Only 127.0.0.1 is visited; the managers that visit it opt in to private hosts.
 */
import { readdirSync } from "node:fs";
import { mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AuditEvent,
  AuditLog,
  ComputerManager,
  ComputerServerMessage,
  ComputerStatus,
} from "@steward/shared";
import type { BrowserContext, ElementHandle, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ComputerError, createComputerManager, MASKED_VALUE, MESSAGES } from "../src/index.ts";
import { refOf, startSite, type TestSite } from "./site.ts";

type Frame = Extract<ComputerServerMessage, { type: "frame" }>;

function fakeAudit(): AuditLog & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    append(input) {
      const event: AuditEvent = {
        seq: events.length + 1,
        id: `aud_${events.length + 1}`,
        at: new Date().toISOString(),
        type: input.type,
        actorId: input.actorId,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        detail: input.detail ?? {},
        prevHash: "",
        hash: "",
      };
      events.push(event);
      return event;
    },
    page: () => ({ events, total: events.length }),
    verify: () => ({ ok: true, count: events.length }),
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await delay(25);
  }
}

async function refusal(fn: () => Promise<unknown>): Promise<ComputerError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ComputerError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

/** The agent asks for a secret for `ref`, and the person sends `value` through the secret box. */
async function fillSecret(
  m: ComputerManager,
  agentId: string,
  ref: string,
  value: string,
): Promise<{ filled: boolean; length: number }> {
  const c = await m.get(agentId);
  const asked = c.requestSecret(ref, "The value");
  await waitFor(() => m.status(agentId).secret !== undefined);
  const request = m.status(agentId).secret as NonNullable<ComputerStatus["secret"]>;
  await m.handle(agentId, { type: "secret", requestId: request.id, value });
  return asked;
}

let site: TestSite;
/** Stands in for Steward's own server: a protected port the browser must never reach. */
let own: TestSite;
let dataDir: string;
let audit: ReturnType<typeof fakeAudit>;
let manager: ComputerManager;
let strict: ComputerManager;
/** Closes a browser after a second unused, and runs one at a time. */
let napping: ComputerManager;

beforeAll(async () => {
  site = await startSite();
  own = await startSite();
  dataDir = await mkdtemp(join(tmpdir(), "steward-computer-"));
  audit = fakeAudit();
  manager = createComputerManager({
    dataDir,
    allowPrivateHosts: true,
    protectedPorts: [own.port],
    audit,
    // Small, so the size check is tested without writing 100 MB.
    maxDownloadBytes: 1024 * 1024,
  });
  strict = createComputerManager({ dataDir: join(dataDir, "strict") });
  napping = createComputerManager({
    dataDir: join(dataDir, "napping"),
    allowPrivateHosts: true,
    idleCloseMs: 1_000,
    maxRunning: 1,
  });
});

afterAll(async () => {
  await manager?.closeAll();
  await strict?.closeAll();
  await napping?.closeAll();
  await site?.close();
  await own?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

// Several tests start a browser of their own, and on a busy machine one start can take 15 s.
describe("the computer, in real Chromium", { timeout: 90_000 }, () => {
  it("starts on first use, with its profile and workspace in place", async () => {
    expect(manager.status("alpha")).toMatchObject({
      agentId: "alpha",
      running: false,
      controller: "agent",
      viewport: { width: 1280, height: 800 },
    });
    expect(() => manager.status("../escape")).toThrow(/Agent ids/);
    await manager.get("alpha");
    expect(manager.status("alpha").running).toBe(true);
    expect((await stat(join(dataDir, "computers/alpha/workspace"))).isDirectory()).toBe(true);
    expect((await stat(join(dataDir, "computers/alpha/profile/Default"))).isDirectory()).toBe(true);
  });

  it("reads pages as text with refs, and clicks, types and chooses by ref", async () => {
    const c = await manager.get("alpha");
    const form = await c.navigate(`${site.base}/form`);
    expect(form).toMatchObject({ url: `${site.base}/form`, title: "Form", truncated: false });
    expect(form.snapshot).toContain('- heading "Order" [level=1]');
    expect(form.snapshot).toMatch(/- textbox "Name" \[ref=e\d+\]: Ada/);

    const typed = await c.type(refOf(form.snapshot, 'textbox "Name"'), "Grace");
    expect(typed.snapshot).toMatch(/textbox "Name" \[ref=e\d+\]: Grace/);
    const chose = await c.type(refOf(typed.snapshot, 'combobox "Size"'), "large");
    expect(chose.snapshot).toMatch(/combobox "Size" \[ref=e\d+\] \[options: Small \| Large\]: Large/);
    const ticked = await c.click(refOf(chose.snapshot, 'checkbox "Bacon"'));
    expect(ticked.snapshot).toMatch(/checkbox "Bacon" \[checked\]/);
    const saved = await c.click(refOf(ticked.snapshot, 'button "Save"'));
    expect(saved.snapshot).toContain("Saved: Grace, Large, bacon");
    // The gateway asks which button Enter would press before a submitting type runs.
    const search = refOf(saved.snapshot, 'textbox "Search"');
    expect(await c.submitterFor(search)).toBeUndefined();
    const searched = await c.type(search, "cheap flights", { submit: true });
    expect(searched.snapshot).toContain("Searched: cheap flights");

    expect(await c.describe(refOf(searched.snapshot, 'button "Save"'))).toEqual({
      role: "button",
      name: "Save",
      sensitive: false,
    });
    expect(await c.describe("e99999")).toBeUndefined();

    const lines = c.activity().map((a) => a.text);
    expect(lines).toContain(`Opened 127.0.0.1:${site.port}/form`);
    expect(lines).toContain("Typed into 'Name' (5 characters)");
    expect(lines).toContain("Chose an option in 'Size'");
    expect(lines).toContain("Clicked 'Save'");
    expect(lines).toContain("Typed into 'Search' (13 characters) and pressed Enter");
    expect(lines.join("\n")).not.toContain("cheap flights");
  });

  it("masks passwords, one-time codes and other sensitive values", async () => {
    const c = await manager.get("alpha");
    const page = await c.navigate(`${site.base}/form`);
    expect(page.snapshot).not.toContain("hunter2");
    expect(page.snapshot).not.toContain("424242");
    const line = (name: string) => page.snapshot.split("\n").find((l) => l.includes(`textbox "${name}"`));
    expect(line("Password")?.endsWith(`: ${MASKED_VALUE}`)).toBe(true);
    expect(line("Code")?.endsWith(`: ${MASKED_VALUE}`)).toBe(true);
    expect(line("Name")?.endsWith(": Ada")).toBe(true);
    const sensitive = async (name: string) =>
      (await c.describe(refOf(page.snapshot, `textbox "${name}"`)))?.sensitive;
    expect(await sensitive("Password")).toBe(true);
    expect(await sensitive("Code")).toBe(true);
    expect(await sensitive("Name")).toBe(false);
  });

  it("tells the gateway a password field is one by its type, whatever its label says", async () => {
    const c = await manager.get("alpha");
    const page = await c.navigate(`${site.base}/checkout`);
    // Empty, so nothing is masked, and labelled in German: only the field's type says it is secret.
    expect(await c.describe(refOf(page.snapshot, 'textbox "Passwort"'))).toEqual({
      role: "textbox",
      name: "Passwort",
      sensitive: true,
    });
    const bare = page.snapshot.match(/- textbox \[ref=(e\d+)\]$/m)?.[1];
    expect(bare).toBeDefined();
    expect(await c.describe(bare as string)).toEqual({ role: "textbox", name: "", sensitive: true });
    expect((await c.describe(refOf(page.snapshot, 'textbox "Promo code"')))?.sensitive).toBe(false);
  });

  it("reports what a key press would act on: the focused element and the button Enter presses", async () => {
    const c = await manager.get("alpha");
    const page = await c.navigate(`${site.base}/checkout`);
    expect(await c.focused()).toBeUndefined();

    const placeOrder = { role: "button", name: "Place order" };
    await c.click(refOf(page.snapshot, 'textbox "Promo code"'));
    expect(await c.focused()).toEqual({
      role: "textbox",
      name: "Promo code",
      sensitive: false,
      submitter: placeOrder,
    });
    await c.press("Tab");
    expect(await c.focused()).toEqual({
      role: "textbox",
      name: "Passwort",
      sensitive: true,
      submitter: placeOrder,
    });
    await c.press("Tab");
    expect(await c.focused()).toEqual({ role: "textbox", name: "", sensitive: true, submitter: placeOrder });
    // A focused button is what Enter or Space presses, even a plain one inside the form.
    await c.press("Tab");
    expect(await c.focused()).toEqual({
      role: "button",
      name: "Apply",
      sensitive: false,
      submitter: { role: "button", name: "Apply" },
    });
    await c.press("Tab");
    expect(await c.focused()).toEqual({ ...placeOrder, sensitive: false, submitter: placeOrder });
    // And it is what really happens: Enter on it places the order.
    expect((await c.press("Enter")).snapshot).toContain("Order placed");

    const look = await c.snapshot();
    // A menu item in the form is what Enter activates; only form fields submit the form.
    await c.click(refOf(look.snapshot, 'menuitem "Remove item"'));
    expect(await c.focused()).toEqual({
      role: "menuitem",
      name: "Remove item",
      sensitive: false,
      submitter: { role: "menuitem", name: "Remove item" },
    });
    // A form whose default button is hidden still submits on Enter: unnamed, so the gateway fails closed.
    await c.click(refOf(look.snapshot, 'textbox "Coupon"'));
    expect(await c.focused()).toEqual({ role: "textbox", name: "Coupon", sensitive: false, submitter: {} });
    await c.click(refOf(look.snapshot, 'button "Help"'));
    expect(await c.focused()).toEqual({
      role: "button",
      name: "Help",
      sensitive: false,
      submitter: { role: "button", name: "Help" },
    });
    // Focus on something the snapshot leaves out: unknown, so secret and committing.
    await c.press("Tab");
    expect(await c.focused()).toEqual({ sensitive: true, submitter: {} });
  });

  it("presses a key only where focus was checked, and Enter only on the button that was judged", async () => {
    const c = await manager.get("alpha");
    const page = await c.navigate(`${site.base}/focus-flip`);
    // Without a check of what has focus, no key is pressed.
    const unchecked = await refusal(() => c.press("Enter"));
    expect(unchecked).toMatchObject({ code: "stale_ref", message: MESSAGES.focusUnchecked });

    await c.click(refOf(page.snapshot, 'textbox "Search"'));
    expect(await c.focused()).toEqual({ role: "textbox", name: "Search", sensitive: false });
    // The page moves focus to "Place order" after the check (here, on a click that keeps focus).
    await c.click(refOf(page.snapshot, 'button "Arm"'));
    await delay(100);
    const moved = await refusal(() => c.press("Enter"));
    expect(moved).toMatchObject({ code: "stale_ref", message: MESSAGES.focusChanged });
    expect((await c.snapshot()).snapshot).not.toContain("Order placed");
    // Checked again, the key goes to what the gateway now judges.
    expect(await c.focused()).toMatchObject({ role: "button", name: "Place order" });
    expect((await c.press("Enter")).snapshot).toContain("Order placed");

    // A form that gains a new default button as the field is typed into: Enter is not pressed.
    const again = await c.navigate(`${site.base}/focus-flip`);
    const note = refOf(again.snapshot, 'textbox "Note"');
    const unjudged = await refusal(() => c.type(note, "hello", { submit: true }));
    expect(unjudged).toMatchObject({ code: "stale_ref", message: MESSAGES.submitterUnchecked });
    expect(await c.submitterFor(note)).toEqual({ role: "button", name: "Save note" });
    const sneaky = await refusal(() => c.type(note, "hello", { submit: true }));
    expect(sneaky).toMatchObject({ code: "stale_ref", message: MESSAGES.submitterChanged });
    const after = await c.snapshot();
    expect(after.snapshot).toContain('button "Place order"');
    expect(after.snapshot).not.toContain("Order placed");
    expect(c.activity().map((a) => a.text)).toContain(
      "Typed into 'Note' but did not press Enter: the form changed",
    );
  });

  it("stops a key that focus carries to another element after the last check", async () => {
    const c = await manager.get("racer");
    const page = await c.navigate(`${site.base}/focus-race`);
    const live = (c as unknown as { livePage: Page }).livePage;
    const body = await live.$("body");
    const proto = Object.getPrototypeOf(body) as ElementHandle;
    await body?.dispose();
    const press = proto.press;
    // Playwright puts focus on the element, then sends the key in a second step. A page that moves
    // focus on a timer can do it in between; here it always does.
    proto.press = async function (this: ElementHandle, key: string) {
      await this.focus();
      await live.evaluate(() => document.getElementById("buy")?.focus());
      await live.keyboard.press(key);
    };
    try {
      const searched = await c.click(refOf(page.snapshot, 'textbox "Search"'));
      expect(await c.focused()).toMatchObject({ role: "textbox", name: "Search" });
      const moved = await refusal(() => c.press("Enter"));
      expect(moved).toMatchObject({ code: "stale_ref", message: MESSAGES.focusChanged });

      const note = refOf(searched.snapshot, 'textbox "Note"');
      expect(await c.submitterFor(note)).toEqual({ role: "button", name: "Save note" });
      const typed = await refusal(() => c.type(note, "hello", { submit: true }));
      expect(typed).toMatchObject({ code: "stale_ref", message: MESSAGES.focusChanged });
      expect(c.activity().at(-1)?.text).toBe("Typed into 'Note' but did not press Enter: focus moved");
    } finally {
      proto.press = press;
    }
    const after = await c.snapshot();
    expect(after.snapshot).not.toContain("Order placed");

    // Without the race, keys land where they were judged, including ones that move focus themselves.
    await c.click(refOf(after.snapshot, 'textbox "Search"'));
    expect(await c.focused()).toMatchObject({ name: "Search" });
    await c.press("Tab");
    expect(await c.focused()).toMatchObject({ name: "Note" });
    expect((await c.press("Enter")).snapshot).toContain("Saved");
  });

  it("finds the button Enter presses inside a frame, from the frame's own buttons", async () => {
    const c = await manager.get("alpha");
    const page = await c.navigate(`${site.base}/framed`);
    const promo = refOf(page.snapshot, 'textbox "Promo code"');
    expect(await c.submitterFor(promo)).toEqual({ role: "button", name: "Place order" });
    await c.click(promo);
    expect(await c.focused()).toEqual({
      role: "textbox",
      name: "Promo code",
      sensitive: false,
      submitter: { role: "button", name: "Place order" },
    });
  });

  it("names the default submit button of a typed field's form", async () => {
    const c = await manager.get("alpha");
    const page = await c.navigate(`${site.base}/checkout`);
    // The first submit button in the form, not the field's own name and not the later one.
    expect(await c.submitterFor(refOf(page.snapshot, 'textbox "Promo code"'))).toEqual({
      role: "button",
      name: "Place order",
    });
    expect(await c.submitterFor(refOf(page.snapshot, 'textbox "Coupon"'))).toEqual({});
    expect(await c.submitterFor("e99999")).toBeUndefined();

    const form = await c.navigate(`${site.base}/form`);
    // A form with no submit button, and a field in no form, have none.
    expect(await c.submitterFor(refOf(form.snapshot, 'textbox "Search"'))).toBeUndefined();
    expect(await c.submitterFor(refOf(form.snapshot, 'textbox "Name"'))).toBeUndefined();
    // A ref from the page before is not resolved against this one.
    expect(await c.submitterFor(refOf(page.snapshot, 'textbox "Promo code"'))).toBeUndefined();
  });

  it("refuses a stale ref instead of acting on the wrong element", async () => {
    const c = await manager.get("alpha");
    const form = await c.navigate(`${site.base}/form`);
    const saveRef = refOf(form.snapshot, 'button "Save"');
    const next = await c.navigate(`${site.base}/next`);
    // Playwright restarts its own numbering on every page; Steward's refs never repeat.
    expect(next.snapshot).not.toContain(`[ref=${saveRef}]`);
    const gone = await refusal(() => c.click(saveRef));
    expect(gone.code).toBe("stale_ref");
    expect(gone.message).toMatch(/^Stale ref e\d+: .*take a new snapshot/);

    // A page that renames a button after the snapshot cannot redirect the click.
    const page = await c.navigate(`${site.base}/rename`);
    const nextRef = refOf(page.snapshot, 'button "Next"');
    const armed = await c.click(refOf(page.snapshot, 'button "Arm"'));
    expect(armed.snapshot).toContain(`button "Next" [ref=${nextRef}]`);
    await delay(1_100);
    const changed = await refusal(() => c.click(nextRef));
    expect(changed.code).toBe("stale_ref");
    expect(changed.message).toMatch(/changed since your last snapshot/);
    const fresh = await c.snapshot();
    expect(refOf(fresh.snapshot, 'button "Pay now"')).not.toBe(nextRef);
  });

  it("saves downloads into the workspace and answers dialogs safely", async () => {
    const c = await manager.get("alpha");
    const page = await c.navigate(`${site.base}/files`);
    const clicked = await c.click(refOf(page.snapshot, 'link "Download the report"'));
    await waitFor(() => c.activity().some((a) => a.text === "Downloaded downloads/report.csv (19 bytes)"));
    expect(await c.readFile("downloads/report.csv")).toBe("month,total\naug,42\n");
    // The model hears about it once, with the click or the next look, and Chromium's copy is gone.
    const look = await c.snapshot();
    const told = [clicked.snapshot, look.snapshot].filter((text) =>
      text.startsWith("[Saved a download to downloads/report.csv (19 bytes).]\n"),
    );
    expect(told).toHaveLength(1);
    expect(await readdir(join(dataDir, "computers/alpha/downloading"))).toEqual([]);

    const after = await c.click(refOf(look.snapshot, 'button "Delete everything"'));
    expect(after.snapshot.split("\n")[0]).toBe(
      '[The page showed a confirm box: "Delete everything?". Steward dismissed it.]',
    );
    expect(after.snapshot).toContain("- paragraph: kept");
  });

  it("stops a download that passes the size limit while it runs", async () => {
    const c = await manager.get("alpha");
    const page = await c.navigate(`${site.base}/huge`);
    await c.click(refOf(page.snapshot, 'link "Download the big file"'));
    await waitFor(
      () => c.activity().some((a) => a.text === "Stopped the download endless.bin: over 1 MB"),
      10_000,
    );
    // The download never ends by itself, so it stopped only because Steward stopped it.
    await waitFor(() => site.endless === 0);
    expect((await c.listFiles("downloads")).map((f) => f.path)).not.toContain("downloads/endless.bin");
    await waitFor(() => readdirSync(join(dataDir, "computers/alpha/downloading")).length === 0);
    expect((await c.snapshot()).snapshot.split("\n")[0]).toBe(
      "[Steward stopped the download of endless.bin: it was over 1 MB, the most a page may download.]",
    );
  });

  it("saves at most ten downloads a minute from a page that starts them on its own", async () => {
    const c = await manager.get("flood");
    const opened = await c.navigate(`${site.base}/flood`);
    await waitFor(
      () => c.activity().filter((a) => a.text.startsWith("Downloaded downloads/report")).length === 10,
      15_000,
    );
    await delay(500);
    const lines = c.activity().map((a) => a.text);
    expect(lines.filter((t) => t.startsWith("Downloaded downloads/report"))).toHaveLength(10);
    expect(
      lines.filter((t) => t === "Stopped more downloads from the page: at most 10 a minute"),
    ).toHaveLength(1);
    expect(await c.listFiles("downloads")).toHaveLength(10);
    // The model is told, in the observation that was next when each thing happened.
    const told = `${opened.snapshot}\n${(await c.snapshot()).snapshot}`;
    expect(
      told
        .split("\n")
        .filter(
          (l) => l === "[The page started more than 10 downloads in a minute, so Steward stopped the rest.]",
        ),
    ).toHaveLength(1);
    const saved = told.split("\n").filter((l) => l.startsWith("[Saved "));
    expect(saved.join(" ")).toContain("report (10).csv (19 bytes)");
    expect(saved.join(" ").match(/report[^,]*\.csv \(19 bytes\)/g)).toHaveLength(10);
  });

  it("carries on in a fresh tab when the page crashes, and says so", async () => {
    const c = await manager.get("crashy");
    await c.navigate(`${site.base}/next`);
    // Kill the tab's renderer the way a crash would.
    const inside = c as unknown as { context: BrowserContext; livePage: Page };
    const cdp = await inside.context.newCDPSession(inside.livePage);
    await cdp.send("Page.crash").catch(() => {});
    await waitFor(() =>
      c.activity().some((a) => a.text === "The page stopped working, so Steward opened a fresh tab"),
    );
    // The next action works at once, and the model hears what happened.
    const look = await c.navigate(`${site.base}/form`);
    expect(look.title).toBe("Form");
    expect(look.snapshot.split("\n")[0]).toBe(`[${MESSAGES.pageCrashed}]`);
    expect((await c.snapshot()).snapshot).not.toContain(MESSAGES.pageCrashed);
    expect(c.status()).toMatchObject({ running: true, url: `${site.base}/form` });
  });

  it("follows a popup the agent opened", async () => {
    const c = await manager.get("alpha");
    const form = await c.navigate(`${site.base}/form`);
    const popup = await c.click(refOf(form.snapshot, 'link "Open in a new tab"'));
    expect(popup.url).toBe(`${site.base}/next`);
    expect(popup.snapshot).toContain('heading "Next page"');
  });

  it("scrolls a long page and shows the part on screen", async () => {
    const c = await manager.get("alpha");
    const top = await c.navigate(`${site.base}/long`);
    expect(top.truncated).toBe(true);
    expect(top.snapshot).toContain("Paragraph 0 with");
    expect(top.snapshot).toMatch(/more lines below are not shown/);
    const down = await c.scroll("down", 15_000);
    expect(down.snapshot).toMatch(/lines above are not shown/);
    expect(down.snapshot).not.toContain("Paragraph 0 with");
    expect(down.snapshot.length).toBeLessThanOrEqual(12_000);
  });

  it("refuses cloud metadata even with private hosts allowed: direct, as a subresource and after a redirect", async () => {
    const c = await manager.get("alpha");
    const page = await c.navigate(`${site.base}/meta-img`);
    expect(page.snapshot).toContain("Hello");
    await waitFor(() => c.activity().some((a) => a.text === "Blocked a request to 169.254.169.254"));

    const direct = await refusal(() => c.navigate("http://169.254.169.254/latest/meta-data/"));
    expect(direct.code).toBe("blocked");
    expect(direct.message).toMatch(/cloud metadata address/);

    // Playwright never shows redirect hops to routes; the egress proxy refuses this one.
    const redirected = await refusal(() => c.navigate(`${site.base}/redirect-meta`));
    expect(redirected.code).toBe("blocked");
    expect(redirected.message).toMatch(/blocked address\. 169\.254\.169\.254 is a cloud metadata address/);
  });

  it("never opens Steward's own port, whichever address for this machine is used", async () => {
    const c = await manager.get("alpha");
    for (const host of ["127.0.0.1", "localhost", "0.0.0.0", "[::ffff:127.0.0.1]", "[::]"]) {
      const url = `http://${host}:${own.port}/form`;
      const refused = await refusal(() => c.navigate(url));
      expect(refused.code, url).toBe("blocked");
      expect(refused.message, url).toMatch(/Steward's own server/);
    }
    expect(own.hits).toBe(0);
    // The same machine on another port is still open, because private hosts are allowed here.
    expect((await c.navigate(`http://0.0.0.0:${site.port}/next`)).title).toBe("Next");
  });

  it("refuses loopback and private hosts by default, and non-web schemes always", async () => {
    const c = await strict.get("guarded");
    for (const url of [
      `${site.base}/form`,
      `http://localhost:${site.port}/form`,
      `http://[::1]:${site.port}/`,
      "http://10.0.0.1/",
      "http://2130706433/",
    ]) {
      const refused = await refusal(() => c.navigate(url));
      expect(refused.code, url).toBe("blocked");
      expect(refused.message, url).toMatch(/on this computer or a private network/);
    }
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "chrome://version",
      "data:text/html,hi",
    ]) {
      expect((await refusal(() => c.navigate(url))).code, url).toBe("bad_url");
    }
    expect(c.status().url).toBe("about:blank");
    expect(c.activity().map((a) => a.text)).toContain(`Refused to open 127.0.0.1:${site.port}/form`);
  });

  it("keeps files in the workspace and runs the shell there", async () => {
    const c = await manager.get("alpha");
    expect(await c.writeFile("notes/today.md", "# Today\n")).toMatchObject({
      path: "notes/today.md",
      size: 8,
    });
    expect(await c.readFile("notes/today.md")).toBe("# Today\n");
    expect(await c.readFile("notes/today.md", { maxBytes: 3 })).toBe(
      "# T\n\n[Showing the first 3 bytes of 8 bytes.]",
    );
    expect((await c.listFiles()).map((f) => f.path)).toEqual(
      expect.arrayContaining(["notes", "notes/today.md"]),
    );
    expect((await refusal(() => c.readFile("../profile/Default/Preferences"))).code).toBe("bad_path");

    const workspace = await realpath(join(dataDir, "computers/alpha/workspace"));
    const ran = await c.runShell("pwd && cat notes/today.md && echo $HOME");
    expect(ran).toMatchObject({ exitCode: 0, timedOut: false });
    const [cwd, heading, home] = ran.stdout.trimEnd().split("\n");
    expect([cwd, heading]).toEqual([workspace, "# Today"]);
    // HOME is the command's own, in the computer's tmp folder, out of the file tools' reach.
    expect(home?.startsWith(join(dataDir, "computers/alpha/tmp/home-"))).toBe(true);
    const lines = c.activity().map((a) => a.text);
    expect(lines).toContain("Saved notes/today.md (8 bytes)");
    expect(lines).toContain("Ran `pwd && cat notes/today.md && echo $HOME`");
  });

  it("hands the wheel to the person after the agent's action finishes, and back with a fresh look", async () => {
    const c = await manager.get("wheel");
    const messages: ComputerServerMessage[] = [];
    const unsubscribe = manager.subscribe("wheel", (m) => {
      if (m.type !== "frame") messages.push(m);
    });

    await manager.handle("wheel", { type: "mouse", action: "click", x: 10, y: 10 });
    expect(messages).toContainEqual({ type: "error", message: MESSAGES.takeTheWheelFirst });

    let navigatedAt = 0;
    const slow = c.navigate(`${site.base}/slow`).then((page) => {
      navigatedAt = Date.now();
      return page;
    });
    await delay(200);
    await manager.handle("wheel", { type: "take" });
    const takenAt = Date.now();
    expect(navigatedAt).toBeGreaterThan(0);
    expect(navigatedAt).toBeLessThanOrEqual(takenAt);
    expect((await slow).snapshot).toContain("Finally");
    expect(manager.status("wheel").controller).toBe("person");

    await expect(c.click("e1")).rejects.toThrow("The person has control of the screen right now.");
    await expect(c.navigate(`${site.base}/next`)).rejects.toMatchObject({ code: "person_has_control" });
    await expect(c.runShell("echo hi")).rejects.toMatchObject({ code: "person_has_control" });
    await expect(c.writeFile("x.txt", "y")).rejects.toMatchObject({ code: "person_has_control" });

    // The person drives with real input events.
    await manager.handle("wheel", { type: "navigate", url: `${site.base}/typing` });
    await manager.handle("wheel", { type: "mouse", action: "click", x: 100, y: 20 });
    await manager.handle("wheel", { type: "text", text: "hello" });
    await manager.handle("wheel", { type: "key", action: "press", key: "Backspace" });
    await manager.handle("wheel", { type: "key", action: "press", key: "!", text: "!" });
    const seen = await c.snapshot(); // looking is allowed while the person drives
    expect(seen.snapshot).toMatch(/textbox "Box" \[ref=e\d+\]: hell!/);

    await manager.handle("wheel", { type: "release" });
    expect(manager.status("wheel").controller).toBe("agent");
    const stale = await refusal(() => c.click(refOf(seen.snapshot, 'textbox "Box"')));
    expect(stale.code).toBe("snapshot_required");
    const look = await c.snapshot();
    await expect(c.click(refOf(look.snapshot, 'textbox "Box"'))).resolves.toMatchObject({ title: "Typing" });

    const controllers = messages.flatMap((m) => (m.type === "status" ? [m.status.controller] : []));
    expect(controllers).toContain("person");
    expect(controllers.at(-1)).toBe("agent");
    const types = audit.events.filter((e) => e.agentId === "wheel").map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["computer.control_taken", "computer.control_released"]));
    expect(c.activity().map((a) => a.text)).toEqual(
      expect.arrayContaining(["You took the wheel", "You handed the wheel back"]),
    );
    unsubscribe();
  });

  it("asks the person for help and carries on when they hand back", async () => {
    const c = await manager.get("wheel");
    const reason = "Please sign in to the site for me.";
    const help = c.requestHelp(reason);
    await waitFor(() => manager.status("wheel").help?.reason === reason);
    await expect(c.click("e1")).rejects.toMatchObject({ code: "person_has_control" });
    await manager.handle("wheel", { type: "take" });
    await manager.handle("wheel", { type: "release" });
    await expect(help).resolves.toEqual({ released: true });
    expect(manager.status("wheel").help).toBeUndefined();
    expect(audit.events.find((e) => e.type === "computer.help_requested")?.detail).toMatchObject({ reason });

    const stop = new AbortController();
    const asked = c.requestHelp("Clear the check on this page.", { signal: stop.signal });
    await waitFor(() => manager.status("wheel").help !== undefined);
    stop.abort();
    await expect(asked).resolves.toEqual({ released: false });
    expect(manager.status("wheel").help).toBeUndefined();
  });

  it("types a secret into the page without it reaching anything else", async () => {
    const SECRET = "correct-horse-battery-9137";
    const c = await manager.get("vault");
    const seen: string[] = [];
    const unsubscribe = manager.subscribe("vault", (m) => {
      if (m.type !== "frame") seen.push(JSON.stringify(m));
    });
    const page = await c.navigate(`${site.base}/secret`);
    const codeRef = refOf(page.snapshot, 'textbox "One-time code"');

    const waiting = c.requestSecret(codeRef, "The code sent to your phone");
    await waitFor(() => manager.status("vault").secret !== undefined);
    const request = manager.status("vault").secret as NonNullable<ComputerStatus["secret"]>;
    expect(request).toMatchObject({
      ref: codeRef,
      label: "The code sent to your phone",
      host: `127.0.0.1:${site.port}`,
    });

    await manager.handle("vault", { type: "secret", requestId: "sec_wrong", value: SECRET });
    expect(manager.status("vault").secret?.id).toBe(request.id);
    await manager.handle("vault", { type: "secret", requestId: request.id, value: SECRET });
    await expect(waiting).resolves.toEqual({ filled: true, length: SECRET.length });
    expect(manager.status("vault").secret).toBeUndefined();

    const after = await c.snapshot();
    expect(after.snapshot).toMatch(/textbox "One-time code" \[ref=e\d+\]: \[hidden: sensitive field\]/);
    const checked = await c.click(refOf(after.snapshot, 'button "Check"'));
    expect(checked.snapshot).toContain(`Code length: ${SECRET.length}`);

    const filled = audit.events.find((e) => e.type === "secret.filled");
    expect(filled?.detail).toEqual({ length: SECRET.length, host: `127.0.0.1:${site.port}` });
    const everything = [
      JSON.stringify(audit.events),
      JSON.stringify(c.activity(500)),
      JSON.stringify(c.status()),
      after.snapshot,
      checked.snapshot,
      ...seen,
    ].join("\n");
    expect(everything).not.toContain(SECRET);

    // A GET form puts the code in the address: it is hidden there too.
    const otp = await c.navigate(`${site.base}/otp`);
    const asked = c.requestSecret(refOf(otp.snapshot, 'textbox "Code"'), "The code");
    await waitFor(() => manager.status("vault").secret !== undefined);
    const third = manager.status("vault").secret as NonNullable<ComputerStatus["secret"]>;
    // Sent twice in a hurry, it is typed and recorded once.
    await Promise.all([
      manager.handle("vault", { type: "secret", requestId: third.id, value: SECRET }),
      manager.handle("vault", { type: "secret", requestId: third.id, value: SECRET }),
    ]);
    await expect(asked).resolves.toEqual({ filled: true, length: SECRET.length });
    expect(audit.events.filter((e) => e.type === "secret.filled")).toHaveLength(2);
    const landed = await c.click(refOf((await c.snapshot()).snapshot, 'button "Verify"'));
    expect(landed.title).toBe("Verified");
    expect(landed.url).toBe(`${site.base}/otp-done?code=hidden`);
    expect(manager.status("vault").url).toBe(`${site.base}/otp-done?code=hidden`);
    expect(JSON.stringify(c.activity(500))).not.toContain(SECRET);

    const back = await c.navigate(`${site.base}/secret`);
    const again = c.requestSecret(refOf(back.snapshot, 'textbox "One-time code"'), "Another code");
    await waitFor(() => manager.status("vault").secret !== undefined);
    const second = manager.status("vault").secret as NonNullable<ComputerStatus["secret"]>;
    await manager.handle("vault", { type: "secret.cancel", requestId: second.id });
    await expect(again).resolves.toEqual({ filled: false, length: 0 });
    unsubscribe();
  });

  it("hides a filled secret wherever the page echoes it", async () => {
    const SECRET = "correct-horse-battery";
    const c = await manager.get("echo");
    const page = await c.navigate(`${site.base}/reveal`);
    const asked = c.requestSecret(refOf(page.snapshot, 'textbox "Password"'), "The password");
    await waitFor(() => manager.status("echo").secret !== undefined);
    const request = manager.status("echo").secret as NonNullable<ComputerStatus["secret"]>;
    await manager.handle("echo", { type: "secret", requestId: request.id, value: SECRET });
    await expect(asked).resolves.toEqual({ filled: true, length: SECRET.length });

    // The page writes the value into its own text as it is typed.
    const typed = await c.snapshot();
    expect(typed.snapshot).toContain("Strength of [hidden: sensitive field]: weak");
    // "Show password" rebuilds the field without the mark, retitles the page and shows a dialog.
    const shown = await c.click(refOf(typed.snapshot, 'button "Show password"'));
    const field = refOf(shown.snapshot, 'textbox "Password"');
    expect(shown.snapshot).toContain(`textbox "Password" [ref=${field}]: [hidden: sensitive field]`);
    expect(shown.snapshot).toContain(
      '[The page showed a alert box: "Your password is [hidden: sensitive field]"',
    );
    expect(shown.title).toBe("Hi [hidden: sensitive field]");
    expect(await c.describe(field)).toEqual({ role: "textbox", name: "Password", sensitive: true });
    // An address that carries it inside a longer value.
    const next = await c.click(refOf(shown.snapshot, 'link "Go on"'));
    expect(next.url).toBe(`${site.base}/next?note=xhiddeny`);

    const everything = [
      typed.snapshot,
      shown.snapshot,
      shown.title,
      next.snapshot,
      next.url,
      JSON.stringify(c.status()),
      JSON.stringify(c.activity(500)),
      JSON.stringify(audit.events),
    ].join("\n");
    expect(everything).not.toContain(SECRET);
  });

  it("hides a filled secret the page writes into links and text, encoded as addresses are", async () => {
    const SECRET = "p@ss word!";
    const c = await manager.get("encode");
    const page = await c.navigate(`${site.base}/encode`);
    const code = refOf(page.snapshot, 'textbox "Code"');
    await expect(fillSecret(manager, "encode", code, SECRET)).resolves.toMatchObject({ filled: true });
    // A GET form sends it as code=p%40ss+word%21; the page puts that into a link and its text, and
    // builds another link with encodeURIComponent (p%40ss%20word!).
    const sent = await c.click(refOf((await c.snapshot()).snapshot, 'button "Verify"'));
    expect(sent.url).toBe(`${site.base}/encoded?code=hidden`);
    expect(sent.snapshot).toContain("[url=/encoded?code=hidden&page=2]");
    expect(sent.snapshot).toContain("[url=/next?q=hidden]");
    expect(sent.snapshot).toContain(`You asked for ?code=${MASKED_VALUE}`);
    const everything = [sent.snapshot, sent.url, JSON.stringify(c.status()), JSON.stringify(c.activity(500))];
    for (const form of [SECRET, encodeURIComponent(SECRET), "p%40ss+word%21", "p%40ss"]) {
      expect(everything.join("\n"), form).not.toContain(form);
    }
  });

  it("puts a secret only into a field of the site the person is shown", async () => {
    const c = await manager.get("vault");
    // A frame from another site on the page: the person would see the page's host, not the frame's.
    const cross = await c.navigate(`${site.base}/cross-frame`);
    const refused = await refusal(() =>
      c.requestSecret(refOf(cross.snapshot, 'textbox "One-time code"'), "The code"),
    );
    expect(refused.code).toBe("blocked");
    expect(refused.message).toBe(
      `That field belongs to localhost:${site.port}, not 127.0.0.1:${site.port}. Steward does not put secrets into fields from another site. Ask the person to take the wheel instead.`,
    );
    expect(manager.status("vault").secret).toBeUndefined();

    // A frame from the page's own site is fine.
    const framed = await c.navigate(`${site.base}/framed`);
    const asked = c.requestSecret(refOf(framed.snapshot, 'textbox "Passwort"'), "The password");
    await waitFor(() => manager.status("vault").secret !== undefined);
    const request = manager.status("vault").secret as NonNullable<ComputerStatus["secret"]>;
    expect(request.host).toBe(`127.0.0.1:${site.port}`);
    await manager.handle("vault", { type: "secret.cancel", requestId: request.id });
    await expect(asked).resolves.toEqual({ filled: false, length: 0 });
  });

  it("streams the screen while someone watches", async () => {
    const c = await manager.get("screen");
    const frames: Frame[] = [];
    const statuses: ComputerStatus[] = [];
    const unsubscribe = manager.subscribe("screen", (m) => {
      if (m.type === "frame") frames.push(m);
      if (m.type === "status") statuses.push(m.status);
    });
    expect(statuses[0]).toMatchObject({ agentId: "screen", running: true });

    await c.navigate(`${site.base}/animate`);
    await waitFor(() => frames.length > 0);
    const frame = frames[0] as Frame;
    expect(frame).toMatchObject({ type: "frame", mime: "image/jpeg", width: 1280, height: 800 });
    expect(Buffer.from(frame.data, "base64").subarray(0, 2).toString("hex")).toBe("ffd8");
    expect(statuses.some((s) => s.url === `${site.base}/animate` && s.title === "Animate")).toBe(true);

    // A second watcher gets the latest frame straight away.
    const late: ComputerServerMessage[] = [];
    const unsubscribeLate = manager.subscribe("screen", (m) => late.push(m));
    expect(late.map((m) => m.type)).toEqual(["status", "frame"]);
    unsubscribeLate();
    unsubscribe();
  });

  it("closes a browser nothing uses, and starts it again on the next use", async () => {
    const c = await napping.get("napper");
    await c.navigate(`${site.base}/next`);
    // Someone watching the screen keeps it open.
    const unsubscribe = napping.subscribe("napper", () => {});
    await delay(2_500);
    expect(napping.status("napper").running).toBe(true);
    unsubscribe();
    await waitFor(() => !napping.status("napper").running, 10_000);
    expect(c.activity().at(-1)?.text).toBe(
      "Closed the browser after 1 s with nothing to do; it starts again when needed",
    );
    // Not a close on purpose: the next action starts it again, and the model hears why the page went.
    const look = await c.navigate(`${site.base}/form`);
    expect(look.snapshot.split("\n")[0]).toBe(`[${MESSAGES.idleRestarted}]`);
    expect(napping.status("napper")).toMatchObject({ running: true, url: `${site.base}/form` });
  });

  it("closes the least recently used idle browser to stay under the limit", async () => {
    const first = await napping.get("napper");
    expect(first.status().running).toBe(true);
    await napping.get("second");
    expect(napping.status("second").running).toBe(true);
    expect(napping.status("napper").running).toBe(false);
    expect(first.activity().at(-1)?.text).toBe(
      "Closed the browser to make room for another one; it starts again when needed",
    );
  });

  it("still hides a filled secret the page kept, after the browser closed when idle", async () => {
    const SECRET = "sk-test-abcdef123456";
    const c = await napping.get("keeper");
    // Watched while the secret is filled, so it cannot close half way.
    const unsubscribe = napping.subscribe("keeper", () => {});
    const page = await c.navigate(`${site.base}/keep`);
    const key = refOf(page.snapshot, 'textbox "API key"');
    await expect(fillSecret(napping, "keeper", key, SECRET)).resolves.toMatchObject({ filled: true });
    await c.click(refOf((await c.snapshot()).snapshot, 'button "Save"'));
    expect((await c.navigate(`${site.base}/show`)).snapshot).toContain(`Your key: ${MASKED_VALUE}`);
    unsubscribe();
    await waitFor(() => !napping.status("keeper").running, 10_000);
    // The profile kept the value, so the page still shows it after the browser starts again.
    const again = await c.navigate(`${site.base}/show`);
    expect(again.snapshot).toContain(`Your key: ${MASKED_VALUE}`);
    expect(again.snapshot).not.toContain(SECRET);
  });

  it("resets by closing and starting again", async () => {
    const status = await manager.reset("screen");
    expect(status).toMatchObject({ agentId: "screen", running: true, controller: "agent" });
    const c = await manager.get("screen");
    expect((await c.snapshot()).url).toBe("about:blank");
  });

  it("stays closed after a close until it is asked to start", async () => {
    const c = await manager.get("screen");
    await c.close();
    expect(c.status().running).toBe(false);
    expect((await refusal(() => c.snapshot())).code).toBe("closed");
    await manager.handle("screen", { type: "take" });
    expect(manager.status("screen")).toMatchObject({ running: false, controller: "agent" });
    await manager.get("screen");
    expect(manager.status("screen").running).toBe(true);
  });
});
