import { randomUUID } from "node:crypto";
import type { AbstractAgent, BaseEvent, Context, Message, ResumeEntry, RunAgentInput } from "@ag-ui/client";
import { ThreadAlreadyRunningError } from "@copilotkit/runtime/v2";
import type { Initiator } from "@steward/shared";
import { HttpError } from "../http/errors.ts";
import { type RunSummary, summariseRun } from "./run-summary.ts";
import { type NodeSqliteAgentRunner, SERVER_PROPS_KEY } from "./runner.ts";

export class ThreadBusyError extends HttpError {
  constructor() {
    super(409, "That conversation is busy right now. Try again in a moment.");
    this.name = "ThreadBusyError";
  }
}

export interface RunOnThreadOptions {
  agentId: string;
  threadId: string;
  /** A new user message to append, already framed when nobody typed it. */
  userText?: string;
  /** Answers to the interrupts the thread's last run ended with. */
  resume?: ResumeEntry[];
  initiator: Initiator;
  context?: Context[];
}

export interface RunResult extends RunSummary {
  runId: string;
  threadId: string;
}

export interface ServerRun {
  runId: string;
  threadId: string;
  /** Settles when the run has finished and been stored. Never rejects. */
  done: Promise<RunResult>;
}

/**
 * Runs the server starts itself: routines, tasks and the resume sweep. Each one goes through the
 * same runner as a browser's run, so it lands in the thread's history and any browser connected to
 * that thread sees it live. The run carries the server token in `forwardedProps.steward`, which is
 * how the agent knows a routine (not a person) started it; the runner strips it before storing.
 */
export class ServerRuns {
  private readonly initiators = new Map<string, Initiator>();

  constructor(
    private readonly deps: {
      runner: NodeSqliteAgentRunner;
      agent: (agentId: string) => AbstractAgent | undefined;
      serverRunToken: string;
    },
  ) {}

  /** Who started a run the server is driving, while it is in flight. */
  initiatorOf(runId: string): Initiator | undefined {
    return this.initiators.get(runId);
  }

  /** Resolves once the thread has no run in flight. */
  whenIdle(threadId: string): Promise<void> {
    return this.deps.runner.whenIdle(threadId);
  }

  /** Starts a run on a thread. Refuses (409) when the thread already has a run in flight. */
  start(opts: RunOnThreadOptions): ServerRun {
    const { runner } = this.deps;
    const base = this.deps.agent(opts.agentId);
    if (!base) throw new HttpError(404, "Couldn't find that agent.");
    if (runner.isThreadBusy(opts.threadId)) throw new ThreadBusyError();

    const agent = base.clone();
    agent.agentId = opts.agentId;
    const messages: Message[] = [...runner.getThreadMessages(opts.threadId)];
    if (opts.userText) messages.push({ id: randomUUID(), role: "user", content: opts.userText });
    agent.setMessages(messages);
    agent.setState(runner.getThreadState(opts.threadId) ?? {});
    agent.threadId = opts.threadId;

    const runId = randomUUID();
    const input: RunAgentInput = {
      threadId: opts.threadId,
      runId,
      messages,
      tools: [],
      context: opts.context ?? [],
      state: agent.state,
      forwardedProps: { [SERVER_PROPS_KEY]: { token: this.deps.serverRunToken, initiator: opts.initiator } },
      ...(opts.resume && opts.resume.length > 0 ? { resume: opts.resume } : {}),
    };

    let events$: ReturnType<NodeSqliteAgentRunner["run"]>;
    try {
      events$ = runner.run({ threadId: opts.threadId, agent, input });
    } catch (err) {
      if (err instanceof ThreadAlreadyRunningError) throw new ThreadBusyError();
      throw err;
    }
    this.initiators.set(runId, opts.initiator);

    const events: BaseEvent[] = [];
    const done = new Promise<RunResult>((resolve) => {
      const settle = (interruption?: string) => {
        this.initiators.delete(runId);
        resolve({ ...summariseRun(events, interruption), runId, threadId: opts.threadId });
      };
      events$.subscribe({
        next: (event) => events.push(event),
        complete: () => settle(),
        error: (err: unknown) => settle(err instanceof Error ? err.message : String(err)),
      });
    });
    return { runId, threadId: opts.threadId, done };
  }
}
