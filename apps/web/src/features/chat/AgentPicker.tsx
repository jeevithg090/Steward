/**
 * Who takes a new conversation: Steward, another Steward on a different model, an external coding
 * agent (Claude Code, Gemini CLI), or a bot the person added. The default agent is listed first; a
 * bot is named with "(bot)" after it. Under each name is the model it runs on, or for a coding
 * agent how it signs in ("via Claude Code (your login)"). An agent that cannot answer (no key, or
 * its program is not installed) is greyed out and says why: it cannot be chosen until that is
 * fixed. Nothing is drawn while there is only one choice.
 *
 * A group of radio buttons rather than a select, so every agent's model is visible at once and a
 * screen reader hears the reason an agent is unavailable as its description.
 */
import type { AgentInfo } from "@steward/shared";
import { useId } from "react";
import { useAgents } from "@/lib/api.ts";
import { providerLabel } from "@/lib/labels.ts";
import { cn } from "@/lib/utils.ts";

export interface AgentChoice {
  id: string;
  label: string;
  bot: boolean;
  available: boolean;
  /** "xAI · grok-4.7". */
  model: string;
  /** Why it cannot be chosen, when it cannot. */
  reason?: string;
}

export function isBotAgent(agent: Pick<AgentInfo, "source">): boolean {
  return typeof agent.source === "string" && agent.source.startsWith("bot:");
}

/** An external coding agent: the vendor's own tool, run by Steward. */
export function isHarnessAgent(agent: Pick<AgentInfo, "harness">): boolean {
  return typeof agent.harness === "string" && agent.harness !== "";
}

/** The line under an agent's name: its model, or for a coding agent how it signs in. */
export function modelLine(
  agent: Pick<AgentInfo, "harness" | "provider" | "model" | "signIn" | "name">,
): string {
  if (isHarnessAgent(agent)) {
    return `via ${agent.name} (${agent.signIn === "vendor-tool" ? "your login" : "API key"})`;
  }
  return `${providerLabel(agent.provider)} · ${agent.model}`;
}

/** The agents as choices: the default first, then the rest in the order the server lists them. */
export function agentChoices(agents: readonly AgentInfo[] | undefined): AgentChoice[] {
  return (agents ?? []).map((agent) => {
    const bot = isBotAgent(agent);
    return {
      id: agent.id,
      label: bot ? `${agent.name} (bot)` : agent.name,
      bot,
      available: agent.available,
      model: modelLine(agent),
      ...(agent.reason ? { reason: agent.reason } : {}),
    };
  });
}

export function AgentPicker({
  value,
  onChange,
  disabled,
  className,
}: {
  value: string;
  onChange: (agentId: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const agents = useAgents();
  const id = useId();
  const hintId = `${id}-hint`;
  const choices = agentChoices(agents.data?.agents);
  if (choices.length < 2) return null;
  return (
    <fieldset
      className={cn("m-0 flex w-full max-w-sm min-w-0 flex-col gap-1.5 border-0 p-0 text-left", className)}
      aria-describedby={hintId}
      disabled={disabled}
    >
      <legend className="mb-1.5 p-0 font-medium text-ink text-sub">Who should take this?</legend>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {choices.map((choice) => {
          const inputId = `${id}-${choice.id}`;
          const nameId = `${inputId}-name`;
          const noteId = `${inputId}-note`;
          const selected = choice.id === value;
          return (
            <li key={choice.id}>
              <label
                htmlFor={inputId}
                className={cn(
                  "flex min-h-target cursor-pointer items-start gap-3 rounded-field border px-3 py-2",
                  selected ? "border-accent bg-accent-soft" : "border-hair-2 bg-card hover:bg-tile",
                  !choice.available && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  id={inputId}
                  type="radio"
                  name={id}
                  value={choice.id}
                  checked={selected}
                  disabled={!choice.available}
                  onChange={() => onChange(choice.id)}
                  aria-labelledby={nameId}
                  aria-describedby={noteId}
                  className="mt-1 size-4 shrink-0 accent-accent"
                />
                <span className="flex min-w-0 flex-col">
                  <span id={nameId} className="font-medium text-ink text-sub">
                    {choice.label}
                  </span>
                  <span id={noteId} className="break-words text-caption text-ink-2">
                    {choice.available ? choice.model : (choice.reason ?? "Not available right now.")}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p id={hintId} className="m-0 text-caption text-ink-2">
        Steward on the model you chose, Steward on another, a coding agent, or a bot you added. Every one of
        them follows your rules.
      </p>
    </fieldset>
  );
}
