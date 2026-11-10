import type { Rule } from "@steward/shared";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Toaster } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/api.ts";
import { type FakeRequest, mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { RulesPage } from "./RulesPage.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rule = (over: Partial<Rule> & Pick<Rule, "id" | "name" | "source">): Rule => ({
  effect: "ask",
  when: 'tool.surface == "calendar"',
  description: "",
  enabled: true,
  createdAt: "2026-10-27T08:00:00Z",
  ...over,
});

/** A server that keeps the rules and lets a shipped rule change only `enabled`, as the real one does. */
function serve() {
  const rules = [
    rule({ id: "rul_preset", name: "Ask before paying", source: "preset", when: 'tool.kind == "pay"' }),
    rule({ id: "rul_tenant", name: "Ask before calendar changes", source: "tenant", description: "Tenant" }),
    rule({ id: "rul_mine", name: "My own rule", source: "person", effect: "deny" }),
    rule({ id: "rul_bot", name: "Rent Scout: never pay a deposit", source: "bot", effect: "deny" }),
    rule({ id: "rul_odd", name: "From somewhere new", source: "plugin" as Rule["source"], effect: "deny" }),
  ];
  return mockFetch((req: FakeRequest) => {
    if (req.path === "/api/rules" && req.method === "GET") return { body: rules };
    if (req.path === "/api/rules/presets") return { body: rules.filter((r) => r.source === "preset") };
    const id = req.path.match(/^\/api\/rules\/(rul_\w+)$/)?.[1];
    const found = rules.find((r) => r.id === id);
    if (req.path === "/api/rules/dry-run") {
      return {
        body: { effect: "ask", reason: "Sending an email asks unless you allowed it.", findings: [] },
      };
    }
    if (found && req.method === "PUT") {
      const body = req.body as Rule;
      if (
        found.source !== "person" &&
        (body.name !== found.name ||
          body.effect !== found.effect ||
          body.when !== found.when ||
          body.description !== found.description)
      ) {
        return { status: 403, body: { error: "Rules that come with Steward can't be changed." } };
      }
      found.enabled = body.enabled;
      return { body: found };
    }
    return undefined;
  });
}

const card = (name: string) => screen.getByRole("article", { name });

