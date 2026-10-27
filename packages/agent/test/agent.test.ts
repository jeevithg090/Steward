import type { BaseEvent, Message } from "@ag-ui/client";
import { createOpenAI } from "@ai-sdk/openai";
import { type ChatCompletionRequest, type FixtureResponse, LLMock } from "@copilotkit/aimock";
import { APPROVAL_INTERRUPT_REASON, CUSTOM_EVENTS } from "@steward/shared";
import type { LanguageModel } from "ai";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createStewardAgent, StewardAgent } from "../src/agent.ts";
import {
  CANCELLED_BY_PERSON,
  GATE_UNAVAILABLE,
  NO_LONGER_GRANTED,
  TOO_MANY_STEPS,
} from "../src/middleware.ts";
import { depsFrom, type Fakes, makeFakes, runTurn, SERVER_TOKEN, user } from "./fakes.ts";

let llm: LLMock;
let model: LanguageModel;
let fakes: Fakes;

beforeAll(async () => {
  llm = new LLMock({ port: 0, host: "127.0.0.1", logLevel: "silent" });
  const url = await llm.start();
  model = createOpenAI({ name: "test", baseURL: `${url}/v1`, apiKey: "test" }).chat("test-model");
});

afterAll(async () => {
  await llm.stop();
});

beforeEach(() => {
  llm.clearFixtures();
  llm.clearRequests();
  fakes = makeFakes();
});

function script(reply: (req: ChatCompletionRequest) => FixtureResponse) {
  llm.on({ predicate: () => true }, reply);
}

const lastIsTool = (req: ChatCompletionRequest) => req.messages.at(-1)?.role === "tool";
const toolCall = (name: string, args: Record<string, unknown>): FixtureResponse => ({
  toolCalls: [{ name, arguments: JSON.stringify(args) }],
});

function agent(overrides: Parameters<typeof depsFrom>[2] = {}) {
  return createStewardAgent(depsFrom(fakes, model, overrides));
}

function results(events: BaseEvent[]): { toolCallId: string; content: Record<string, unknown> }[] {
  return events
    .filter((e) => e.type === "TOOL_CALL_RESULT")
    .map((e) => {
      const r = e as unknown as { toolCallId: string; content: string };
      return { toolCallId: r.toolCallId, content: JSON.parse(r.content) as Record<string, unknown> };
    });
}

function text(events: BaseEvent[]): string {
  return events
    .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
    .map((e) => (e as unknown as { delta: string }).delta)
    .join("");
}

function systemOf(req: ChatCompletionRequest | undefined): string {
  return (req?.messages ?? [])
    .filter((m) => m.role === "system")
    .map((m) => String(m.content))
    .join("\n");
}

function requests(): ChatCompletionRequest[] {
  return llm.getRequests().map((r) => r.body as ChatCompletionRequest);
}

describe("a turn with no tools", () => {
  it("streams the model's words between RUN_STARTED and RUN_FINISHED", async () => {
    script(() => ({ content: "Hi. What can I do?" }));
    const turn = await runTurn(agent(), [user("hello")]);
    expect(turn.error).toBeUndefined();
    expect(turn.types[0]).toBe("RUN_STARTED");
    expect(turn.types.at(-1)).toBe("RUN_FINISHED");
    expect(turn.types).toContain("TEXT_MESSAGE_START");
    expect(turn.types).toContain("TEXT_MESSAGE_END");
    expect(turn.types.filter((t) => t === "RUN_STARTED")).toHaveLength(1);
    expect(text(turn.events)).toBe("Hi. What can I do?");
    expect(fakes.governance.calls).toHaveLength(0);
  });

  it("offers every Steward tool to the model, with the system prompt and run context", async () => {
    script(() => ({ content: "OK." }));
    fakes.memory.add("Prefers morning meetings", "you");
    await runTurn(agent(), [user("hello")]);
    const req = requests()[0];
    const offered = (req?.tools ?? []).map((t) => t.function.name);
    expect(offered).toContain("browser_navigate");
    expect(offered).toContain("mail_send");
    expect(offered).toContain("show_table");
    for (const t of req?.tools ?? [])
      expect((t.function.parameters as { type?: string }).type).toBe("object");
    const system = systemOf(req);
    expect(system).toContain("You are Steward");
    expect(system).toContain("Prefer British spelling.");
    expect(system).toContain("Europe/London");
    expect(system).toContain("Prefers morning meetings (you)");
    expect(system).toContain("demo inbox");
  });
});

