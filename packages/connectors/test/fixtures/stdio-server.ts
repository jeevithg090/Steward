/**
 * A tiny MCP server over stdio, started by the manager tests with `node <this file>`. It reports
 * what the process can see, so the tests can check the environment Steward hands a server.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "steward-test-fixture", version: "1.0.0" });

server.registerTool(
  "env_keys",
  { description: "Names of the environment variables this server sees." },
  async () => ({
    content: [{ type: "text", text: JSON.stringify(Object.keys(process.env).sort()) }],
  }),
);

server.registerTool("cwd", { description: "The folder this server runs in." }, async () => ({
  content: [{ type: "text", text: process.cwd() }],
}));

server.registerTool(
  "echo",
  { description: "Says the text back.", inputSchema: { text: z.string() } },
  async ({ text }) => ({
    content: [{ type: "text", text }],
  }),
);

server.registerTool(
  "env_check",
  {
    description: "A variable's value, reversed, so a test can see it arrived without Steward hiding it.",
    inputSchema: { name: z.string() },
  },
  async ({ name }) => ({
    content: [{ type: "text", text: process.env[name]?.split("").reverse().join("") ?? "(unset)" }],
  }),
);

server.registerTool(
  "env_echo",
  { description: "A variable's value as it is.", inputSchema: { name: z.string() } },
  async ({ name }) => ({ content: [{ type: "text", text: process.env[name] ?? "(unset)" }] }),
);

server.registerTool("crash", { description: "Writes a variable to stderr and exits." }, async () => {
  process.stderr.write(`fatal: bad token ${process.env.STEWARD_FIXTURE_TOKEN ?? ""}\n`);
  process.exit(1);
});

await server.connect(new StdioServerTransport());