describe("RulesPage", () => {
  it("lets a built-in or setup rule be switched off, but not edited or deleted", async () => {
    const server = serve();
    renderWithProviders(<RulesPage />);
    const preset = await screen.findByRole("article", { name: "Ask before paying" });
    const tenant = card("Ask before calendar changes");
    for (const shipped of [preset, tenant]) {
      expect(within(shipped).getByRole("switch", { name: /In use/ })).toBeTruthy();
      expect(within(shipped).queryByRole("button", { name: /Edit|Delete/ })).toBeNull();
    }

    fireEvent.click(within(preset).getByRole("switch", { name: /In use/ }));
    // A safety rule asks before it goes off.
    const dialog = await screen.findByRole("dialog", { name: "Switch off this safety rule?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Switch off" }));
    await waitFor(() => expect(server.calls.some((c) => c.method === "PUT")).toBe(true));
    const put = server.calls.find((c) => c.method === "PUT");
    expect(put?.url).toBe("/api/rules/rul_preset");
    expect(put?.body).toEqual({
      name: "Ask before paying",
      effect: "ask",
      when: 'tool.kind == "pay"',
      description: "",
      enabled: false,
    });
    // The built-in list shows it off straight away, not after its cache runs out.
    await waitFor(() =>
      expect(card("Ask before paying").querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe(
        "false",
      ),
    );
    expect(within(card("Ask before paying")).getByText("Off")).toBeTruthy();
  });

  it("asks before a built-in refusal goes off, and keeping it on changes nothing", async () => {
    const server = serve();
    renderWithProviders(<RulesPage />);
    const bot = await screen.findByRole("article", { name: "Rent Scout: never pay a deposit" });
    fireEvent.click(within(bot).getByRole("switch", { name: /In use/ }));
    const dialog = await screen.findByRole("dialog", { name: "Switch off this safety rule?" });
    expect(dialog.textContent).toContain("Rent Scout: never pay a deposit");
    expect(dialog.textContent).toContain("no longer refused");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it on" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("puts a rule back on from Undo on the toast", async () => {
    const server = serve();
    renderWithProviders(
      <>
        <RulesPage />
        <Toaster />
      </>,
    );
    const bot = await screen.findByRole("article", { name: "Rent Scout: never pay a deposit" });
    fireEvent.click(within(bot).getByRole("switch", { name: /In use/ }));
    const dialog = await screen.findByRole("dialog", { name: "Switch off this safety rule?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Switch off" }));
    // Toasts outlive a test, so find this rule's own toast.
    const mine = await waitFor(() => {
      const found = screen
        .getAllByText("Rule switched off")
        .map((t) => t.closest<HTMLElement>("[data-sonner-toast]"))
        .find((t) => t?.textContent?.includes("Rent Scout: never pay a deposit"));
      if (!found) throw new Error("No toast for the bot's rule yet");
      return found;
    });
    fireEvent.click(within(mine).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.calls.filter((c) => c.method === "PUT")).toHaveLength(2));
    const puts = server.calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => [c.url, (c.body as Rule).enabled])).toEqual([
      ["/api/rules/rul_bot", false],
      ["/api/rules/rul_bot", true],
    ]);
    await waitFor(() =>
      expect(
        within(card("Rent Scout: never pay a deposit"))
          .getByRole("switch", { name: /In use/ })
          .getAttribute("aria-checked"),
      ).toBe("true"),
    );
  });

  it("switches the person's own rule off without asking", async () => {
    const server = serve();
    renderWithProviders(<RulesPage />);
    const mine = await screen.findByRole("article", { name: "My own rule" });
    fireEvent.click(within(mine).getByRole("switch", { name: /In use/ }));
    await waitFor(() => expect(server.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows rules that came with a bot, and any rule from a source it doesn't know, with only a switch", async () => {
    serve();
    renderWithProviders(<RulesPage />);
    const bots = await screen.findByRole("region", { name: "From your bots" });
    const other = screen.getByRole("region", { name: "Other rules" });
    for (const [section, name] of [
      [bots, "Rent Scout: never pay a deposit"],
      [other, "From somewhere new"],
    ] as const) {
      const shown = within(section).getByRole("article", { name });
      expect(within(shown).getByRole("switch", { name: /In use/ })).toBeTruthy();
      expect(within(shown).queryByRole("button", { name: /Edit|Delete/ })).toBeNull();
    }
  });

  it("doesn't say there are no rules when the rules couldn't be read", async () => {
    mockFetch((req) =>
      req.path === "/api/rules"
        ? { status: 500, body: { error: "Steward couldn't read the rules." } }
        : { body: [] },
    );
    renderWithProviders(<RulesPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("Steward couldn't read the rules.");
    expect(screen.queryByText("No rules of your own yet")).toBeNull();
    expect(screen.queryByText("Nothing is always allowed yet.")).toBeNull();
  });

  it("keeps Edit and Delete for the person's own rules", async () => {
    serve();
    renderWithProviders(<RulesPage />);
    const mine = await screen.findByRole("article", { name: "My own rule" });
    expect(within(mine).getByRole("button", { name: "Edit My own rule" })).toBeTruthy();
    expect(within(mine).getByRole("button", { name: "Delete My own rule" })).toBeTruthy();
  });

  it("offers examples written the way the rule engine reads them", async () => {
    serve();
    renderWithProviders(<RulesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a rule" }));
    fireEvent.click(screen.getByRole("button", { name: /Emails only to your own company/ }));
    expect((screen.getByPlaceholderText('tool.surface == "calendar"') as HTMLTextAreaElement).value).toBe(
      'tool.kind == "send" && target.recipients.all(r, endsWith(r, "@mycompany.com"))',
    );
  });
});

describe("RulesPage: would this be allowed?", () => {
  const tester = () => screen.getByRole("region", { name: "Would this be allowed?" });
  const argsBox = () => within(tester()).getByRole("textbox", { name: /Arguments/ }) as HTMLTextAreaElement;

  it("asks the gateway, and clears the answer as soon as the question changes", async () => {
    const server = serve();
    renderWithProviders(<RulesPage />);
    await screen.findByRole("article", { name: "My own rule" });
    fireEvent.click(within(tester()).getByRole("button", { name: "Check" }));
    expect(await within(tester()).findByText("Steward would ask you first.")).toBeTruthy();
    expect(server.calls.find((c) => c.path === "/api/rules/dry-run")?.body).toMatchObject({
      tool: "mail_send",
      tainted: false,
      initiator: "person",
    });

    fireEvent.click(within(tester()).getByRole("checkbox", { name: /already read a web page/ }));
    await waitFor(() => expect(within(tester()).queryByText("Steward would ask you first.")).toBeNull());
  });

  it("keeps the answer when the rules read back the same, and clears it when one changes", async () => {
    serve();
    const { client } = renderWithProviders(<RulesPage />);
    await screen.findByRole("article", { name: "My own rule" });
    fireEvent.click(within(tester()).getByRole("button", { name: "Check" }));
    expect(await within(tester()).findByText("Steward would ask you first.")).toBeTruthy();

    // Coming back to the tab reads the rules again; nothing changed, so the answer still holds.
    await act(async () => {
      await client.refetchQueries({ queryKey: queryKeys.ruleList });
      // The new list reaches the page a tick later, and a cleared answer a tick after that. With
      // the answer kept this wait changes nothing; it only gives a wrongly cleared one time to show.
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(within(tester()).getByText("Steward would ask you first.")).toBeTruthy();

    fireEvent.click(within(card("My own rule")).getByRole("switch", { name: /In use/ }));
    await waitFor(() => expect(within(tester()).queryByText("Steward would ask you first.")).toBeNull());
  });

  it("refuses arguments that aren't a JSON object, without asking", async () => {
    const server = serve();
    renderWithProviders(<RulesPage />);
    await screen.findByRole("article", { name: "My own rule" });
    fireEvent.change(argsBox(), { target: { value: "[1, 2]" } });
    fireEvent.click(within(tester()).getByRole("button", { name: "Check" }));
    expect(await within(tester()).findByText(/Arguments must be a JSON object/)).toBeTruthy();
    expect(server.calls.some((c) => c.path === "/api/rules/dry-run")).toBe(false);
  });

  it("gives a click the button's name, and says why it matters", async () => {
    serve();
    renderWithProviders(<RulesPage />);
    await screen.findByRole("article", { name: "My own rule" });
    fireEvent.change(within(tester()).getByRole("combobox", { name: "Action" }), {
      target: { value: "browser_click" },
    });
    expect(JSON.parse(argsBox().value)).toEqual({ ref: "e12", element: "Place order" });
    expect(within(tester()).getByText(/give it as element/)).toBeTruthy();
  });

  it("checks a connected app's tool by its name", async () => {
    const server = serve();
    renderWithProviders(<RulesPage />);
    await screen.findByRole("article", { name: "My own rule" });
    fireEvent.change(within(tester()).getByRole("combobox", { name: "Action" }), {
      target: { value: "__other" },
    });
    fireEvent.change(within(tester()).getByRole("textbox", { name: /Tool name/ }), {
      target: { value: "mcp__notion__search" },
    });
    fireEvent.click(within(tester()).getByRole("button", { name: "Check" }));
    await waitFor(() =>
      expect(server.calls.find((c) => c.path === "/api/rules/dry-run")?.body).toMatchObject({
        tool: "mcp__notion__search",
      }),
    );
  });
});