describe("a tool the gateway allows", () => {
  it("runs through the gateway, returns TOOL_CALL_RESULT, then the model answers", async () => {
    script((req) =>
      lastIsTool(req)
        ? { content: "It is the example page." }
        : toolCall("web_fetch", { url: "example.com/a", intent: "Read it" }),
    );
    const turn = await runTurn(agent(), [user("read example.com/a")], {}, "thr_allow");
    expect(turn.error).toBeUndefined();

    const order = turn.types
      .filter((t) => t.startsWith("TOOL_CALL") || t === "RUN_FINISHED" || t === "TEXT_MESSAGE_START")
      .filter((t, i, all) => t !== all[i - 1]);
    expect(order).toEqual([
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "TOOL_CALL_RESULT",
      "TEXT_MESSAGE_START",
      "RUN_FINISHED",
    ]);

    const [call] = fakes.governance.callsFor("web_fetch");
    expect(call).toMatchObject({
      agentId: "steward",
      actorId: "local",
      threadId: "thr_allow",
      initiator: { kind: "person", id: "local" },
      tool: { name: "web_fetch", kind: "read", surface: "web", source: "builtin" },
      target: { url: "https://example.com/a", host: "example.com" },
      intent: "Read it",
      tainted: false,
    });
    expect(fakes.web.fetched).toEqual(["https://example.com/a"]);

    const [result] = results(turn.events);
    expect(result?.content.ok).toBe(true);
    expect(result?.content.data).toMatchObject({ untrusted: true, data: { title: "Example Domain" } });
    expect(text(turn.events)).toBe("It is the example page.");
    expect(turn.messages.some((m) => m.role === "tool")).toBe(true);
  });

  it("resolves a browser click's element from the computer, not from the model", async () => {
    fakes.computers.computer("steward").url = "https://shop.example.com/cart";
    script((req) => (lastIsTool(req) ? { content: "Clicked." } : toolCall("browser_click", { ref: "e20" })));
    await runTurn(agent(), [user("click send")]);
    const [call] = fakes.governance.callsFor("browser_click");
    expect(call?.target).toEqual({
      url: "https://shop.example.com/cart",
      host: "shop.example.com",
      element: { ref: "e20", role: "button", name: "Send" },
    });
  });

  it("routes a granted MCP tool through the gateway with its server and tool", async () => {
    fakes.mcp.tools = [
      {
        name: "mcp__notes__add",
        server: "notes",
        tool: "add",
        description: "Add a note",
        parameters: { type: "object", properties: { text: { type: "string" } } },
        kind: "write",
      },
    ];
    script((req) =>
      lastIsTool(req) ? { content: "Added." } : toolCall("mcp__notes__add", { text: "buy milk" }),
    );
    const turn = await runTurn(agent(), [user("add a note")]);
    const [call] = fakes.governance.callsFor("mcp__notes__add");
    expect(call).toMatchObject({
      tool: { kind: "write", surface: "mcp", source: "mcp:notes" },
      target: { mcp: { server: "notes", tool: "add" } },
      outbound: "buy milk",
    });
    expect(fakes.mcp.calls).toEqual([{ server: "notes", tool: "add", args: { text: "buy milk" } }]);
    expect(results(turn.events)[0]?.content.data).toMatchObject({ untrusted: true });
  });
});

