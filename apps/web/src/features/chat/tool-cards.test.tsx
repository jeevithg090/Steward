import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ChatActions, ChatActionsContext } from "./chat-context.tsx";
import {
  BrowserLine,
  ChoicesToolCard,
  DirectoryFindCard,
  GenericToolLine,
  MailSendCard,
  SecretRequestLine,
  TaskToolCard,
  type ToolProps,
} from "./tool-cards.tsx";
import { RENDERERS, ToolBoundary } from "./tool-registry.tsx";

afterEach(cleanup);

function Broken(): ReactNode {
  throw new Error("boom");
}

function chat(overrides: Partial<ChatActions> = {}): ChatActions {
  return {
    threadId: "thr_1",
    agentId: "steward",
    send: vi.fn(),
    busy: false,
    isLatestTurn: () => true,
    isAwaitingApproval: () => false,
    showComputer: vi.fn(),
    ...overrides,
  };
}

function draw(node: ReactNode, actions: ChatActions | null = chat()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChatActionsContext.Provider value={actions}>{node}</ChatActionsContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const tool = (name: string, args: Record<string, unknown>, result?: unknown): ToolProps => ({
  name,
  toolCallId: `call_${name}`,
  args,
  status: result === undefined ? "inProgress" : "complete",
  result: result === undefined ? undefined : typeof result === "string" ? result : JSON.stringify(result),
});

const draft = { to: [{ email: "sam@example.com" }], subject: "Friday", body: "See you at ten." };

describe("tool cards", () => {
  it("has a renderer for every built-in tool", () => {
    expect(Object.keys(RENDERERS).length).toBe(32);
  });

  it("shows a browser step in plain words with a way to the screen", () => {
    const actions = chat();
    draw(
      <BrowserLine
        {...tool(
          "browser_navigate",
          { url: "https://news.ycombinator.com" },
          { ok: true, data: { title: "Hacker News" } },
        )}
      />,
      actions,
    );
    expect(screen.getByText("Opened news.ycombinator.com")).toBeTruthy();
    expect(screen.getByText("Hacker News")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "See screen" }));
    expect(actions.showComputer).toHaveBeenCalled();
  });

  it("shows a running browser step as it happens", () => {
    draw(<BrowserLine {...tool("browser_navigate", { url: "https://example.com/a" })} />);
    expect(screen.getByText("Opening example.com")).toBeTruthy();
  });

  it("names the rule that refused a call", () => {
    draw(
      <BrowserLine
        {...tool(
          "browser_click",
          { element: "Buy now" },
          { ok: false, refused: true, rule: "No shopping", message: "Purchases are off." },
        )}
      />,
    );
    expect(screen.getByText("Refused by your rule ‘No shopping’")).toBeTruthy();
    expect(screen.getByText("Purchases are off.")).toBeTruthy();
  });

  describe("the email draft", () => {
    it("shows the whole draft while it waits for an answer", () => {
      draw(<MailSendCard {...tool("mail_send", draft)} />, chat({ isAwaitingApproval: () => true }));
      expect(screen.getByRole("region", { name: "Email to sam@example.com: Friday" })).toBeTruthy();
      expect(screen.getByText("Waiting for your answer")).toBeTruthy();
      expect(screen.getByText("See you at ten.")).toBeTruthy();
    });

    it("says sent once it went", () => {
      draw(<MailSendCard {...tool("mail_send", draft, { ok: true, data: { id: "m1" } })} />);
      expect(screen.getByText("Sent")).toBeTruthy();
    });

    it("says not sent, and why, when refused", () => {
      draw(
        <MailSendCard
          {...tool("mail_send", draft, {
            ok: false,
            refused: true,
            rule: "Ask before email",
            message: "You refused.",
          })}
        />,
      );
      expect(screen.getByText("Not sent")).toBeTruthy();
      expect(screen.getByText(/Refused by your rule ‘Ask before email’\. You refused\./)).toBeTruthy();
    });
  });

  it("never shows a secret, only that it was filled", () => {
    draw(
      <SecretRequestLine
        {...tool(
          "request_secret",
          { label: "Password", ref: "e3" },
          { ok: true, data: { filled: true, length: 12 } },
        )}
      />,
    );
    expect(screen.getByText("You filled in password")).toBeTruthy();
    expect(screen.getByText("12 characters, never shown to Steward")).toBeTruthy();
  });

  it("draws an MCP tool as a humanised line, with its result behind a disclosure", () => {
    draw(
      <GenericToolLine
        {...tool(
          "mcp__notion__search_pages",
          { query: "plans" },
          { ok: true, data: { untrusted: true, notice: "From Notion", data: { results: 2 } } },
        )}
      />,
    );
    expect(screen.getByText("Search pages")).toBeTruthy();
    expect(screen.getByText("Notion")).toBeTruthy();
    expect(screen.getByText("From Notion")).toBeTruthy();
  });

  it("sends a quick reply through the conversation", () => {
    const actions = chat();
    draw(
      <ChoicesToolCard
        {...tool("show_choices", { question: "Which day?", choices: ["Friday", "Monday"] }, "")}
      />,
      actions,
    );
    fireEvent.click(screen.getByRole("button", { name: "Friday" }));
    expect(actions.send).toHaveBeenCalledWith("Friday");
  });

  it("does not offer quick replies from an earlier turn", () => {
    draw(
      <ChoicesToolCard {...tool("show_choices", { choices: ["Friday"] }, "")} />,
      chat({ isLatestTurn: () => false }),
    );
    expect((screen.getByRole("button", { name: "Friday" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("falls back to a line when a task result is not a task", () => {
    draw(
      <TaskToolCard
        {...tool("task_create", { title: "Chase the invoice" }, { ok: true, data: { weird: true } })}
      />,
    );
    expect(screen.getByText("Added a task")).toBeTruthy();
  });

  it("lists the bots the directory returned, with View and Add, and says the text is from outside", () => {
    draw(
      <DirectoryFindCard
        {...tool(
          "directory_find",
          { query: "plan my meals" },
          {
            ok: true,
            data: {
              untrusted: true,
              notice: "From the bot directory.",
              data: {
                bots: [
                  {
                    id: "meal-planner",
                    name: "Meal Planner",
                    pitch: "Plans a week of dinners.",
                    author: { kind: "ai", model: "m", generated: "2026-10-28" },
                    packUrl: "packs/meal-planner.json",
                  },
                  { id: "chef", name: "Chef", pitch: "Cooks.", author: { kind: "person", handle: "ana" } },
                ],
              },
            },
          },
        )}
      />,
    );
    expect(screen.getByRole("region", { name: "Bots for “plan my meals”" })).toBeTruthy();
    expect(screen.getByText("2 bots found")).toBeTruthy();
    expect(screen.getByText("Plans a week of dinners.")).toBeTruthy();
    expect(screen.getByText("AI-made")).toBeTruthy();
    expect(screen.getByText("by ana")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View Meal Planner" }).getAttribute("href")).toBe(
      "/bots/meal-planner",
    );
    expect(screen.getByRole("link", { name: "Add Meal Planner" }).getAttribute("href")).toBe(
      "/bots/add?pack=packs%2Fmeal-planner.json",
    );
    // No pack address in the row: the index's own layout stands in.
    expect(screen.getByRole("link", { name: "Add Chef" }).getAttribute("href")).toBe(
      "/bots/add?pack=packs%2Fchef.json",
    );
    expect(screen.getByText("From the bot directory.")).toBeTruthy();
  });

  it("shows the directory tool's own note when the result is not wrapped", () => {
    draw(
      <DirectoryFindCard
        {...tool(
          "directory_find",
          { query: "x" },
          { ok: true, data: { bots: [], total: 0, note: "Listing text is written by third parties." } },
        )}
      />,
    );
    expect(screen.getByText("0 bots found")).toBeTruthy();
    expect(screen.getByText("Listing text is written by third parties.")).toBeTruthy();
  });

  it("keeps the conversation when a card throws", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    draw(
      <ToolBoundary name="show_chart">
        <Broken />
      </ToolBoundary>,
    );
    expect(screen.getByText("Couldn't show this step: Drew a chart")).toBeTruthy();
    consoleError.mockRestore();
  });
});
