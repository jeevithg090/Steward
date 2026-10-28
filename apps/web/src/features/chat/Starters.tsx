/**
 * What an empty conversation offers: a greeting (never a name; Steward does not invent one), who
 * should take it (Steward or a bot the person added), and a few things to ask, from the tenant's
 * brand or Steward's defaults.
 *
 * Picking another agent starts a fresh conversation with it (`/chat?agent=`): an agent is fixed
 * once a thread exists. The empty one left behind is removed, so the list of conversations does not
 * fill with blanks.
 */
import { Sparkles } from "lucide-react";
import { useId } from "react";
import { useNavigate } from "react-router";
import { buttonVariants } from "@/components/ui/Button.tsx";
import { useDeleteThread, useInfo } from "@/lib/api.ts";
import { cn, greeting } from "@/lib/utils.ts";
import { AgentPicker } from "./AgentPicker.tsx";
import { useChatActions } from "./chat-context.tsx";

export const DEFAULT_STARTERS = [
  "What needs me today?",
  "What's on my calendar today?",
  "Open news.ycombinator.com and tell me the top story.",
  "Remember that I prefer short answers.",
];

export function Starters({ onPick, disabled }: { onPick: (text: string) => void; disabled?: boolean }) {
  const info = useInfo();
  const chat = useChatActions();
  const navigate = useNavigate();
  const remove = useDeleteThread();
  const titleId = useId();

  const agent = info.data?.agents.find((candidate) => candidate.id === chat?.agentId);
  const bot = typeof agent?.source === "string" && agent.source.startsWith("bot:");
  const starters = (bot ? [] : info.data?.starters?.length ? info.data.starters : DEFAULT_STARTERS).slice(
    0,
    6,
  );
  const name = bot && agent ? agent.name : (info.data?.brand.name ?? "Steward");

  function pickAgent(agentId: string) {
    if (!chat || agentId === chat.agentId) return;
    const empty = chat.threadId;
    navigate(`/chat?agent=${encodeURIComponent(agentId)}`, { replace: true });
    // Best effort: a blank left behind is noise, not data. A failure here changes nothing.
    remove.mutate(empty, { onError: () => {} });
  }

  return (
    <section
      aria-labelledby={titleId}
      className="mx-auto flex max-w-xl flex-col items-center gap-5 py-10 text-center"
    >
      <span className="grid size-12 place-items-center rounded-tile bg-accent-soft text-accent">
        <Sparkles aria-hidden className="size-6" />
      </span>
      <div>
        <h2 id={titleId} className="m-0 font-semibold text-ink text-title">
          {greeting()}. What can {name} do for you?
        </h2>
        <p className="m-0 mt-1 text-ink-2 text-sub">
          {bot && agent
            ? agent.title || `${agent.name} is a bot you added. It follows your rules like Steward does.`
            : `${name} works on its own computer and asks before it sends, pays, signs or deletes anything.`}
        </p>
      </div>
      {chat ? <AgentPicker value={chat.agentId} onChange={pickAgent} disabled={disabled} /> : null}
      {starters.length > 0 ? (
        <ul className="m-0 flex w-full list-none flex-col gap-2 p-0 sm:grid sm:grid-cols-2">
          {starters.map((starter) => (
            <li key={starter}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(starter)}
                className={cn(
                  buttonVariants({ variant: "secondary", size: "md" }),
                  "h-full w-full justify-start py-2.5 text-left",
                )}
              >
                {starter}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