describe("a tool the gateway refuses", () => {
  it("answers the call with a refused envelope and lets the model say so", async () => {
    fakes.governance.decide = (c) => (c.tool.name === "mail_send" ? "deny" : "allow");
    script((req) =>
      lastIsTool(req)
        ? { content: "I didn't send it: a rule stops email." }
        : toolCall("mail_send", { to: ["sam@example.com"], subject: "Hi", body: "See you." }),
    );
    const turn = await runTurn(agent(), [user("email sam")]);
    const [result] = results(turn.events);
    expect(result?.content).toEqual({
      ok: false,
      refused: true,
      rule: "No email from tests",
      message: "A rule refused this: No email from tests.",
    });
    expect(fakes.mail.sent).toHaveLength(0);
    expect(text(turn.events)).toContain("didn't send");
    expect(turn.types.at(-1)).toBe("RUN_FINISHED");
  });

  it("fails closed when the gateway itself throws", async () => {
    fakes.governance.throwOnExecute = true;
    script((req) => (lastIsTool(req) ? { content: "Not done." } : toolCall("shell_run", { command: "ls" })));
    const turn = await runTurn(agent(), [user("list files")]);
    expect(turn.error).toBeUndefined();
    expect(results(turn.events)[0]?.content).toEqual({ ok: false, refused: true, message: GATE_UNAVAILABLE });
    expect(fakes.computers.computer("steward").actions).toHaveLength(0);
    expect(turn.types.at(-1)).toBe("RUN_FINISHED");
  });
});

