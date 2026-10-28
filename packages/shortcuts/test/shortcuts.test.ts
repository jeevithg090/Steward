import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  Builder,
  buildLauncher,
  buildStewardShortcut,
  Condition,
  isSigned,
  PAIR_URL_PATTERN,
  type PlistDict,
  PlistError,
  parsePlist,
  resetIds,
  type ShortcutsRunner,
  SigningError,
  STORAGE_PATH,
  shortcutHeaders,
  sign,
  text,
  toXmlPlist,
  VERSION_HEADER,
  validate,
  variable,
} from "../src/index.ts";

const ids = (wf: PlistDict) =>
  (wf.WFWorkflowActions as PlistDict[]).map((a) =>
    String(a.WFWorkflowActionIdentifier).replace("is.workflow.actions.", ""),
  );

describe("plist", () => {
  it("round-trips nested values through XML", () => {
    const value: PlistDict = {
      name: 'Steward & "friends" <ok>',
      count: 3,
      ratio: 0.5,
      on: true,
      off: false,
      when: new Date("2026-10-28T09:00:00Z"),
      bytes: new Uint8Array([0, 1, 254, 255]),
      empty: [],
      nothing: {},
      blank: "",
      list: ["a", { deep: ["x", 1] }],
      variable: "before ￼ after",
    };
    const back = parsePlist(toXmlPlist(value)) as PlistDict;
    expect(back).toEqual(value);
  });

  it("refuses what is not a plist, or holds a key twice", () => {
    expect(() => parsePlist("<html></html>")).toThrow(PlistError);
    expect(() =>
      parsePlist("<plist><dict><key>a</key><string>1</string><key>a</key><string>2</string></dict></plist>"),
    ).toThrow(/twice/);
    expect(() => parsePlist("<plist><dict><key>a</key></dict></plist>")).toThrow(PlistError);
    expect(() => parsePlist("<plist><integer>1.5</integer></plist>")).toThrow(PlistError);
  });

  it("refuses characters XML cannot carry", () => {
    expect(() => toXmlPlist({ bad: "a\u0001b" })).toThrow(/XML/);
  });
});

describe("builder", () => {
  it("counts variable positions in UTF-16 units, as Shortcuts does", () => {
    const t = text("🚆 at ", variable("Time"), "!") as {
      Value: { string: string; attachmentsByRange: PlistDict };
    };
    expect(Object.keys(t.Value.attachmentsByRange)).toEqual(["{6, 1}"]);
    expect(t.Value.string).toBe("🚆 at ￼!");
  });

  it("closes every block it opens", () => {
    resetIds(true);
    const b = new Builder();
    const x = b.text("hi");
    const g = b.if(x, Condition.hasAnyValue);
    b.show(x);
    b.otherwise(g);
    b.endIf(g);
    const m = b.menu(text("Pick"), ["A", "B"]);
    m.item("A");
    m.item("B");
    m.end();
    expect(() => m.item("C")).toThrow();
    expect(
      validate({
        WFWorkflowClientVersion: "1",
        WFWorkflowMinimumClientVersion: 1,
        WFWorkflowIcon: {},
        WFWorkflowActions: b.actions,
      }).ok,
    ).toBe(true);
    resetIds(false);
  });
});

