import type { Message } from "@copilotkit/react-core/v2";
import type { Skill } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { type ChatActions, ChatActionsContext } from "./chat-context.tsx";
import { readOutsideContent } from "./outside.ts";
import { SkillToolCard } from "./SkillToolCard.tsx";
import type { ToolProps } from "./tool-cards.tsx";

const DRAFT = {
  name: "weekly-review",
  description: "A short review of my week",
  instructions: "Look at what I did this week and what is coming next week.\nKeep it to five lines.",
};

const ok = JSON.stringify({ ok: true, data: { shown: true } });

function tool(overrides: Partial<ToolProps> = {}): ToolProps {
  return {
    name: "show_skill",
    toolCallId: "call_1",
    args: DRAFT,
    status: "complete",
    result: ok,
    ...overrides,
  };
}

const chat = (readOutside: boolean): ChatActions => ({
  threadId: "thr_1",
  agentId: "steward",
  send: () => {},
  busy: false,
  isLatestTurn: () => true,
  isAwaitingApproval: () => false,
  showComputer: () => {},
  readOutside,
});

function serve(
  opts: { skills?: Skill[]; create?: (body: unknown) => { status: number; body: unknown } } = {},
) {
  let skills = opts.skills ?? [];
  return mockFetch((req) => {
    if (req.method === "GET" && req.path === "/api/skills") return { body: skills };
    if (req.method === "POST" && req.path === "/api/skills") {
      const answer = opts.create?.(req.body) ?? {
        status: 201,
        body: { id: "skl_1", source: "person", ...(req.body as object) },
      };
      if (answer.status === 201) skills = [...skills, answer.body as Skill];
      return answer;
    }
    return undefined;
  });
}

function show(props: ToolProps = tool(), readOutside = false) {
  return renderWithProviders(<SkillToolCard {...props} />, {
    wrap: (children) => (
      <ChatActionsContext.Provider value={chat(readOutside)}>{children}</ChatActionsContext.Provider>
    ),
  });
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a skill Steward wrote", () => {
  it("shows the whole text and saves it, with no tools, only when Save skill is pressed", async () => {
    const { calls } = serve();
    show();
    const card = screen.getByRole("region", { name: "A skill to save: /weekly-review" });
    expect(within(card).getByText("A short review of my week")).toBeTruthy();
    expect(within(card).getByText(/Keep it to five lines\./)).toBeTruthy();
    expect(within(card).queryByRole("note")).toBeNull();
    await waitFor(() => expect(calls.some((c) => c.path === "/api/skills")).toBe(true));
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.click(within(card).getByRole("button", { name: "Save skill" }));
    expect((await within(card).findByRole("status")).textContent).toContain("Saved as /weekly-review.");
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([{ ...DRAFT, tools: [] }]);
  });

  it("warns above the button when the conversation read outside content", () => {
    serve();
    show(tool(), true);
    expect(screen.getByRole("note").textContent).toContain(
      "Read it before saving: this conversation read outside content",
    );
  });

  it("says why it could not be saved, and offers it again", async () => {
    serve({
      create: () => ({ status: 409, body: { error: "There is already a skill called /weekly-review." } }),
    });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Save skill" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "There is already a skill called /weekly-review.",
    );
    expect(screen.getByRole("button", { name: "Save skill" })).toBeTruthy();
  });

  it("opens the draft in the skill form with Edit first, and saves what the person changed", async () => {
    const { calls } = serve();
    show();
    fireEvent.click(screen.getByRole("button", { name: "Edit first" }));
    const dialog = (await screen.findByText("Add a skill", { selector: "h2" })).closest(
      "dialog",
    ) as HTMLElement;
    const name = within(dialog).getByLabelText("Name", { exact: false }) as HTMLInputElement;
    expect(name.value).toBe("weekly-review");
    fireEvent.change(name, { target: { value: "my-week" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add skill" }));
    expect((await screen.findByRole("status")).textContent).toContain("Saved as /my-week.");
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ name: "my-week", tools: [] });
  });

  it("can't be saved while Steward is still writing it", () => {
    serve();
    show(tool({ status: "inProgress", result: undefined, args: { name: "weekly-review" } }));
    expect((screen.getByRole("button", { name: "Save skill" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Steward is writing it…")).toBeTruthy();
  });

  it("shows a refused draft as a failed step, with nothing to save", () => {
    serve();
    show(
      tool({
        args: { ...DRAFT, name: "Weekly Review" },
        result: JSON.stringify({ ok: false, error: "\"Weekly Review\" can't be a skill's name." }),
      }),
    );
    expect(screen.queryByRole("button", { name: "Save skill" })).toBeNull();
    expect(screen.getByText(/can't be a skill's name/)).toBeTruthy();
  });

  it("says it is saved when the skill is already on the Skills page", async () => {
    serve({
      skills: [{ id: "skl_1", source: "person", ...DRAFT, tools: [] }],
    });
    show();
    expect((await screen.findByRole("status")).textContent).toContain("Saved as /weekly-review.");
    expect(screen.queryByRole("button", { name: "Save skill" })).toBeNull();
  });
});

describe("readOutsideContent", () => {
  const call = (id: string, name: string): Message =>
    ({
      id: `a_${id}`,
      role: "assistant",
      content: "",
      toolCalls: [{ id, type: "function", function: { name, arguments: "{}" } }],
    }) as Message;
  const result = (id: string, content = "{}"): Message =>
    ({ id: `t_${id}`, role: "tool", toolCallId: id, content }) as Message;

  it("counts tools that read the web, mail or files, and any tool it does not know", () => {
    const user = { id: "u", role: "user", content: "hi" } as Message;
    expect(readOutsideContent([user])).toBe(false);
    expect(readOutsideContent([user, call("1", "task_create"), result("1")])).toBe(false);
    expect(readOutsideContent([user, call("1", "web_fetch"), result("1")])).toBe(true);
    expect(readOutsideContent([user, call("1", "file_read"), result("1")])).toBe(true);
    expect(readOutsideContent([user, call("1", "mcp__notes__search"), result("1")])).toBe(true);
    // A call still running, or one the gateway refused, read nothing.
    expect(readOutsideContent([user, call("1", "mail_read")])).toBe(false);
    expect(
      readOutsideContent([
        user,
        call("1", "mail_read"),
        result("1", JSON.stringify({ ok: false, refused: true, message: "No." })),
      ]),
    ).toBe(false);
  });
});
