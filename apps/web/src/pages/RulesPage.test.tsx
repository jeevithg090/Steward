import type { Rule } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  ];
  return mockFetch((req: FakeRequest) => {
    if (req.path === "/api/rules" && req.method === "GET") return { body: rules };
    if (req.path === "/api/rules/presets") return { body: rules.filter((r) => r.source === "preset") };
    const id = req.path.match(/^\/api\/rules\/(rul_\w+)$/)?.[1];
    const found = rules.find((r) => r.id === id);
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
