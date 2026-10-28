/**
 * Who takes a new conversation: Steward, or a bot the person added. The default agent is listed
 * first; a bot is named with "(bot)" after it, so the list reads plainly without colour or icons.
 * Nothing is drawn while there is only one choice.
 */
import type { AgentProfile, AppInfo } from "@steward/shared";
import { useId } from "react";
import { Select } from "@/components/ui/Field.tsx";
import { useInfo } from "@/lib/api.ts";
import { cn } from "@/lib/utils.ts";

export interface AgentChoice {
  id: string;
  label: string;
  bot: boolean;
}

export function isBotAgent(agent: Pick<AgentProfile, "source">): boolean {
  return typeof agent.source === "string" && agent.source.startsWith("bot:");
}

/** The agents as choices: the default first, then the rest in the order the server lists them. */
export function agentChoices(info: Pick<AppInfo, "agents"> | undefined): AgentChoice[] {
  const agents = info?.agents ?? [];
  return agents.map((agent) => {
    const bot = isBotAgent(agent);
    return { id: agent.id, label: bot ? `${agent.name} (bot)` : agent.name, bot };
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
  const info = useInfo();
  const id = useId();
  const hintId = `${id}-hint`;
  const choices = agentChoices(info.data);
  if (choices.length < 2) return null;
  return (
    <div className={cn("flex w-full max-w-sm flex-col gap-1.5 text-left", className)}>
      <label htmlFor={id} className="font-medium text-ink text-sub">
        Who should take this?
      </label>
      <Select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hintId}
        disabled={disabled}
      >
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </Select>
      <p id={hintId} className="m-0 text-caption text-ink-2">
        Steward, or a bot you added. Every one of them follows your rules.
      </p>
    </div>
  );
}
