import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster, toast } from "@/components/ui";
import { Gateway, type ChatTurn, type Connector, type Finding } from "@/lib/api";
import { GATEWAY_KEY, TOKEN_KEY } from "@/lib/config";
import { readSentence, sourceLine, sweepSentence } from "@/lib/connectors";
import { ShowcaseGateway } from "@/lib/showcase";
import { SCAM_SAMPLE, classify, showcaseChat } from "@/lib/showcase-chat";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import sweepJson from "@/showcase/connectors-sweep.json";
import mcpJson from "@/showcase/mcp-info.json";
import { TaskMessages } from "../chat/TaskMessages";
import { SWEEP_SAMPLE } from "../chat/WelcomeCard";
import ConnectorsPage, { INTRO } from "./ConnectorsPage";
import { MCP_CLIENTS, PLACEHOLDER_TOKEN } from "./McpSection";

const NAMES = ["Email", "Calendar", "Bank statement", "Rail records"];
const FINDINGS = sweepJson.findings as unknown as Finding[];

function props(over: Partial<PageProps> = {}): PageProps {
  return {
    gateway: new ShowcaseGateway(),
    user: { id: "u_margaret", name: "Margaret", profileId: null },
    showcase: true,
    health: null,
    events: [],
    language: "en",
    params: {},
    speak: vi.fn(),
    setProfile: vi.fn(),
    ...over,
  };
}

function renderPage(over: Partial<PageProps> = {}) {
  return render(
    <>
      <main>
        <ConnectorsPage {...props(over)} />
      </main>
      <Toaster />
    </>,
  );
}

beforeEach(() => {
  localStorage.clear();
  toast.clear();
});

