/**
 * The computer against real Chromium (Playwright 1.64's cached build) and a local test site.
 * Only 127.0.0.1 is visited; the managers that visit it opt in to private hosts.
 */
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AuditEvent,
  AuditLog,
  ComputerManager,
  ComputerServerMessage,
  ComputerStatus,
} from "@steward/shared";
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

let site: TestSite;
let dataDir: string;
let audit: ReturnType<typeof fakeAudit>;
let manager: ComputerManager;
let strict: ComputerManager;

beforeAll(async () => {
  site = await startSite();
  dataDir = await mkdtemp(join(tmpdir(), "steward-computer-"));
  audit = fakeAudit();
  manager = createComputerManager({ dataDir, allowPrivateHosts: true, audit });
  strict = createComputerManager({ dataDir: join(dataDir, "strict") });
});

afterAll(async () => {
  await manager?.closeAll();
  await strict?.closeAll();
  await site?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe("the computer, in real Chromium", () => {
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
    const searched = await c.type(refOf(saved.snapshot, 'textbox "Search"'), "cheap flights", {
      submit: true,
    });
    expect(searched.snapshot).toContain("Searched: cheap flights");

    expect(await c.describe(refOf(searched.snapshot, 'button "Save"'))).toEqual({
      role: "button",
      name: "Save",
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
    await c.click(refOf(page.snapshot, 'link "Download the report"'));
    await waitFor(() => c.activity().some((a) => a.text === "Downloaded downloads/report.csv (19 bytes)"));
    expect(await c.readFile("downloads/report.csv")).toBe("month,total\naug,42\n");

    const after = await c.click(refOf((await c.snapshot()).snapshot, 'button "Delete everything"'));
    expect(after.snapshot.split("\n")[0]).toBe(
      '[The page showed a confirm box: "Delete everything?". Steward dismissed it.]',
    );
    expect(after.snapshot).toContain("- paragraph: kept");
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
    expect(ran).toMatchObject({
      exitCode: 0,
      timedOut: false,
      stdout: `${workspace}\n# Today\n${workspace}\n`,
    });
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

  it("resets by closing and starting again, and stays closed until asked", async () => {
    const status = await manager.reset("screen");
    expect(status).toMatchObject({ agentId: "screen", running: true, controller: "agent" });
    const c = await manager.get("screen");
    expect((await c.snapshot()).url).toBe("about:blank");

    await c.close();
    expect(c.status().running).toBe(false);
    expect((await refusal(() => c.snapshot())).code).toBe("closed");
    await manager.handle("screen", { type: "take" });
    expect(manager.status("screen")).toMatchObject({ running: false, controller: "agent" });
    await manager.get("screen");
    expect(manager.status("screen").running).toBe(true);
  });
});
