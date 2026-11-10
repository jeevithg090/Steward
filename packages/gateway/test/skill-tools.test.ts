import { describe, expect, it } from "vitest";
import { summarize } from "../src/summary.ts";
import { toolInfo } from "../src/target.ts";
import { gateCall, setup } from "./helpers.ts";

describe("showing a skill to save", () => {
  it("only draws a card, so it runs even after outside content", () => {
    const { gw } = setup();
    const args = { name: "weekly-review", description: "My week", instructions: "Sum up my week." };
    expect(gw.governance.dryRun(gateCall("show_skill", args)).effect).toBe("allow");
    expect(gw.governance.dryRun(gateCall("show_skill", args, { tainted: true })).effect).toBe("allow");
    expect(summarize({ tool: toolInfo("show_skill"), args, target: {} })).toBe(
      "Show a skill to save: /weekly-review",
    );
  });
});
