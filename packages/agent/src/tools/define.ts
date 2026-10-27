import { type BuiltinToolName, TOOLS } from "@steward/shared";
import type { StewardTool } from "./types.ts";

type BuiltinSpec = Pick<StewardTool, "description" | "parameters" | "toGateCall" | "execute">;

/**
 * Declares a built-in tool. Kind, surface and taint come from the shared catalogue, never from here,
 * so the gateway's presets and the agent can never disagree about what a tool is.
 */
export function builtin(name: BuiltinToolName, spec: BuiltinSpec): StewardTool {
  const meta = TOOLS[name];
  return {
    name,
    kind: meta.kind,
    surface: meta.surface,
    taints: meta.taints,
    source: "builtin",
    ...spec,
  };
}
