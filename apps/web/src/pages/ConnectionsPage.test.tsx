import type { ConnectionsInfo, McpServerInfo } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServerDetail } from "@/lib/api.ts";
import { type FakeRequest, mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { ConnectionsPage } from "./ConnectionsPage.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Tool = McpServerInfo["tools"][number];
/** A made-up fingerprint for a tool, as the manager would send it. */
const FINGERPRINT = (name: string) =>
  name
    .padEnd(64, "0")
    .replace(/[^0-9a-f]/g, "f")
    .slice(0, 64);
const tool = (over: Partial<Tool> & Pick<Tool, "name">): Tool => ({
  description: `The ${over.name} tool.`,
  fingerprint: FINGERPRINT(over.name),
  granted: true,
  kind: "write",
  offerable: true,
  ...over,
});

function notes(over: Partial<McpServerInfo> = {}): McpServerInfo {
  return {
    id: "notes",
    name: "Notes",
    transport: "stdio",
    status: "connected",
    command: "npx",
    args: ["-y", "notes-server"],
    envNames: ["NOTES_TOKEN"],
    tools: [
      tool({ name: "search_notes", kind: "read" }),
      tool({ name: "post_note", kind: "send" }),
      tool({ name: "erase_note", kind: "delete", destructive: true }),
      tool({ name: "lookup", kind: "read", changed: true }),
      tool({ name: "draft_note", granted: false }),
      tool({
        name: "export.all",
        granted: false,
        offerable: false,
        why: "Its name has characters models don't accept. Only letters, digits, _ and - work.",
      }),
    ],
    ...over,
  };
}

/** A server that answers the Connections page with `servers`, and records what the page sends. */
function serve(servers: McpServerInfo[]) {
  return mockFetch((req: FakeRequest) => {
    if (req.path === "/api/connections" && req.method === "GET") {
      const info: ConnectionsInfo = {
        mail: { connected: true, label: "Demo inbox", isDemo: true },
        mcp: servers,
        builtin: [],
      };
      return { body: info };
    }
    if (req.path === "/api/connections/mcp/notes" && req.method === "PUT") return { body: servers[0] };
    if (req.path === "/api/connections/mcp/notes/reconnect")
      return { body: { ...servers[0], status: "connected" } };
    if (req.path === "/api/connections/mcp" && req.method === "POST") {
      const body = req.body as { id: string; name: string };
      return { status: 201, body: { ...notes(), id: body.id, name: body.name } };
    }
    return undefined;
  });
}

const card = () => screen.findByRole("article", { name: /Notes/ });
const lastPut = (calls: FakeRequest[]) => calls.filter((c) => c.method === "PUT").at(-1)?.body;

describe("ConnectionsPage: MCP servers", () => {
  it("offers four kinds, and only deleting or sending for a tool its server calls destructive", async () => {
    const server = serve([notes()]);
    renderWithProviders(<ConnectionsPage />);
    const notesCard = await card();
    const kinds = (name: string) =>
      within(within(notesCard).getByRole("combobox", { name: `What ${name} does` }))
        .getAllByRole("option")
        .map((o) => o.textContent);
    expect(kinds("search_notes")).toEqual([
      "Only reads",
      "Changes things",
      "Sends or posts",
      "Deletes things",
    ]);
    expect(kinds("erase_note")).toEqual(["Sends or posts", "Deletes things"]);
    expect(within(notesCard).getByText(/Its server says it can delete or overwrite things/)).toBeTruthy();

    fireEvent.change(within(notesCard).getByRole("combobox", { name: "What search_notes does" }), {
      target: { value: "send" },
    });
    await waitFor(() => expect(lastPut(server.calls)).toBeDefined());
    expect(lastPut(server.calls)).toMatchObject({
      reads: ["lookup"],
      sends: ["post_note", "search_notes"],
      deletes: [],
    });
    // Saving a switch never sends secrets: the saved ones stay.
    expect(lastPut(server.calls)).not.toHaveProperty("env");
  });

  it("shows a tool its server changed, and allows it again only when asked", async () => {
    const server = serve([notes()]);
    renderWithProviders(<ConnectionsPage />);
    const notesCard = await card();
    expect(within(notesCard).getByText("Changed since you allowed it")).toBeTruthy();
    fireEvent.click(within(notesCard).getByRole("button", { name: /Allow again.*lookup/ }));
    // Pinned to what the person just read, not to whatever the server says by the time it saves.
    await waitFor(() =>
      expect(lastPut(server.calls)).toMatchObject({
        allowAgain: ["lookup"],
        seen: { lookup: FINGERPRINT("lookup") },
      }),
    );
  });

  it("switches a tool on as the person read it, and sends nothing it saw when switching one off", async () => {
    const server = serve([notes()]);
    renderWithProviders(<ConnectionsPage />);
    const notesCard = await card();
    fireEvent.click(within(notesCard).getByRole("switch", { name: /draft_note/ }));
    await waitFor(() => expect(lastPut(server.calls)).toBeDefined());
    expect(lastPut(server.calls)).toMatchObject({
      granted: expect.arrayContaining(["draft_note"]),
      seen: { draft_note: FINGERPRINT("draft_note") },
    });
    expect(lastPut(server.calls)).not.toHaveProperty("allowAgain");

    fireEvent.click(within(notesCard).getByRole("switch", { name: /search_notes/ }));
    await waitFor(() => expect(server.calls.filter((c) => c.method === "PUT")).toHaveLength(2));
    expect(lastPut(server.calls)).not.toHaveProperty("seen");
  });

  it("says why a tool can't be offered and won't switch it on", async () => {
    serve([notes()]);
    renderWithProviders(<ConnectionsPage />);
    const notesCard = await card();
    expect(within(notesCard).getByText(/Steward can't offer it: Its name has characters/)).toBeTruthy();
    const toggle = within(notesCard).getByRole("switch", { name: /export\.all/ }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
  });

  it("offers Try again for a server that didn't connect, and shows one still starting as connecting", async () => {
    const server = serve([
      notes({ status: "error", error: "Couldn't start \"npx\": the program wasn't found.", tools: [] }),
    ]);
    renderWithProviders(<ConnectionsPage />);
    const notesCard = await card();
    fireEvent.click(within(notesCard).getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(server.calls.some((c) => c.path === "/api/connections/mcp/notes/reconnect")).toBe(true),
    );
    cleanup();

    serve([notes({ status: "connecting", tools: [] })]);
    renderWithProviders(<ConnectionsPage />);
    const starting = await card();
    expect(within(starting).getByText("Connecting…")).toBeTruthy();
    expect(within(starting).queryByText("Off")).toBeNull();
  });

  it("names saved secrets without their values, and sends new ones only when added", async () => {
    const server = serve([notes()]);
    renderWithProviders(<ConnectionsPage />);
    const notesCard = await card();
    expect(within(notesCard).getByText("Secret settings saved: NOTES_TOKEN.")).toBeTruthy();

    const form = screen.getByRole("region", { name: "Add an app" });
    fireEvent.change(within(form).getByLabelText(/^Name/), { target: { value: "GitHub" } });
    fireEvent.change(within(form).getByLabelText(/^Short id/), { target: { value: "github" } });
    fireEvent.change(within(form).getByLabelText(/^Program/), { target: { value: "npx" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add a secret setting" }));
    fireEvent.change(within(form).getByLabelText("Name 1"), { target: { value: "github_token" } });
    const value = within(form).getByLabelText("Value 1") as HTMLInputElement;
    expect(value.type).toBe("password");
    fireEvent.change(value, { target: { value: "ghp_example" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add app" }));
    await waitFor(() => expect(server.calls.some((c) => c.method === "POST")).toBe(true));
    expect(server.calls.find((c) => c.method === "POST")?.body).toMatchObject({
      id: "github",
      env: { GITHUB_TOKEN: "ghp_example" },
    });
  });
});

const NOTES: McpServerDetail = {
  id: "notes",
  name: "My notes",
  transport: "stdio",
  status: "connected",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/My Notes"],
  tools: [],
};

function serveApps(
  mail = { connected: true, label: "Demo inbox", isDemo: true },
  mcp: McpServerDetail[] = [],
) {
  return mockFetch((req) => {
    if (req.path === "/api/connections") return { body: { mail, mcp, builtin: [] } };
    if (req.path === "/api/connections/mcp" && req.method === "POST") {
      return { status: 201, body: { ...NOTES, ...(req.body as object), tools: [] } };
    }
    return undefined;
  });
}

const field = (name: RegExp) => screen.getByRole("textbox", { name }) as HTMLInputElement;

async function fill(args: string) {
  await screen.findByRole("heading", { name: "Add an app" });
  fireEvent.change(field(/^Name/), { target: { value: "My notes" } });
  fireEvent.change(field(/^Short id/), { target: { value: "notes" } });
  fireEvent.change(field(/^Program/), { target: { value: "npx" } });
  fireEvent.change(field(/^Arguments/), { target: { value: args } });
}

describe("Connections: adding an app", () => {
  it("keeps a quoted argument with a space in it whole, without its quotes", async () => {
    const server = serveApps();
    renderWithProviders(<ConnectionsPage />);
    await fill('-y @modelcontextprotocol/server-filesystem "/Users/me/My Notes"');
    // The person sees the arguments as the program will get them, before adding it.
    expect(screen.getByText("/Users/me/My Notes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add app" }));
    await waitFor(() => expect(server.calls.some((c) => c.method === "POST")).toBe(true));
    expect(server.calls.find((c) => c.method === "POST")?.body).toMatchObject({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/My Notes"],
    });
  });

  it("refuses arguments with a quote left open", async () => {
    const server = serveApps();
    renderWithProviders(<ConnectionsPage />);
    await fill("-y server-filesystem '/Users/me/My Notes");
    expect(screen.getByText(/single quote isn't closed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add app" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("shows a saved argument with a space in it in quotes", async () => {
    serveApps(undefined, [NOTES]);
    renderWithProviders(<ConnectionsPage />);
    expect(
      await screen.findByText(/npx -y @modelcontextprotocol\/server-filesystem "\/Users\/me\/My Notes"/),
    ).toBeTruthy();
  });
});

describe("Connections: mail", () => {
  it("never asks for Google credentials that Steward can't use yet", async () => {
    serveApps();
    renderWithProviders(<ConnectionsPage />);
    const text = (await screen.findByText(/made-up inbox/)).textContent ?? "";
    expect(text).toContain("isn't available yet");
    expect(text).not.toMatch(/credentials|STEWARD_DEMO_GOOGLE=0/);
  });

  it("says how to get the demo inbox back when no mail is connected", async () => {
    serveApps({ connected: false, label: "Not connected", isDemo: false });
    renderWithProviders(<ConnectionsPage />);
    expect(await screen.findByText(/STEWARD_DEMO_GOOGLE=1/)).toBeTruthy();
  });
});