describe("approvals", () => {
  async function parkEmail(): Promise<{ messages: Message[]; toolCallId: string; events: BaseEvent[] }> {
    fakes.governance.decide = (c) => (c.tool.kind === "send" ? "ask" : "allow");
    script((req) =>
      lastIsTool(req)
        ? { content: "Sent. Sam has it." }
        : toolCall("mail_send", { to: ["sam@example.com"], subject: "Friday", body: "See you at 10." }),
    );
    const turn = await runTurn(agent(), [user("email sam about friday")], {}, "thr_approval");
    const toolCallId = (
      turn.events.find((e) => e.type === "TOOL_CALL_START") as unknown as { toolCallId: string }
    ).toolCallId;
    return { messages: turn.messages, toolCallId, events: turn.events };
  }

  it("ends the run with an interrupt and a CUSTOM approval event when the gateway asks", async () => {
    const { events, toolCallId } = await parkEmail();
    const types = events.map((e) => e.type);
    expect(types).not.toContain("TOOL_CALL_RESULT");
    expect(types).not.toContain("TEXT_MESSAGE_START");
    expect(types.slice(-2)).toEqual(["CUSTOM", "RUN_FINISHED"]);

    const custom = events.at(-2) as unknown as { name: string; value: { approval: { id: string } } };
    expect(custom.name).toBe(CUSTOM_EVENTS.approvalRequested);
    expect(custom.value.approval.id).toBe(`apr_${toolCallId}`);

    const finished = events.at(-1) as unknown as {
      outcome: {
        type: string;
        interrupts: {
          id: string;
          toolCallId: string;
          reason: string;
          message: string;
          metadata: Record<string, unknown>;
        }[];
      };
    };
    expect(finished.outcome.type).toBe("interrupt");
    expect(finished.outcome.interrupts).toHaveLength(1);
    const [interrupt] = finished.outcome.interrupts;
    expect(interrupt).toMatchObject({
      id: toolCallId,
      toolCallId,
      reason: APPROVAL_INTERRUPT_REASON,
      message: "Run mail_send",
      metadata: {
        approvalId: `apr_${toolCallId}`,
        summary: "Run mail_send",
        tool: { name: "mail_send", kind: "send" },
        findings: [],
        canAlways: true,
      },
    });
    expect(fakes.mail.sent).toHaveLength(0);
    expect(requests()).toHaveLength(1);
  });

  it("acts on resume when the database says allowed, then the model answers", async () => {
    const parked = await parkEmail();
    fakes.governance.answers.set(parked.toolCallId, "once");
    llm.clearRequests();
    const turn = await runTurn(
      agent(),
      parked.messages,
      { resume: [{ interruptId: parked.toolCallId, status: "resolved", payload: { answer: "refuse" } }] },
      "thr_approval",
    );
    expect(turn.error).toBeUndefined();
    const resumes = fakes.governance.calls.filter((c) => c.mode === "resume");
    expect(resumes).toHaveLength(1);
    expect(resumes[0]?.call.toolCallId).toBe(parked.toolCallId);
    // The payload said refuse; the database said once. The database wins.
    expect(fakes.mail.sent).toHaveLength(1);
    expect(results(turn.events)[0]?.content).toMatchObject({ ok: true, data: { sent: true } });
    expect(text(turn.events)).toBe("Sent. Sam has it.");
    expect(turn.types[0]).toBe("RUN_STARTED");
    expect(turn.types.at(-1)).toBe("RUN_FINISHED");
    expect((turn.events.at(-1) as unknown as { outcome?: { type: string } }).outcome?.type).not.toBe(
      "interrupt",
    );
    expect(requests()).toHaveLength(1);

    // A second resume of the same call finds it answered in history and does nothing.
    llm.clearRequests();
    const again = await runTurn(
      agent(),
      turn.messages,
      { resume: [{ interruptId: parked.toolCallId, status: "resolved" }] },
      "thr_approval",
    );
    expect(again.types).toEqual(["RUN_STARTED", "RUN_FINISHED"]);
    expect(requests()).toHaveLength(0);
    expect(fakes.mail.sent).toHaveLength(1);
  });

  it("treats a cancelled resume as a refusal but still closes it through the gateway", async () => {
    const parked = await parkEmail();
    fakes.governance.answers.set(parked.toolCallId, "once");
    script(() => ({ content: "OK, I didn't send it." }));
    const turn = await runTurn(agent(), parked.messages, {
      resume: [{ interruptId: parked.toolCallId, status: "cancelled" }],
    });
    expect(fakes.governance.calls.filter((c) => c.mode === "resume")).toHaveLength(1);
    expect(fakes.mail.sent).toHaveLength(0);
    expect(results(turn.events)[0]?.content).toEqual({
      ok: false,
      refused: true,
      message: CANCELLED_BY_PERSON,
    });
  });

  it("relays the person's refusal recorded in the database", async () => {
    const parked = await parkEmail();
    fakes.governance.answers.set(parked.toolCallId, "refuse");
    const turn = await runTurn(agent(), parked.messages, {
      resume: [{ interruptId: parked.toolCallId, status: "resolved" }],
    });
    expect(fakes.mail.sent).toHaveLength(0);
    expect(results(turn.events)[0]?.content).toMatchObject({
      ok: false,
      refused: true,
      message: "The person refused this.",
    });
  });

  it("closes the approval but does not act when the tool was withdrawn meanwhile", async () => {
    const parked = await parkEmail();
    fakes.governance.answers.set(parked.toolCallId, "once");
    script(() => ({ content: "I can't send email any more." }));
    const reader = {
      id: "steward",
      name: "Steward",
      title: "",
      instructions: "",
      skills: [],
      tools: ["web_fetch"],
    };
    const turn = await runTurn(agent({ profile: reader }), parked.messages, {
      resume: [{ interruptId: parked.toolCallId, status: "resolved" }],
    });
    expect(fakes.governance.calls.filter((c) => c.mode === "resume")).toHaveLength(1);
    expect(fakes.mail.sent).toHaveLength(0);
    expect(results(turn.events)[0]?.content).toEqual({ ok: false, error: NO_LONGER_GRANTED });
  });

  it("parks again when the resume arrives before the person answered", async () => {
    const parked = await parkEmail();
    const turn = await runTurn(agent(), parked.messages, {
      resume: [{ interruptId: parked.toolCallId, status: "resolved" }],
    });
    expect(turn.types.slice(-2)).toEqual(["CUSTOM", "RUN_FINISHED"]);
    expect((turn.events.at(-1) as unknown as { outcome: { type: string } }).outcome.type).toBe("interrupt");
    expect(fakes.mail.sent).toHaveLength(0);
  });
});

