import { describe, expect, it } from "vitest";
import { summarize } from "../src/summary.ts";
import { toolInfo } from "../src/target.ts";
import { gateCall, setup } from "./helpers.ts";

const decide = (name: string, args: Record<string, unknown>, tainted = false) =>
  setup().gw.governance.dryRun(gateCall(name, args, { tainted }));

describe("changing routines by asking", () => {
  it("lists without asking, and changes like routine_create: it asks after untrusted content", () => {
    expect(decide("routine_list", {}).effect).toBe("allow");
    const change = { id: "rtn_1", title: "Morning brief", schedule: "0 9 * * 1-5" };
    expect(decide("routine_update", change).effect).toBe("allow");
    const tainted = decide("routine_update", change, true);
    expect(tainted).toMatchObject({ effect: "ask", rule: { id: "default:taint-persists" } });
  });

  it("always asks before deleting one", () => {
    expect(decide("routine_delete", { id: "rtn_1", title: "Morning brief" })).toMatchObject({
      effect: "ask",
      rule: { id: "default:delete-asks" },
    });
  });

  it("names the routine and the change on the card", () => {
    const sentence = (name: string, args: Record<string, unknown>) =>
      summarize({ tool: toolInfo(name), args, target: {} });
    expect(sentence("routine_update", { id: "rtn_1", title: "Morning brief", schedule: "0 9 * * 1-5" })).toBe(
      "Change the routine 'Morning brief': run it at 0 9 * * 1-5",
    );
    expect(sentence("routine_update", { id: "rtn_1", title: "Morning brief", enabled: false })).toBe(
      "Change the routine 'Morning brief': pause it",
    );
    expect(sentence("routine_delete", { id: "rtn_1", title: "Morning brief" })).toBe(
      "Delete the routine 'Morning brief'",
    );
    expect(sentence("routine_list", {})).toBe("Look at your routines");
  });
});