describe("validate", () => {
  const base = (actions: PlistDict[]) => ({
    WFWorkflowClientVersion: "2700.0.4",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowIcon: {},
    WFWorkflowActions: actions,
  });
  const a = (id: string, params: PlistDict = {}) => ({
    WFWorkflowActionIdentifier: `is.workflow.actions.${id}`,
    WFWorkflowActionParameters: params,
  });

  it("finds unknown actions, open blocks, crossed blocks and outputs used too early", () => {
    expect(validate(base([a("not.a.thing")])).problems.join(" ")).toMatch(/not a known action/);
    expect(
      validate(base([a("conditional", { GroupingIdentifier: "G", WFControlFlowMode: 0 })])).problems.join(
        " ",
      ),
    ).toMatch(/never closes/);
    const crossed = validate(
      base([
        a("conditional", { GroupingIdentifier: "A", WFControlFlowMode: 0 }),
        a("repeat.each", { GroupingIdentifier: "B", WFControlFlowMode: 0 }),
        a("conditional", { GroupingIdentifier: "A", WFControlFlowMode: 2 }),
        a("repeat.each", { GroupingIdentifier: "B", WFControlFlowMode: 2 }),
      ]),
    );
    expect(crossed.problems.join(" ")).toMatch(/innermost/);
    const early = validate(
      base([
        a("showresult", { Text: text({ Type: "ActionOutput", OutputUUID: "LATER", OutputName: "Text" }) }),
        a("gettext", { UUID: "LATER", WFTextActionText: text("x") }),
      ]),
    );
    expect(early.problems.join(" ")).toMatch(/does not come before/);
    expect(
      validate(base([a("gettext", { UUID: "X" }), a("gettext", { UUID: "X" })])).problems.join(" "),
    ).toMatch(/repeats/);
  });

  it("reads XML text too, and says when it is not a plist", () => {
    expect(validate("not xml").ok).toBe(false);
    expect(validate(toXmlPlist(base([a("gettext", { UUID: "X", WFTextActionText: text("x") })]))).ok).toBe(
      true,
    );
  });
});

