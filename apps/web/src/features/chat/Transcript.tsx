/**
 * The conversation, as a log a screen reader can follow.
 *
 * The list is a polite live region that announces additions only. A reply still streaming is
 * hidden from assistive technology (a short "Steward is writing" stands in), and when it finishes
 * its text is mounted afresh, so the finished reply is announced once rather than token by token.
 *
 * Tool calls draw through the renderers registered in `tools.tsx`; when none matches (the registry
 * is still loading), the generic line stands in.
 */
import { type Message, type ToolCall, type ToolMessage, useRenderToolCall } from "@copilotkit/react-core/v2";
import { memo } from "react";
import { cn } from "@/lib/utils.ts";
import { Markdown } from "./Markdown.tsx";
import { resultsById, textOf } from "./messages.ts";
import { GenericToolLine } from "./tool-cards.tsx";
import { renderWith } from "./tool-registry.tsx";

export function Transcript({
  messages,
  running,
  className,
}: {
  messages: readonly Message[];
  /** True while a reply is in progress, so the newest reply is treated as still streaming. */
  running: boolean;
  className?: string;
}) {
  const results = resultsById(messages);
  const lastAssistant = (() => {
    for (let i = messages.length - 1; i >= 0; i--)
      if (messages[i]?.role === "assistant") return messages[i]?.id;
    return undefined;
  })();

  return (
    <ol
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Conversation"
      className={cn("m-0 flex list-none flex-col gap-4 p-0", className)}
    >
      {messages.map((message) => {
        if (message.role === "user") {
          const content = textOf(message.content);
          if (!content.trim()) return null;
          return (
            <li key={message.id} className="flex justify-end">
              <div className="max-w-[min(85%,36rem)] whitespace-pre-wrap break-words rounded-card rounded-br-md bg-accent-soft px-4 py-2.5 text-body text-ink">
                <span className="sr-only">You said: </span>
                {content}
              </div>
            </li>
          );
        }
        if (message.role === "assistant") {
          const content = textOf(message.content);
          const calls = message.toolCalls ?? [];
          if (!content.trim() && calls.length === 0) return null;
          const streaming = running && message.id === lastAssistant;
          return (
            <li key={message.id} className="flex min-w-0 flex-col gap-1">
              {content.trim() ? <AssistantText content={content} streaming={streaming} /> : null}
              {calls.map((call) => (
                <ToolCallView key={call.id} call={call} result={results.get(call.id)} />
              ))}
            </li>
          );
        }
        return null;
      })}
    </ol>
  );
}

/**
 * While streaming, the text is shown but hidden from the accessibility tree. Once done, the `key`
 * changes, the node is replaced, and the log announces the finished reply as one addition.
 */
function AssistantText({ content, streaming }: { content: string; streaming: boolean }) {
  return (
    <div className="max-w-[44rem]">
      <span className="sr-only">Steward said: </span>
      {streaming ? (
        <>
          <span className="sr-only">Steward is writing…</span>
          <div key="streaming" aria-hidden="true">
            <Markdown streaming>{content}</Markdown>
          </div>
        </>
      ) : (
        <div key="done">
          <Markdown>{content}</Markdown>
        </div>
      )}
    </div>
  );
}

/**
 * One tool call. Memoised on the strings that matter, because `agent.messages` is mutated in
 * place and its objects cannot be compared by identity.
 */
const ToolCallView = memo(
  function ToolCallView({ call, result }: { call: ToolCall; result?: ToolMessage }) {
    const renderToolCall = useRenderToolCall();
    const drawn = renderToolCall({ toolCall: call, toolMessage: result });
    if (drawn) return drawn;
    let parameters: unknown = {};
    try {
      parameters = JSON.parse(call.function.arguments || "{}");
    } catch {
      parameters = {};
    }
    return renderWith(GenericToolLine, {
      name: call.function.name,
      toolCallId: call.id,
      parameters,
      status: result ? "complete" : "inProgress",
      result: result ? textOf(result.content) : undefined,
    });
  },
  (before, after) =>
    before.call.id === after.call.id &&
    before.call.function.name === after.call.function.name &&
    before.call.function.arguments === after.call.function.arguments &&
    before.result?.content === after.result?.content,
);