describe("taint", () => {
  it("is false before any outside content and true after a web_fetch result", async () => {
    script((req) => {
      const tools = req.messages.filter((m) => m.role === "tool").length;
      if (tools === 0) return toolCall("web_fetch", { url: "https://example.com" });
      if (tools === 1)
        return toolCall("mail_send", { to: ["sam@example.com"], subject: "Page", body: "Read this." });
      return { content: "Done." };
    });
    await runTurn(agent(), [user("read example.com and email sam")]);
    expect(fakes.governance.callsFor("web_fetch")[0]?.tainted).toBe(false);
    const [send] = fakes.governance.callsFor("mail_send");
    expect(send?.tainted).toBe(true);
    expect(send?.target).toEqual({ recipients: ["sam@example.com"] });
    expect(send?.outbound).toBe("Page\n\nRead this.");
  });

  it("carries over from the conversation's history", async () => {
    const history: Message[] = [
      user("read the page"),
      {
        id: "a1",
        role: "assistant",
        toolCalls: [
          { id: "call_old", type: "function", function: { name: "mail_read", arguments: '{"id":"m1"}' } },
        ],
      },
      { id: "t1", role: "tool", toolCallId: "call_old", content: JSON.stringify({ ok: true, data: {} }) },
      { id: "a2", role: "assistant", content: "Read it." },
      user("now run ls"),
    ];
    script((req) => (lastIsTool(req) ? { content: "Done." } : toolCall("shell_run", { command: "ls" })));
    await runTurn(agent(), history);
    expect(fakes.governance.callsFor("shell_run")[0]?.tainted).toBe(true);
  });

  it("does not count a refused read", async () => {
    const history: Message[] = [
      user("read it"),
      {
        id: "a1",
        role: "assistant",
        toolCalls: [{ id: "call_old", type: "function", function: { name: "web_fetch", arguments: "{}" } }],
      },
      {
        id: "t1",
        role: "tool",
        toolCallId: "call_old",
        content: JSON.stringify({ ok: false, refused: true, message: "No." }),
      },
      user("save a note"),
    ];
    script((req) =>
      lastIsTool(req) ? { content: "Saved." } : toolCall("file_write", { path: "n.md", content: "x" }),
    );
    await runTurn(agent(), history);
    expect(fakes.governance.callsFor("file_write")[0]?.tainted).toBe(false);
  });
});

describe("who started the run", () => {
  it("is the routine only when the server's token comes with it", async () => {
    script((req) => (lastIsTool(req) ? { content: "Done." } : toolCall("brief_today", {})));
    await runTurn(agent(), [user("Give me my morning brief.")], {
      forwardedProps: { steward: { token: SERVER_TOKEN, initiator: { kind: "routine", id: "rtn_1" } } },
    });
    expect(fakes.governance.callsFor("brief_today")[0]?.initiator).toEqual({ kind: "routine", id: "rtn_1" });
    expect(systemOf(requests()[0])).toContain("A routine is running on its schedule");
  });

  it("is the person when a browser claims to be a routine", async () => {
    script((req) => (lastIsTool(req) ? { content: "Done." } : toolCall("brief_today", {})));
    await runTurn(agent(), [user("brief")], {
      forwardedProps: { steward: { token: "guessed", initiator: { kind: "routine", id: "rtn_1" } } },
    });
    expect(fakes.governance.callsFor("brief_today")[0]?.initiator).toEqual({ kind: "person", id: "local" });
    expect(systemOf(requests()[0])).not.toContain("A routine is running");
  });
});

