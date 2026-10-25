import { useEffect, useRef } from "react";
import { Badge, type BadgeTone, FOCUS } from "@/components/ui";
import { LedgerCounter } from "@/components/mission";
import type { Intent } from "@/lib/api";
import { linkProps } from "@/router";
import type { ChatMessage } from "@/types/types";
import { AudioMessage } from "./AudioMessage";
import { LetterReadingCard } from "./LetterReadingCard";
import { ScamVerdictCard } from "./ScamVerdictCard";

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
};

const INTENT_TONE: Partial<Record<Intent, BadgeTone>> = {
  scam_check: "rose",
  stop: "rose",
  approve: "emerald",
  ledger: "emerald",
  memory_recall: "purple",
  memory_forget: "purple",
};

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

interface TaskMessagesProps {
  messages: ChatMessage[];
  onSpeak?: (text: string) => void;
  onFeedback?: (alertId: string, label: "scam" | "real") => Promise<void>;
}

export function TaskMessages({ messages, onSpeak, onFeedback }: TaskMessagesProps) {
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view (jsdom has no scrollIntoView).
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length]);

  return (
    <div role="log" aria-label="Conversation" className="flex-1 overflow-y-auto pb-28 pr-1">
      <ol className="space-y-4">
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
          <li key={message.id} className={`max-w-[85%] rounded-2xl bg-nexus-card px-4 py-3 text-sm text-white ${isUser ? "ml-auto rounded-br-sm" : "rounded-bl-sm"}`}>
            <span className="sr-only">{isUser ? "You said: " : "Tempo said: "}</span>
            {!isUser && message.intent && (
              <Badge tone={INTENT_TONE[message.intent] ?? "indigo"} className="mb-1.5">
                {INTENT_WORDS[message.intent]}
              </Badge>
            )}
            {message.audio ? <AudioMessage audio={message.audio} /> : <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>}
            {message.verdict && <ScamVerdictCard verdict={message.verdict} onFeedback={onFeedback} />}
            {message.letter && <LetterReadingCard reading={message.letter} onSpeak={onSpeak} />}
            {message.memories && message.memories.length > 0 && (
              <ul aria-label="What Tempo remembers" className="mt-3 space-y-1">
                {message.memories.map((m) => {
                  const when = m.when ?? m.observed_at;
                  const details = [m.category?.replaceAll("_", " "), m.source?.replaceAll("_", " "), when ? shortDate(when) : null, m.trust === "untrusted" ? "unchecked" : null].filter(Boolean);
                  return (
                    <li key={m.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                      <span className="text-slate-100">{m.text}</span>
                      {details.length > 0 && <span className="text-slate-500">{details.join(" · ")}</span>}
                    </li>
                  );
                })}
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
                    <a href={f.signpost} target="_blank" rel="noreferrer" className={`text-indigo-300 underline ${FOCUS} rounded`}>
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
                    <a {...linkProps(a.href)} className={`inline-flex items-center rounded-full border border-indigo-400/40 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-100 hover:bg-indigo-500/20 ${FOCUS}`}>
                      {a.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {message.simulated && message.simulated.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-500">Simulated in this run: {message.simulated.join(", ")}.</p>
            )}
          </li>
        );
      })}
      </ol>
      <div ref={endRef} />
    </div>
  );
}
