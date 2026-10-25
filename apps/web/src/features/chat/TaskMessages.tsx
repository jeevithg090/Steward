import { CornerDownRight } from "lucide-react";
import { Badge, type BadgeTone, FOCUS } from "@/components/ui";
import { LedgerCounter } from "@/components/mission";
import type { Intent } from "@/lib/api";
import { linkProps } from "@/router";
import { FindingCard } from "../connectors/FindingCard";
import { AudioMessage } from "./AudioMessage";
import { LetterReadingCard } from "./LetterReadingCard";
import { ScamVerdictCard } from "./ScamVerdictCard";
import type { ThreadMessage } from "./store";

export const INTENT_WORDS: Record<Intent, string> = {
  rail_delay: "Delay Repay",
  missed_visit: "Missed visit",
  scam_check: "Scam Shield",
  letter: "Read It To Me",
  memory_recall: "Memory",
  memory_forget: "Memory",
  ledger: "Time Ledger",
  entitlement: "Am I owed?",
  approve: "Yes",
  decline: "No",
  stop: "STOP",
  profiles: "Profiles",
  help: "Help",
  smalltalk: "Chat",
  sweep: "Connectors",
};

const INTENT_TONE: Partial<Record<Intent, BadgeTone>> = {
  scam_check: "rose",
  stop: "rose",
  approve: "emerald",
  ledger: "emerald",
  sweep: "emerald",
  memory_recall: "purple",
  memory_forget: "purple",
};

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * The words in the bubble. A reply whose details are shown right under it is introduced, not
 * repeated: the ask still waiting (its card below says it in full) and a list of memories.
 */
function shown(message: ThreadMessage, pendingSummary: string | null): string {
  if (message.role !== "user" && pendingSummary && message.text.trim() === pendingSummary.trim()) return "I've worked it out. Here is what I'd claim; it needs your OK first.";
  if (message.memories && message.memories.length > 0) {
    const colon = message.text.indexOf(": ");
    if (colon > 0 && colon < 60) return message.text.slice(0, colon + 1);
  }
  return message.text;
}

interface TaskMessagesProps {
  messages: ThreadMessage[];
  /** The consent question still waiting, so the bubble that says the same thing is not repeated in full. */
  pendingSummary?: string | null;
  onSpeak?: (text: string) => void;
  onFeedback?: (alertId: string, label: "scam" | "real") => Promise<void>;
  /** Send a suggestion as if typed (ChatReply.suggestions, plan.md §12.2). */
  onSuggest?: (text: string) => void;
  /** A /chat call is in flight: show the typing dots. */
  thinking?: boolean;
  /** Something is in flight: suggestion chips wait. */
  busy?: boolean;
}

/** Three dots in an agent bubble while Tempo works out the reply; read out once as "Tempo is thinking". */
export function TypingIndicator() {
  return (
    <div role="status" className="surface mt-4 inline-flex items-center gap-1.5 rounded-3xl rounded-bl-md px-4 py-3.5">
      <span className="sr-only">Tempo is thinking</span>
      {[0, 150, 300].map((delay) => (
        <span key={delay} aria-hidden style={{ animationDelay: `${delay}ms` }} className="h-2 w-2 animate-bounce rounded-full bg-gradient-to-b from-accent-200 to-accent-400 motion-reduce:animate-none" />
      ))}
    </div>
  );
}