describe("history and errors", () => {
  it("drops a dangling tool call before the model sees the history", async () => {
    script(() => ({ content: "Hello again." }));
    const history: Message[] = [
      user("send it"),
      {
        id: "a1",
        role: "assistant",
        toolCalls: [
          { id: "call_dangling", type: "function", function: { name: "mail_send", arguments: "{}" } },
        ],
      },
      user("never mind, hello"),
    ];
    const turn = await runTurn(agent(), history);
    expect(turn.error).toBeUndefined();
    const sent = requests()[0]?.messages ?? [];
    expect(sent.some((m) => (m.tool_calls ?? []).some((c) => c.id === "call_dangling"))).toBe(false);
    expect(text(turn.events)).toBe("Hello again.");
  });

  it("gives the model another turn after a call it answered itself, such as bad arguments", async () => {
    script((req) =>
      req.messages.some((m) => m.role === "tool")
        ? { content: "I need a web address." }
        : toolCall("web_fetch", {}),
    );
    const turn = await runTurn(agent(), [user("fetch")]);
    expect(fakes.governance.calls).toHaveLength(0);
    expect(requests()).toHaveLength(2);
    expect(text(turn.events)).toBe("I need a web address.");
  });

  it("reports a model failure once as RUN_ERROR, in plain words, and never throws", async () => {
    script(() => ({ error: { message: "model is down", type: "invalid_request_error" }, status: 400 }));
    const turn = await runTurn(agent(), [user("hello")]);
    const errors = turn.events.filter((e) => e.type === "RUN_ERROR") as unknown as { message: string }[];
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("The model could not answer: model is down");
    expect(turn.types).not.toContain("RUN_FINISHED");
  });

  it("tells the model about malformed arguments without asking the person or the gateway", async () => {
    fakes.governance.decide = () => "ask";
    script((req) =>
      lastIsTool(req)
        ? { content: "Whose address is it?" }
        : toolCall("mail_send", { to: ["sam at example"], subject: "Hi", body: "Hello" }),
    );
    const turn = await runTurn(agent(), [user("email sam")]);
    expect(fakes.governance.calls).toHaveLength(0);
    expect(results(turn.events)[0]?.content).toEqual({
      ok: false,
      error: '"sam at example" in "to" is not an email address.',
    });
    expect(turn.types).not.toContain("CUSTOM");
    expect(text(turn.events)).toBe("Whose address is it?");
  });

  it("stops after the step limit with a plain sentence", async () => {
    script(() => toolCall("file_list", {}));
    const turn = await runTurn(agent({ maxSegments: 2 }), [user("loop")]);
    expect(fakes.governance.callsFor("file_list")).toHaveLength(2);
    expect(text(turn.events)).toBe(TOO_MANY_STEPS);
    expect(turn.types.at(-1)).toBe("RUN_FINISHED");
  });

  it("stops a tool that is waiting when the run is aborted", async () => {
    const computer = fakes.computers.computer("steward");
    let started!: () => void;
    const waiting = new Promise<void>((r) => (started = r));
    computer.requestHelp = (_reason: string, opts?: { signal?: AbortSignal }) =>
      new Promise<{ released: boolean }>((_resolve, reject) => {
        started();
        opts?.signal?.addEventListener("abort", () => reject(new Error("Stopped.")));
      });
    script((req) =>
      lastIsTool(req) ? { content: "never" } : toolCall("request_help", { reason: "Sign in, please." }),
    );

    const base = agent();
    const clone = base.clone();
    clone.setMessages([user("log me in")]);
    clone.threadId = "thr_stop";
    const events: BaseEvent[] = [];
    const run = clone.runAgent({ runId: "run_stop" }, { onEvent: ({ event }) => void events.push(event) });
    await waiting;
    clone.abortRun();
    await run;
    expect(results(events)[0]?.content).toEqual({ ok: false, error: "Stopped." });
    expect(events.at(-1)?.type).toBe("RUN_FINISHED");
    expect(requests()).toHaveLength(1);
  });
});

describe("the agent", () => {
  it("stays a StewardAgent with its middleware through clones", async () => {
    const base = agent();
    const twice = base.clone().clone();
    expect(twice).toBeInstanceOf(StewardAgent);
    expect(twice.agentId).toBe("steward");
    script((req) => (lastIsTool(req) ? { content: "Listed." } : toolCall("file_list", {})));
    const turn = await runTurn(twice, [user("list")]);
    expect(fakes.governance.callsFor("file_list")).toHaveLength(1);
    expect(turn.types).toContain("TOOL_CALL_RESULT");
  });

  it("offers only the built-in tools the profile grants", async () => {
    script(() => ({ content: "OK." }));
    await runTurn(
      agent({
        profile: {
          id: "reader",
          name: "Reader",
          title: "",
          instructions: "",
          skills: [],
          tools: ["web_fetch", "web_search"],
        },
      }),
      [user("hi")],
    );
    const offered = (requests()[0]?.tools ?? [])
      .map((t) => t.function.name)
      .filter((n) => !n.startsWith("AGUI"));
    expect(offered.sort()).toEqual(["web_fetch", "web_search"]);
  });
});
