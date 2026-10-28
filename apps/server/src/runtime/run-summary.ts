import {
  type BaseEvent,
  EventType,
  type Interrupt,
  type RunErrorEvent,
  type RunFinishedEvent,
  type TextMessageChunkEvent,
  type TextMessageContentEvent,
  type TokenUsage,
  type ToolCallResultEvent,
} from "@ag-ui/client";

export type RunOutcome = "success" | "interrupt" | "cancelled" | "error";

export interface RunSummary {
  outcome: RunOutcome;
  interrupts: Interrupt[];
  error?: string;
  /** The text of the last assistant message the run wrote. */
  text: string;
  /** Tool results the gateway refused, from the `{ ok: false, refused: true }` envelope. */
  refusals: string[];
  /** The run's token usage, one entry per provider and model, when the agent reported it. */
  usage?: TokenUsage[];
}

/** Tool results can arrive JSON-encoded twice through the runtime; parse until it is not a string. */
export function parseToolContent(content: unknown): unknown {
  let value = content;
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    try {
      value = JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/** Reads what a run did from its events: how it ended, what it said, what was refused. */
export function summariseRun(events: readonly BaseEvent[], interruptionMessage?: string): RunSummary {
  const texts = new Map<string, string>();
  let lastTextId: string | undefined;
  let finished: RunFinishedEvent | undefined;
  let error: string | undefined = interruptionMessage;
  const refusals: string[] = [];

  for (const event of events) {
    switch (event.type) {
      case EventType.TEXT_MESSAGE_CONTENT: {
        const e = event as TextMessageContentEvent;
        texts.set(e.messageId, (texts.get(e.messageId) ?? "") + e.delta);
        lastTextId = e.messageId;
        break;
      }
      case EventType.TEXT_MESSAGE_CHUNK: {
        const e = event as TextMessageChunkEvent;
        const id = e.messageId ?? lastTextId ?? "chunk";
        if (e.delta) texts.set(id, (texts.get(id) ?? "") + e.delta);
        lastTextId = id;
        break;
      }
      case EventType.TOOL_CALL_RESULT: {
        const value = parseToolContent((event as ToolCallResultEvent).content);
        if (value && typeof value === "object" && "refused" in value && value.refused === true) {
          const message =
            "message" in value && typeof value.message === "string" ? value.message : "Refused.";
          refusals.push(message);
        }
        break;
      }
      case EventType.RUN_FINISHED:
        finished = event as RunFinishedEvent;
        break;
      case EventType.RUN_ERROR:
        error = (event as RunErrorEvent).message || error || "The run failed.";
        break;
    }
  }

  const text = lastTextId ? (texts.get(lastTextId) ?? "") : "";
  const usage = runUsage(finished);
  const base = { text, refusals, ...(usage ? { usage } : {}) };
  if (error !== undefined) return { outcome: "error", interrupts: [], error, ...base };
  const outcome = finished?.outcome;
  if (outcome?.type === "interrupt") {
    return { outcome: "interrupt", interrupts: outcome.interrupts ?? [], ...base };
  }
  if (outcome?.type === "cancelled") return { outcome: "cancelled", interrupts: [], ...base };
  return { outcome: "success", interrupts: [], ...base };
}

/** The usage on a run's last event, when there is one with a count in it. */
function runUsage(finished: RunFinishedEvent | undefined): TokenUsage[] | undefined {
  const usage = finished?.usage;
  if (!Array.isArray(usage)) return undefined;
  const counted = usage.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof (entry.totalTokens ?? entry.inputTokens ?? entry.outputTokens) === "number",
  );
  return counted.length > 0 ? counted : undefined;
}

/** Collapses whitespace and cuts to `max` characters with an ellipsis. */
export function clip(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** One line on what a parked run is waiting for, from the approval interrupt's metadata. */
export function interruptSummary(summary: Pick<RunSummary, "interrupts">): string {
  const meta = summary.interrupts[0]?.metadata as { summary?: unknown } | undefined;
  return typeof meta?.summary === "string" && meta.summary.trim()
    ? clip(meta.summary)
    : "Steward is waiting for your answer before it goes on.";
}
