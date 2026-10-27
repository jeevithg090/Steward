import { AsyncLocalStorage } from "node:async_hooks";
import type { ActivityItem } from "@steward/shared";
import { newId, nowIso } from "@steward/shared";

/**
 * The Activity tab: one plain line per thing the agent did on its computer ("Opened
 * news.ycombinator.com", "Ran `ls -la`", "Saved notes.md (2.1 KB)"). Lines never carry typed text,
 * secrets or file contents; a shell line may carry a short tail of the command's output.
 */

export const ACTIVITY_CAPACITY = 500;
const OUTPUT_PREVIEW = 300;

const toolCall = new AsyncLocalStorage<string>();

/**
 * Runs `fn` with a tool call id attached, so every activity line it causes links back to the call
 * in the conversation. The agent wraps each governed computer call in it.
 */
export function withToolCall<T>(toolCallId: string, fn: () => Promise<T>): Promise<T> {
  return toolCall.run(toolCallId, fn);
}

/** The tool call the current code runs under, if the agent attached one. */
export function currentToolCall(): string | undefined {
  return toolCall.getStore();
}

export type ActivityInput = Omit<ActivityItem, "id" | "at" | "agentId" | "toolCallId">;

export class ActivityLog {
  private items: ActivityItem[] = [];

  constructor(
    private readonly agentId: string,
    private readonly onAdd: (item: ActivityItem) => void,
    private readonly capacity = ACTIVITY_CAPACITY,
  ) {}

  add(input: ActivityInput): ActivityItem {
    const id = currentToolCall();
    const item: ActivityItem = {
      id: newId("act"),
      at: nowIso(),
      agentId: this.agentId,
      ...(id ? { toolCallId: id } : {}),
      kind: input.kind,
      text: input.text,
      ...(input.output ? { output: preview(input.output) } : {}),
      ok: input.ok,
    };
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
    this.onAdd(item);
    return item;
  }

  /** The newest `limit` lines, oldest first. */
  list(limit = 100): ActivityItem[] {
    const n = Math.max(0, Math.min(this.capacity, Math.floor(Number.isFinite(limit) ? limit : 100)));
    return n === 0 ? [] : this.items.slice(-n);
  }
}

function preview(output: string): string {
  const text = output.trim();
  return text.length > OUTPUT_PREVIEW ? `…${text.slice(-OUTPUT_PREVIEW)}` : text;
}

/** A command as one short line: "Ran `npm test`". */
export function commandLabel(command: string, max = 80): string {
  const line = command.trim().replace(/\s*\n\s*/g, " ⏎ ");
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** An element as the person sees it: 'More', or "a button" when it has no name. */
export function elementLabel(role: string, name: string): string {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean) return `'${clean.length > 60 ? `${clean.slice(0, 59)}…` : clean}'`;
  const article = /^[aeiou]/.test(role) ? "an" : "a";
  return `${article} ${role}`;
}

export function durationLabel(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  return `${Math.round(ms / 60_000)} min`;
}
