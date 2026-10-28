import { randomUUID } from "node:crypto";
import { type BaseEvent, EventType } from "@ag-ui/client";
import type { HarnessUpdate } from "./types.ts";

type Emit = (event: BaseEvent) => void;

/** What a tool result reads as in the conversation: the same envelope Steward's own tools use. */
function envelope(ok: boolean, output: string | undefined): string {
  return JSON.stringify(
    ok ? { ok: true, data: output ?? null } : { ok: false, error: output || "It did not finish." },
  );
}

/**
 * Turns a harness's updates into well-formed AG-UI events: one text message per stretch of words,
 * a reasoning message per stretch of thinking, and for each tool call START, ARGS, END and later
 * its RESULT. The AG-UI id of a tool call is `idOf(callId)`, the same id its approval uses.
 *
 * One stream lives as long as a harness turn, which can outlast a run: a turn parked on an approval
 * continues in the resume run, so the call it parked on is shown once and gets its result later.
 * Each run attaches its own `emit`.
 */
export class AgUiStream {
  private text: { id: string; source?: string } | undefined;
  private reasoning: string | undefined;
  private started = new Set<string>();
  private finished = new Set<string>();
  private emit: Emit = () => {};

  constructor(readonly idOf: (callId: string) => string) {}

  /** Where this run's events go. */
  attach(emit: Emit): void {
    this.emit = emit;
  }

  /** A new turn: earlier calls are history and are not closed again. */
  beginTurn(): void {
    this.started = new Set();
    this.finished = new Set();
  }

  apply(update: HarnessUpdate): void {
    switch (update.type) {
      case "text": {
        this.closeReasoning();
        if (this.text && update.messageId && this.text.source && update.messageId !== this.text.source) {
          this.closeText();
        }
        if (!this.text) {
          const id = randomUUID();
          this.text = { id, ...(update.messageId ? { source: update.messageId } : {}) };
          this.emit({ type: EventType.TEXT_MESSAGE_START, messageId: id, role: "assistant" } as BaseEvent);
        }
        this.emit({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: this.text.id,
          delta: update.delta,
        } as BaseEvent);
        return;
      }
      case "thought": {
        this.closeText();
        if (!this.reasoning) {
          this.reasoning = randomUUID();
          this.emit({ type: EventType.REASONING_START, messageId: this.reasoning } as BaseEvent);
          this.emit({
            type: EventType.REASONING_MESSAGE_START,
            messageId: this.reasoning,
            role: "reasoning",
          } as BaseEvent);
        }
        this.emit({
          type: EventType.REASONING_MESSAGE_CONTENT,
          messageId: this.reasoning,
          delta: update.delta,
        } as BaseEvent);
        return;
      }
      case "tool_start":
        this.toolCall(update.callId, update.name, update.input);
        return;
      case "tool_end":
        this.toolResult(update.callId, update.ok, update.output);
        return;
    }
  }

  /** Shows a tool call, once. Called before a permission is decided, so the card has its call. */
  toolCall(callId: string, name: string, input: unknown): void {
    const id = this.idOf(callId);
    if (this.started.has(id)) return;
    this.closeText();
    this.closeReasoning();
    this.started.add(id);
    let args = "{}";
    try {
      args = JSON.stringify(input ?? {}) ?? "{}";
    } catch {
      // Not serialisable: shown without arguments.
    }
    this.emit({ type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: name } as BaseEvent);
    this.emit({ type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: args } as BaseEvent);
    this.emit({ type: EventType.TOOL_CALL_END, toolCallId: id } as BaseEvent);
  }

  toolResult(callId: string, ok: boolean, output?: string): void {
    const id = this.idOf(callId);
    if (this.finished.has(id)) return;
    if (!this.started.has(id)) this.toolCall(callId, "harness_tool", {});
    this.closeText();
    this.closeReasoning();
    this.finished.add(id);
    this.emit({
      type: EventType.TOOL_CALL_RESULT,
      messageId: randomUUID(),
      toolCallId: id,
      role: "tool",
      content: envelope(ok, output),
    } as BaseEvent);
  }

  /** Ends any open message. With `stopped`, calls still open are closed as not finished. */
  close(stopped?: string): void {
    this.closeText();
    this.closeReasoning();
    if (stopped === undefined) return;
    for (const id of this.started) {
      if (this.finished.has(id)) continue;
      this.finished.add(id);
      this.emit({
        type: EventType.TOOL_CALL_RESULT,
        messageId: randomUUID(),
        toolCallId: id,
        role: "tool",
        content: envelope(false, stopped),
      } as BaseEvent);
    }
  }

  /** One whole assistant message, for notices. */
  say(text: string): void {
    this.closeText();
    this.closeReasoning();
    const id = randomUUID();
    this.emit({ type: EventType.TEXT_MESSAGE_START, messageId: id, role: "assistant" } as BaseEvent);
    this.emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: id, delta: text } as BaseEvent);
    this.emit({ type: EventType.TEXT_MESSAGE_END, messageId: id } as BaseEvent);
  }

  private closeText(): void {
    if (!this.text) return;
    this.emit({ type: EventType.TEXT_MESSAGE_END, messageId: this.text.id } as BaseEvent);
    this.text = undefined;
  }

  private closeReasoning(): void {
    if (!this.reasoning) return;
    this.emit({ type: EventType.REASONING_MESSAGE_END, messageId: this.reasoning } as BaseEvent);
    this.emit({ type: EventType.REASONING_END, messageId: this.reasoning } as BaseEvent);
    this.reasoning = undefined;
  }
}