export function TaskMessages({ messages, pendingSummary = null, onSpeak, onFeedback, onSuggest, thinking = false, busy = false }: TaskMessagesProps) {
  const last = messages[messages.length - 1];

  return (
    <div role="log" aria-label="Conversation" className="pr-1">
      <ol className="space-y-5">
      {messages.map((message) => {
        const isUser = message.role === "user";
        if (message.kind === "status") {
          return (
            <li key={message.id} className="px-2 text-center text-xs italic text-slate-400">
              {message.text}
            </li>
          );
        }
        return (
          <li key={message.id} className={`max-w-[88%] px-4 py-3 text-[14.5px] text-white motion-safe:animate-fade-up lg:max-w-[78%] ${isUser ? "ml-auto w-fit rounded-3xl rounded-br-md bg-gradient-to-b from-accent-600 to-accent-700 shadow-[0_1px_0_0_rgb(255_255_255/0.18)_inset,0_14px_30px_-16px_rgb(var(--accent-600)/0.9)]" : "surface rounded-3xl rounded-bl-md px-5 py-4"}`}>
            <span className="sr-only">{isUser ? "You said: " : "Tempo said: "}</span>
            {!isUser && message.intent && (
              <Badge tone={INTENT_TONE[message.intent] ?? "indigo"} className="mb-1.5">
                {INTENT_WORDS[message.intent]}
              </Badge>
            )}
            {message.audio ? <AudioMessage audio={message.audio} /> : <p className="whitespace-pre-wrap leading-relaxed">{shown(message, pendingSummary)}</p>}
            {message.verdict && <ScamVerdictCard verdict={message.verdict} onFeedback={onFeedback} />}
            {message.letter && <LetterReadingCard reading={message.letter} onSpeak={onSpeak} />}
            {message.memories && message.memories.length > 0 && (
              <ul aria-label="What Tempo remembers" className="mt-3 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07] bg-white/[0.02]">
                {message.memories.map((m) => {
                  const when = m.when ?? m.observed_at;
                  const details = [m.category?.replaceAll("_", " "), m.source?.replaceAll("_", " "), when ? shortDate(when) : null, m.trust === "untrusted" ? "unchecked" : null].filter(Boolean);
                  return (
                    <li key={m.id} className="px-3 py-2">
                      <span className="block text-sm text-slate-100">{m.text}</span>
                      {details.length > 0 && <span className="block text-[11px] text-slate-400">{details.join(" · ")}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            {message.findings && message.findings.length > 0 && (
              <ul aria-label="What Tempo found" className="mt-3 space-y-2">
                {message.findings.map((f) => (
                  <li key={f.id} className="min-w-0">
                    <FindingCard finding={f} compact />
                  </li>
                ))}
              </ul>
            )}
            {message.ledger && (
              <div className="mt-3">
                <LedgerCounter totals={message.ledger} compact />
              </div>
            )}
            {message.flags && message.flags.length > 0 && (
              <ul aria-label="What may be worth claiming" className="mt-3 space-y-1.5">
                {message.flags.map((f) => (
                  <li key={f.benefit} className="text-xs">
                    <span className="font-medium text-slate-100">{f.benefit}</span> <Badge tone={f.likelihood === "likely" ? "emerald" : "amber"}>{f.likelihood}</Badge>
                    {f.weekly_gbp && <span className="text-slate-300"> · about £{f.weekly_gbp} a week</span>}
                    <span className="block text-slate-400">{f.why}</span>
                    <a href={f.signpost} target="_blank" rel="noreferrer" className={`text-accent-300 underline decoration-accent-300/40 underline-offset-2 hover:decoration-accent-300 ${FOCUS} rounded`}>
                      official page
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {message.actions && message.actions.length > 0 && (
              <ul aria-label="Open the page" className="mt-3 flex flex-wrap gap-2">
                {message.actions.map((a) => (
                  <li key={a.href}>
                    <a {...linkProps(a.href)} className={`inline-flex min-h-9 items-center rounded-full border border-accent-300/30 bg-accent-500/[0.12] px-3.5 py-1.5 text-xs font-medium text-accent-50 transition-colors hover:bg-accent-500/25 ${FOCUS}`}>
                      {a.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {message.simulated && message.simulated.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-400">Simulated in this run: {message.simulated.join(", ")}.</p>
            )}
            {message === last && !thinking && onSuggest && message.suggestions && message.suggestions.length > 0 && (
              <ul aria-label="You could say" className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {message.suggestions.map((text) => (
                  <li key={text} className="min-w-0">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onSuggest(text)}
                      className={`flex min-h-11 w-full items-start gap-2 whitespace-normal break-words rounded-2xl border border-accent-300/25 bg-accent-500/[0.08] px-3.5 py-2.5 text-left text-sm leading-snug text-accent-50 transition-colors hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none sm:w-auto ${FOCUS}`}
                    >
                      <CornerDownRight size={14} aria-hidden className="mt-0.5 shrink-0 text-accent-300" />
                      <span>{text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
      </ol>
      {thinking && <TypingIndicator />}
    </div>
  );
}