describe("the Steward shortcut", () => {
  it("is valid, uses only known actions, and holds no address or key", () => {
    const wf = buildStewardShortcut();
    const v = validate(wf);
    expect(v.problems).toEqual([]);
    expect(v.actions).toBeGreaterThan(50);
    const xml = toXmlPlist(wf);
    expect(xml).not.toMatch(/stw_dev_/);
    expect(xml).not.toMatch(/https:\/\/(?!\[)[a-z0-9-]+\.(ts\.net|example)/i);
    expect(xml).toContain(STORAGE_PATH);
    expect(xml).toContain(VERSION_HEADER);
    expect(xml).toContain("^steward-pair:1:");
    expect(wf.WFWorkflowTypes).toEqual(["ActionExtension"]);
  });

  it("asks before it pairs: the Pair menu comes before the call to /device/pair", () => {
    const wf = buildStewardShortcut();
    const actions = wf.WFWorkflowActions as PlistDict[];
    const xmlOf = (x: PlistDict) => toXmlPlist(x);
    const menu = actions.findIndex((x) => xmlOf(x).includes("<string>Pair</string>"));
    const pair = actions.findIndex((x) => xmlOf(x).includes("/device/pair"));
    expect(menu).toBeGreaterThan(-1);
    expect(pair).toBeGreaterThan(menu);
    // It checks the address before it shows the menu.
    const check = actions.findIndex((x) => xmlOf(x).includes("https://[A-Za-z0-9.-]+"));
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(menu);
  });

  it("runs itself again for a choice or an answer, and opens links", () => {
    const list = ids(buildStewardShortcut());
    expect(list).toEqual(
      expect.arrayContaining(["choosefromlist", "ask", "urlencode", "runworkflow", "openurl", "downloadurl"]),
    );
    expect(list.filter((x) => x === "downloadurl")).toHaveLength(2);
  });

  it("puts the address and key in the personal file only", () => {
    const wf = buildStewardShortcut({
      personal: { url: "https://mac.tail1234.ts.net", token: "stw_dev_abc", name: "Sam's Mac" },
    });
    expect(validate(wf).ok).toBe(true);
    const xml = toXmlPlist(wf);
    expect(xml).toContain("stw_dev_abc");
    expect(xml).toContain("https://mac.tail1234.ts.net");
    expect(xml).not.toContain("^steward-pair:1:");
  });

  it("accepts https anywhere and plain http only at home", () => {
    const ok = new RegExp(PAIR_URL_PATTERN);
    for (const u of [
      "https://mac.tail1234.ts.net",
      "https://steward.example.com:8443",
      "http://sams-mac.local:8788",
      "http://192.168.1.20:8788",
      "http://100.101.102.103:8788",
      "http://172.20.0.4:8788",
    ])
      expect(ok.test(u), u).toBe(true);
    for (const u of [
      "http://evil.example",
      "http://8.8.8.8:8788",
      "https://x.example/path",
      "javascript:alert(1)",
      "http://172.32.0.1",
      "https://mac.example.com@evil",
    ])
      expect(ok.test(u), u).toBe(false);
  });
});

describe("launchers", () => {
  it("run Steward with action:<id> and nothing else", () => {
    const wf = buildLauncher("routine:rtn_123");
    expect(ids(wf)).toEqual(["comment", "runworkflow"]);
    expect(toXmlPlist(wf)).toContain("action:routine:rtn_123");
    expect(validate(wf).ok).toBe(true);
    expect(() => buildLauncher("bad id")).toThrow();
  });
});

describe("sign", () => {
  const generic = buildStewardShortcut();
  const personal = buildStewardShortcut({
    personal: { url: "https://m.ts.net", token: "stw_dev_x", name: "Mac" },
  });

  /** A pretend `shortcuts` that writes a file starting with these bytes. */
  const fake = (results: { code: number; stderr?: string; header?: string }[]) => {
    const calls: string[][] = [];
    const run: ShortcutsRunner = async (args) => {
      calls.push(args);
      const r = results[Math.min(calls.length - 1, results.length - 1)]!;
      if (r.code === 0)
        writeFileSync(args[args.indexOf("--output") + 1]!, `${r.header ?? "AEA1"}rest-of-file`);
      return { code: r.code, stderr: r.stderr ?? "" };
    };
    return { run, calls };
  };

  it("returns null off macOS, without running anything", async () => {
    const { run, calls } = fake([{ code: 0 }]);
    expect(await sign(generic, "anyone", { platform: "linux", run })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("never signs a file with a key in it for anyone", async () => {
    const { run, calls } = fake([{ code: 0 }]);
    await expect(sign(personal, "anyone", { platform: "darwin", run })).rejects.toMatchObject({
      problem: "secret",
    });
    expect(calls).toHaveLength(0);
    expect(await sign(personal, "people-who-know-me", { platform: "darwin", run })).toBeInstanceOf(
      Uint8Array,
    );
  });

  it("retries a transient failure, then checks the AEA1 header", async () => {
    const { run, calls } = fake([{ code: 1, stderr: "Error: Failed to modify some records" }, { code: 0 }]);
    const bytes = await sign(generic, "anyone", { platform: "darwin", run });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(expect.arrayContaining(["sign", "--mode", "anyone", "--input", "--output"]));
    expect(isSigned(bytes!)).toBe(true);
  });

  it("gives up after three tries, with the last error and never the plist", async () => {
    const { run, calls } = fake([{ code: 1, stderr: "Error: boom" }]);
    const err = (await sign(generic, "anyone", { platform: "darwin", run }).catch((e) => e)) as SigningError;
    expect(calls).toHaveLength(3);
    expect(err.problem).toBe("failed");
    expect(err.message).toMatch(/boom/);
    expect(err.message).not.toMatch(/WFWorkflow/);
  });

  it("refuses output that is not signed", async () => {
    const { run } = fake([{ code: 0, header: "bpli" }]);
    await expect(sign(generic, "anyone", { platform: "darwin", run })).rejects.toMatchObject({
      problem: "failed",
    });
  });

  it("says plainly when the Mac is not signed into iCloud, and does not retry", async () => {
    const { run, calls } = fake([
      { code: 1, stderr: "Error: In order to do this, you must be signed into iCloud." },
    ]);
    const err = (await sign(generic, "anyone", { platform: "darwin", run }).catch((e) => e)) as SigningError;
    expect(err).toBeInstanceOf(SigningError);
    expect(err.problem).toBe("icloud");
    expect(err.message).toMatch(/signed into iCloud/);
    expect(calls).toHaveLength(1);
  });

  it("serves files as downloads, and personal ones never cached", () => {
    expect(shortcutHeaders("Steward", false)).toMatchObject({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="Steward.shortcut"',
    });
    expect(shortcutHeaders('Ste"ward/../x', true)["Cache-Control"]).toBe("no-store");
    expect(shortcutHeaders('Ste"ward/../x', true)["Content-Disposition"]).toBe(
      'attachment; filename="Steward..x.shortcut"',
    );
  });
});