describe("the Connectors page in the showcase", () => {
  test("says what it is, lists the four connectors with what Tempo may read and its read-only tools, and is axe-clean", async () => {
    const { container } = renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Connectors" })).toBeInTheDocument();
    expect(screen.getByText(INTRO)).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading your connectors" })).toBeInTheDocument();

    for (const name of NAMES) expect(await screen.findByRole("heading", { level: 3, name })).toBeInTheDocument();
    const switches = screen.getAllByRole("switch");
    expect(switches.map((s) => s.getAttribute("aria-checked"))).toEqual(["true", "true", "true", "true"]);
    expect(screen.getByRole("switch", { name: "Email" })).toBeInTheDocument();
    expect(screen.getAllByText("What Tempo may read")).toHaveLength(4);
    expect(screen.getAllByText("Tools (read-only)")).toHaveLength(4);
    const mailTools = screen.getByRole("list", { name: "Tools Tempo may use on Email" });
    expect(within(mailTools).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["search_messages", "get_message"]);
    expect(screen.getByText("See the names of attachments, never the files")).toBeInTheDocument();
    expect(screen.getByText(/· 6 items read so far, none kept/)).toBeInTheDocument();
    expect(screen.getByText(/the sweep is a recording/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Your connectors · 4 of 4 on/ })).toBeInTheDocument();
    await screen.findByRole("table");
    await expectNoA11yViolations(container);
  });

  test("Sweep my inbox shows the four findings with £14.20 and £23.40, their actions, and what Tempo read", async () => {
    // With no claim live yet (Margaret's two seeded asks declined), the train and the visit are offers to act.
    const gateway = new ShowcaseGateway();
    for (const m of await gateway.missions()) if (m.state === "awaiting_consent") await gateway.stop(m.id);
    const speak = vi.fn();
    const { container } = renderPage({ gateway, speak });
    await screen.findByRole("heading", { level: 3, name: "Email" });
    await userEvent.click(screen.getByRole("button", { name: "Sweep my inbox" }));

    const found = await screen.findByRole("list", { name: "What Tempo found" });
    const cards = within(found).getAllByRole("article");
    expect(cards).toHaveLength(4);
    expect(cards.map((c) => within(c).getByRole("heading", { level: 4 }).textContent)).toEqual(FINDINGS.map((f) => f.title));
    expect(within(cards[0]!).getByText("£14.20 to claim")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("from your email: Trainline e-ticket, 23 October")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("A question for you")).toBeInTheDocument();
    expect(within(cards[2]!).getByText("A trick: don't click")).toBeInTheDocument();
    expect(within(cards[2]!).getByText("from your email: HMRC: you are due a tax refund")).toBeInTheDocument();
    expect(within(cards[3]!).getByText("Nothing to do")).toBeInTheDocument();
    expect(within(cards[3]!).getByRole("heading", { level: 4 }).textContent).toContain("£23.40");

    // Each action follows finding.action.href: the chat with a sentence, or a page.
    expect(within(cards[0]!).getByRole("link", { name: "Claim £14.20" })).toHaveAttribute("href", FINDINGS[0]!.action.href);
    expect(FINDINGS[0]!.action.href).toBe(`#/chat?say=${encodeURIComponent(FINDINGS[0]!.say)}`);
    expect(within(cards[1]!).getByRole("link", { name: "They didn't come" }).getAttribute("href")).toMatch(/^#\/chat\?say=/);
    expect(within(cards[2]!).getByRole("link", { name: "See why it's a trick" })).toHaveAttribute("href", FINDINGS[2]!.action.href);
    expect(within(cards[3]!).getByRole("link", { name: "Check what else I'm owed" })).toHaveAttribute("href", `#/chat?say=${encodeURIComponent("Am I owed anything else?")}`);

    expect(screen.getByText("What Tempo read (and didn't keep)")).toBeInTheDocument();
    for (const words of ["6 emails", "4 appointments", "16 payments", "1 train looked up"]) expect(screen.getByText(words)).toBeInTheDocument();
    expect(speak).toHaveBeenCalledWith("I found four things worth a look in your email, calendar and bank. I kept none of what I read.");
    // The connectors' running count moves on, as the Gateway keeps it (6 recorded, 6 more now).
    expect(await screen.findByText(/· 12 items read so far, none kept/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sweep again" })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  test("while Margaret's recorded claims are live, the train and the visit say Tempo is on it and open Mission Control, as the Gateway does", async () => {
    const { container } = renderPage();
    await screen.findByRole("heading", { level: 3, name: "Email" });
    await userEvent.click(screen.getByRole("button", { name: "Sweep my inbox" }));
    const cards = within(await screen.findByRole("list", { name: "What Tempo found" })).getAllByRole("article");
    expect(cards).toHaveLength(4);
    const started = sweepJson.under_way as unknown as Record<string, Finding>;
    expect(within(cards[0]!).getByRole("heading", { level: 4 }).textContent).toBe(started[FINDINGS[0]!.id]!.title);
    expect(within(cards[0]!).getByText("£14.20 claim started")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("Claim started")).toBeInTheDocument();
    for (const card of cards.slice(0, 2)) expect(within(card).getByRole("link", { name: "Open Mission Control" })).toHaveAttribute("href", "#/missions");
    expect(within(cards[3]!).getByRole("heading", { level: 4 }).textContent).toContain("£23.40");
    await expectNoA11yViolations(container);
  });

  test("a switch turns a connector off and on with a toast, and the sweep then only finds what the connectors that are on can see", async () => {
    renderPage();
    const email = await screen.findByRole("switch", { name: "Email" });
    await userEvent.click(email);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Email" })).toHaveAttribute("aria-checked", "false"));
    expect(await screen.findByText("Email is off. Tempo won't read it.")).toBeInTheDocument();
    expect(screen.getByText("Off: Tempo won't read it.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /3 of 4 on/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Sweep my inbox" }));
    const found = await screen.findByRole("list", { name: "What Tempo found" });
    expect(within(found).getAllByRole("article").map((c) => c.getAttribute("data-kind"))).toEqual(["engineer_visit", "money_arrived"]);
    expect(screen.queryByText("6 emails")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("switch", { name: "Email" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Email" })).toHaveAttribute("aria-checked", "true"));
    expect(await screen.findByText(/Email connected\. Tempo reads it only when you sweep/)).toBeInTheDocument();
  });

  test("with every connector off, the sweep waits and says why", async () => {
    renderPage();
    for (const name of NAMES) await userEvent.click(await screen.findByRole("switch", { name }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sweep my inbox" })).toBeDisabled());
    expect(screen.getByText("Switch on a connector below first.")).toBeInTheDocument();
  });

  test("the MCP section shows the address, the eight tools with read-only badges, the no-approval line and four configs to copy", async () => {
    const user = userEvent.setup();
    renderPage();
    const section = screen.getByRole("region", { name: "Use Tempo from your AI (MCP)" });
    expect(within(section).getByText("No tool can approve: the person says yes on their own device.")).toHaveClass("font-bold");
    expect(within(section).getByText(/There's no Gateway in the showcase, so there is no MCP server/)).toBeInTheDocument();

    const table = await within(section).findByRole("table", { name: "The tools Tempo's MCP server offers" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("rowheader").querySelector("code")?.textContent)).toEqual(mcpJson.tools.map((t) => t.name));
    expect(within(table).getAllByText("read-only")).toHaveLength(6);
    expect(within(table).getAllByText("starts, never approves")).toHaveLength(2);
    expect(within(section).getAllByText(mcpJson.url).length).toBeGreaterThan(0);
    expect(within(section).getByText("Streamable HTTP, with the same token as this app")).toBeInTheDocument();
    expect(within(section).getByText("tempo://rules/{rule_id}")).toBeInTheDocument();
    expect(within(section).getByText("claim-a-late-train")).toBeInTheDocument();

    for (const client of ["Claude Code", "Zed", "Cursor", "Claude Desktop"]) expect(within(section).getByRole("heading", { level: 4, name: client })).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Show" })).not.toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "Copy the Claude Code config" }));
    expect(await navigator.clipboard.readText()).toBe(`claude mcp add --transport http tempo ${mcpJson.url} --header "Authorization: Bearer ${PLACEHOLDER_TOKEN}"`);
    expect(await screen.findByText("Copied the Claude Code config. Put in your own Gateway address and token.")).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Copy the Claude Desktop config" }));
    expect(JSON.parse(await navigator.clipboard.readText())).toEqual({
      mcpServers: {
        tempo: {
          command: "npx",
          args: ["-y", "mcp-remote@0.14.3", mcpJson.url, "--transport", "http-only", "--header", "Authorization:${AUTH_HEADER}"],
          env: { AUTH_HEADER: `Bearer ${PLACEHOLDER_TOKEN}` },
        },
      },
    });
  });

  test("the configs have the shapes docs/mcp.md gives", () => {
    const [code, zed, cursor, desktop] = MCP_CLIENTS.map((c) => c.build("http://gw/mcp", "tok"));
    expect(code).toBe('claude mcp add --transport http tempo http://gw/mcp --header "Authorization: Bearer tok"');
    expect(JSON.parse(zed!)).toEqual({ context_servers: { tempo: { url: "http://gw/mcp", headers: { Authorization: "Bearer tok" } } } });
    expect(JSON.parse(cursor!)).toEqual({ mcpServers: { tempo: { url: "http://gw/mcp", headers: { Authorization: "Bearer tok" } } } });
    const bridge = JSON.parse(desktop!).mcpServers.tempo;
    expect(bridge.args).toEqual(["-y", "mcp-remote@0.14.3", "http://gw/mcp", "--transport", "http-only", "--header", "Authorization:${AUTH_HEADER}"]);
    expect(bridge.env).toEqual({ AUTH_HEADER: "Bearer tok" });
  });
});

// --- against a fake Gateway (the live routes of plan.md §14.2) ------------------------------------

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function fakeGateway(routes: Record<string, (body: unknown) => unknown>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path: url.pathname + url.search, body });
    const route = routes[`${method} ${url.pathname}`];
    if (!route) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(route(body)), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { gateway: new Gateway({ url: "http://gw.test", token: "secret-token" }, fetchImpl), calls };
}

const LIVE_CONNECTOR: Connector = {
  id: "mail",
  name: "Email",
  kind: "mail",
  connected: true,
  scopes: ["who sent each email"],
  tools: ["search_messages", "get_message"],
  last_read_at: null,
  items_read: 0,
};

describe("the Connectors page against a Gateway", () => {
  test("lists, switches and sweeps through the routes, and masks the token until Show", async () => {
    localStorage.setItem(GATEWAY_KEY, "http://gw.test");
    localStorage.setItem(TOKEN_KEY, "secret-token");
    const user = userEvent.setup();
    let connected = true;
    const { gateway, calls } = fakeGateway({
      "GET /connectors": () => ({ connectors: [{ ...LIVE_CONNECTOR, connected }], simulated: false }),
      "POST /connectors/mail/disconnect": () => ((connected = false), { ...LIVE_CONNECTOR, connected }),
      "POST /connectors/sweep": () => ({ findings: [FINDINGS[3]], read: { mail: 2 }, took_ms: 80 }),
      "GET /mcp/info": () => ({ ...mcpJson, url: "http://gw.test/mcp" }),
    });
    const { container } = renderPage({ gateway, showcase: false });

    expect(await screen.findByRole("heading", { level: 3, name: "Email" })).toBeInTheDocument();
    expect(screen.getByText("Not read yet.")).toBeInTheDocument();
    expect(screen.queryByText(/recorded/)).not.toBeInTheDocument();
    expect(calls.find((c) => c.path.startsWith("/connectors?"))).toMatchObject({ method: "GET", path: "/connectors?user_id=u_margaret" });

    await user.click(screen.getByRole("button", { name: "Sweep my inbox" }));
    const found = await screen.findByRole("list", { name: "What Tempo found" });
    expect(within(found).getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("2 emails")).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/connectors/sweep")).toMatchObject({ method: "POST", body: { user_id: "u_margaret" } });

    // The token is the one from Settings, hidden on screen until Show; Copy carries the real one.
    const section = screen.getByRole("region", { name: "Use Tempo from your AI (MCP)" });
    await within(section).findByRole("table");
    expect(within(section).queryByText(/secret-token/)).not.toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Copy the Cursor config" }));
    expect(JSON.parse(await navigator.clipboard.readText())).toEqual({ mcpServers: { tempo: { url: "http://gw.test/mcp", headers: { Authorization: "Bearer secret-token" } } } });
    expect(await screen.findByText("Copied the Cursor config. It has your token in it: keep it private.")).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Show" }));
    expect(within(section).getAllByText(/secret-token/).length).toBeGreaterThan(0);
    expect(within(section).getByRole("button", { name: "Hide" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("switch", { name: "Email" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Email" })).toHaveAttribute("aria-checked", "false"));
    expect(calls.find((c) => c.path === "/connectors/mail/disconnect")).toMatchObject({ method: "POST", body: { user_id: "u_margaret" } });
    await expectNoA11yViolations(container);
  });

  test("a Gateway without the routes gets plain words and a next step, not an error code", async () => {
    const { gateway } = fakeGateway({});
    renderPage({ gateway, showcase: false });
    expect(await screen.findByText(/This Gateway has no connectors yet \(GET \/connectors is missing\)/)).toBeInTheDocument();
    expect(await screen.findByText(/This Gateway doesn't describe an MCP server yet/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(2);
    // The address is still offered: the Gateway's own, plus /mcp.
    expect(screen.getAllByText(/\/mcp$/).length).toBeGreaterThan(0);
  });
});

// --- the chat: the sweep intent and its finding cards ---------------------------------------------

describe("the sweep in the chat", () => {
  test.each([
    ["Sweep my inbox", "sweep"],
    ["sweep", "sweep"],
    ["check my email", "sweep"],
    ["Can you look through my inbox?", "sweep"],
    ["find what I'm owed", "sweep"],
    [SWEEP_SAMPLE, "sweep"],
    ["Am I owed anything?", "entitlement"],
    ["check this email: your account is locked, verify your details", "scam_check"],
    ["check my email http://hmrc-refunds-gov.uk/claim", "scam_check"],
    [SCAM_SAMPLE, "scam_check"],
  ] as const)("%s → %s", (text, intent) => {
    expect(classify(text)).toBe(intent);
  });

  const turn = (text: string): ChatTurn => ({ user_id: "u_margaret", display_name: "Margaret", text, language: "en" });

  test("the showcase answers a sweep from the recording: the findings, a chip per finding and a way to the page", async () => {
    const gateway = new ShowcaseGateway();
    const reply = await showcaseChat(turn(SWEEP_SAMPLE), gateway);
    expect(reply.intent).toBe("sweep");
    expect(reply.findings?.map((f) => f.kind)).toEqual(["late_train", "engineer_visit", "scam", "money_arrived"]);
    expect(reply.findings?.[0]?.amount_gbp).toBe("14.20");
    expect(reply.findings?.[3]?.amount_gbp).toBe("23.40");
    expect(reply.suggestions).toEqual(FINDINGS.map((f) => f.say));
    expect(reply.actions).toEqual([{ label: "Open Connectors", href: "#/connectors" }]);
    expect(reply.reply).toBe(sweepSentence({ findings: FINDINGS, read: sweepJson.read, took_ms: 0 }));
    expect(reply.say).toBe([reply.reply, ...reply.findings!.map((f) => (/[.!?]$/.test(f.title) ? f.title : `${f.title}.`))].join(" "));
    expect(reply.reply).toBe("I found four things worth a look in your email, calendar and bank. I kept none of what I read.");
    expect(reply.mission).toBeNull();

    // What the person switched off is not read in the chat either.
    await gateway.disconnect("calendar", "u_margaret");
    const fewer = await showcaseChat(turn("sweep"), gateway);
    expect(fewer.findings?.map((f) => f.kind)).toEqual(["late_train", "scam", "money_arrived"]);
    expect(fewer.reply).toBe("I found three things worth a look in your email and bank. I kept none of what I read.");
    expect(readSentence({ rail: 1, mail: 2 })).toBe("2 emails and 1 train looked up");
    expect(sweepSentence({ findings: [], read: { rail: 1 }, took_ms: 0 })).toBe("Nothing is connected, so I had nothing to read. Turn one on, on the Connectors page.");
    expect(sweepSentence({ findings: [], read: { mail: 6 }, took_ms: 0 })).toBe("I looked in your email and found nothing to do. I kept none of what I read.");
  });

  test("each finding's say is a sentence the showcase chat answers from the recordings", async () => {
    const gateway = new ShowcaseGateway();
    const train = await showcaseChat(turn(FINDINGS[0]!.say), gateway);
    expect(train.intent).toBe("rail_delay");
    expect(train.reply).toBe("I'm already on this one. It needs your OK.");
    expect(train.ask?.amount_gbp).toBe("14.20");
    const visit = await showcaseChat(turn(FINDINGS[1]!.say), gateway);
    expect(visit.intent).toBe("missed_visit");
    expect(visit.reply).toBe("I'm already on this one. It needs your OK.");
    const scam = await showcaseChat(turn(FINDINGS[2]!.say), gateway);
    expect(scam.intent).toBe("scam_check");
    expect(scam.verdict).toMatchObject({ level: "likely_scam" });
    const more = await showcaseChat(turn(FINDINGS[3]!.say), gateway);
    expect(more.intent).toBe("entitlement");
    for (const f of FINDINGS) expect(f.say.length).toBeLessThanOrEqual(120);
  });

  test("reply.findings render in the chat as compact cards with their actions", async () => {
    const { container } = render(
      <main>
        <TaskMessages
          messages={[
            { id: "u1", role: "user", text: SWEEP_SAMPLE },
            { id: "a1", role: "agent", text: "I looked through your email. I found 4 things worth a look.", intent: "sweep", findings: FINDINGS, actions: [{ label: "Open Connectors", href: "#/connectors" }] },
          ]}
        />
      </main>,
    );
    expect(screen.getByText("Connectors")).toBeInTheDocument(); // the intent badge
    const found = screen.getByRole("list", { name: "What Tempo found" });
    const cards = within(found).getAllByRole("article");
    expect(cards).toHaveLength(4);
    expect(within(cards[0]!).getByText(FINDINGS[0]!.title)).toBeInTheDocument();
    expect(within(cards[0]!).getByText(sourceLine(FINDINGS[0]!))).toBeInTheDocument();
    expect(within(cards[0]!).getByRole("link", { name: "Claim £14.20" })).toHaveAttribute("href", FINDINGS[0]!.action.href);
    expect(within(cards[3]!).getByText("Nothing to do")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Connectors" })).toHaveAttribute("href", "#/connectors");
    await expectNoA11yViolations(container);
  });
});
