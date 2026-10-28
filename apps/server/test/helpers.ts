import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AbstractAgent, type BaseEvent, EventType, type RunAgentInput, type TokenUsage } from "@ag-ui/client";
import { memoryDb } from "@steward/db";
import { Observable } from "rxjs";
import { NodeSqliteAgentRunner } from "../src/runtime/runner.ts";
import { migrations } from "../src/store/migrations.ts";

/**
 * A tiny AG-UI agent for the runner's own tests: it answers every run with one assistant message
 * built by `reply`, and records the inputs it saw. It is not a stand-in for `@steward/agent`.
 */
export class EchoAgent extends AbstractAgent {
  seen: RunAgentInput[] = [];
  reply: (input: RunAgentInput) => string = (input) => {
    const last = [...input.messages].reverse().find((m) => m.role === "user");
    return `echo: ${typeof last?.content === "string" ? last.content : ""}`;
  };
  /** Milliseconds to wait before answering, to hold a run open. */
  delayMs = 0;
  /** When set, the run ends with this interrupt instead of text. */
  interrupt?: { id: string; reason: string; metadata?: Record<string, unknown> };
  /** False makes the agent ignore Stop, like a stuck agent. */
  abortable = true;
  /** Token usage to report on RUN_FINISHED, as a real agent would. */
  usage?: TokenUsage[];
  private stopCurrent?: () => void;

  override clone(): EchoAgent {
    const copy = super.clone() as EchoAgent;
    copy.seen = this.seen;
    copy.reply = this.reply;
    copy.delayMs = this.delayMs;
    copy.abortable = this.abortable;
    if (this.interrupt) copy.interrupt = this.interrupt;
    if (this.usage) copy.usage = this.usage;
    return copy;
  }

  override abortRun(): void {
    if (this.abortable) this.stopCurrent?.();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.seen.push(input);
    return new Observable<BaseEvent>((sub) => {
      const timer = setTimeout(() => {
        const { threadId, runId } = input;
        sub.next({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent);
        if (this.interrupt) {
          sub.next({
            type: EventType.RUN_FINISHED,
            threadId,
            runId,
            outcome: {
              type: "interrupt",
              interrupts: [{ ...this.interrupt, toolCallId: this.interrupt.id }],
            },
          } as BaseEvent);
        } else {
          const messageId = `msg-${runId}`;
          sub.next({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent);
          sub.next({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId,
            delta: this.reply(input),
          } as BaseEvent);
          sub.next({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
          sub.next({
            type: EventType.RUN_FINISHED,
            threadId,
            runId,
            ...(this.usage ? { usage: this.usage } : {}),
          } as BaseEvent);
        }
        sub.complete();
      }, this.delayMs);
      this.stopCurrent = () => {
        clearTimeout(timer);
        sub.complete();
      };
      return () => clearTimeout(timer);
    });
  }
}

export function runnerOnMemoryDb() {
  const db = memoryDb(migrations);
  return { db, runner: new NodeSqliteAgentRunner(db) };
}

export function runInput(threadId: string, runId: string, text: string, extra: Partial<RunAgentInput> = {}) {
  return {
    threadId,
    runId,
    messages: [{ id: `u-${runId}`, role: "user" as const, content: text }],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
    ...extra,
  } satisfies RunAgentInput;
}

/** Drives one run through the runner the way the runtime's HTTP handler does. */
export function collect(observable: Observable<BaseEvent>): Promise<BaseEvent[]> {
  return new Promise((resolve, reject) => {
    const events: BaseEvent[] = [];
    observable.subscribe({ next: (e) => events.push(e), complete: () => resolve(events), error: reject });
  });
}

export function startRun(runner: NodeSqliteAgentRunner, agent: AbstractAgent, input: RunAgentInput) {
  const clone = agent.clone();
  clone.agentId = agent.agentId ?? "steward";
  clone.setMessages(input.messages);
  clone.setState(input.state ?? {});
  clone.threadId = input.threadId;
  return runner.run({ threadId: input.threadId, agent: clone, input });
}

/** A temporary folder removed by the returned function. */
export function tempDir(prefix = "steward-server-"): { dir: string; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A temp repo layout: `<root>/tenants/steward` (empty: the agent package's defaults apply). */
export function tempRepo(): { root: string; dataDir: string; tenantDir: string; remove: () => void } {
  const { dir, remove } = tempDir();
  const tenantDir = join(dir, "tenants", "steward");
  mkdirSync(tenantDir, { recursive: true });
  return { root: dir, dataDir: join(dir, "data"), tenantDir, remove };
}

/** Parses an AG-UI SSE body into events. */
export function parseSse(text: string): BaseEvent[] {
  const events: BaseEvent[] = [];
  for (const block of text.split("\n\n")) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as BaseEvent);
    } catch {
      // A keep-alive or a partial block.
    }
  }
  return events;
}

export async function waitFor<T>(
  check: () => T | undefined | false | Promise<T | undefined | false>,
  timeoutMs = 10_000,
  stepMs = 50,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/** Which package factories the server needs exist yet. Integration tests run only when all do. */
export async function missingPackages(): Promise<string[]> {
  const needs: [string, string[]][] = [
    ["@steward/gateway", ["createGateway", "migrations"]],
    ["@steward/computer", ["createComputerManager"]],
    [
      "@steward/connectors",
      ["createDemoGoogleApp", "createGoogleMailCalendar", "createMcpManager", "createWebTools", "migrations"],
    ],
    ["@steward/proactive", ["createProactive", "migrations"]],
    [
      "@steward/agent",
      ["createStewardAgent", "createModel", "createTextModel", "resolveModelConfig", "loadTenant"],
    ],
    ["@steward/bots", ["DirectoryClient", "validatePack", "hashPack", "profileFromPack", "describeMayDo"]],
  ];
  const missing: string[] = [];
  for (const [pkg, names] of needs) {
    try {
      const mod = (await import(pkg)) as Record<string, unknown>;
      for (const name of names) if (mod[name] === undefined) missing.push(`${pkg}#${name}`);
    } catch {
      missing.push(pkg);
    }
  }
  return missing;
}
