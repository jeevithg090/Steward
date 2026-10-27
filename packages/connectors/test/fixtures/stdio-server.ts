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

await server.connect(new StdioServerTransport());
