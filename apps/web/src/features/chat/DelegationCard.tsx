/**
 * A task handed to another agent: "Codex is working on: run the tests", then "Codex worked on: …".
 * Opening it shows what that agent said and did, as a list of its own. Its questions appear as
 * approval cards in this conversation, saying which agent asks.
 */
import { useId } from "react";
import { useInfo } from "@/lib/api.ts";
import { SubRunsContext, useSubRun } from "./subruns.tsx";
import { Transcript } from "./Transcript.tsx";
import type { ToolProps } from "./tool-cards.tsx";
import { readToolResult } from "./tool-result.ts";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function DelegationCard(tool: ToolProps) {
  const info = useInfo();
  const id = useId();
  const messages = useSubRun(tool.toolCallId);
  const agentId = text(tool.args.agentId) ?? "another agent";
  const name = info.data?.agents.find((a) => a.id === agentId)?.name ?? agentId;
  const task = text(tool.args.task) ?? "a task";
  const done = tool.status === "complete" && tool.result !== undefined;
  const outcome = done ? readToolResult(tool.result) : undefined;
  // A task that ended without an answer says so in its result: "… stopped without answering."
  const failed =
    outcome !== undefined && (outcome.status !== "ok" || /stopped without answering/.test(tool.result ?? ""));
  const heading = done
    ? failed
      ? `${name} could not finish: ${task}`
      : `${name} worked on: ${task}`
    : `${name} is working on: ${task}`;

  return (
    <details
      className="group rounded-card border border-hair-2 bg-card px-4 py-2 text-sub"
      aria-describedby={`${id}-state`}
    >
      <summary className="flex min-h-target cursor-pointer list-none items-center gap-2 text-ink">
        <span aria-hidden="true" className="text-ink-3 transition-transform group-open:rotate-90">
          ▸
        </span>
        <span className="min-w-0 flex-1 break-words font-medium">{heading}</span>
      </summary>
      <p id={`${id}-state`} className="sr-only">
        {done ? "Finished." : "Still working."} {messages.length > 0 ? "Open to see what it did." : ""}
      </p>
      <div className="mt-2 border-hair-2 border-l-2 pl-3">
        {messages.length > 0 ? (
          <SubRunsContext.Provider value={new Map()}>
            <Transcript
              messages={messages}
              running={!done}
              nested
              label={`What ${name} did`}
              speaker={name}
            />
          </SubRunsContext.Provider>
        ) : (
          <p className="m-0 text-ink-2">{done ? "It said nothing on the way." : "Starting…"}</p>
        )}
      </div>
    </details>
  );
}
