// Descriptions adapted from openbot/app/src/lib/copilot/computer-tools.tsx (MIT, CopilotKit)
import { builtin } from "./define.ts";
import { INTENT, object, readOptionalString, readString, str } from "./schema.ts";
import type { StewardTool, ToolContext } from "./types.ts";

/** Reads past this are cut; the model is told so and can ask for less. */
const READ_LIMIT_BYTES = 64_000;

async function computer(ctx: ToolContext) {
  return ctx.services.computers.get(ctx.agentId);
}

export const fileList = builtin("file_list", {
  description:
    "List the files and folders in your workspace, with sizes. Call this before reading a file whose exact name you are not sure of. Never guess a file name.",
  parameters: object({
    dir: str("Optional folder inside the workspace. Leave it out for the whole workspace."),
  }),
  toGateCall: async (args) => ({ target: { path: readOptionalString(args, "dir") ?? "." } }),
  execute: async (args, ctx) => (await computer(ctx)).listFiles(readOptionalString(args, "dir")),
});

export const fileRead = builtin("file_read", {
  description:
    "Read a text file from your workspace. Paths are relative to the workspace, such as notes.md or reports/august.csv. Your workspace survives between conversations, so use it to pick up notes you made before.",
  parameters: object({ path: str("The file's path inside the workspace.") }, ["path"]),
  toGateCall: async (args) => ({ target: { path: readString(args, "path") } }),
  execute: async (args, ctx) => {
    const path = readString(args, "path");
    const text = await (await computer(ctx)).readFile(path, { maxBytes: READ_LIMIT_BYTES });
    return { path, text, truncated: Buffer.byteLength(text, "utf8") >= READ_LIMIT_BYTES };
  },
});

export const fileWrite = builtin("file_write", {
  description:
    "Save a text file in your workspace so you have it later. Paths are relative to the workspace and folders are made as needed. This replaces the file if it already exists. For something the person will read or present, use make_page instead.",
  parameters: object(
    {
      path: str("The file's path inside the workspace, such as notes/plan.md."),
      content: str("The whole text of the file."),
      intent: INTENT,
    },
    ["path", "content"],
  ),
  toGateCall: async (args) => ({ target: { path: readString(args, "path") } }),
  execute: async (args, ctx) => {
    const content = typeof args.content === "string" ? args.content : "";
    return (await computer(ctx)).writeFile(readString(args, "path"), content);
  },
});

export const shellRun = builtin("shell_run", {
  description:
    "Run a shell command in your workspace, for work the browser and file tools cannot do, such as processing a file you saved or running a script. Commands run in bash, so pipes and && work, and the working directory is your workspace. Long output keeps only its end, and a command that runs too long is stopped. The person is asked before each command unless they have allowed it.",
  parameters: object({ command: str("The command to run."), intent: INTENT }, ["command"]),
  toGateCall: async (args) => ({ target: { command: readString(args, "command", { max: 8000 }) } }),
  execute: async (args, ctx) =>
    (await computer(ctx)).runShell(readString(args, "command", { max: 8000 }), { signal: ctx.signal }),
});

export const FILE_TOOLS: StewardTool[] = [fileList, fileRead, fileWrite, shellRun];
