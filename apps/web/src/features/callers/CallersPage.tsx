// Who's calling? (plan.md §2): the Patience Profile for Margaret, Dilip and Joan: language, pace,
// voice, the words the voice agent is given, and the memories behind them. Ported from the old
// WhoIsCalling; dark theme. Voice ids never reach the browser.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ear, Languages, MessageSquareText, PhoneCall, Timer, Volume2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, FOCUS, PageTitle, SectionTitle, Skeleton } from "@/components/ui";
import type { VoiceProfileView } from "@/lib/api";
import { LANGUAGE_NAMES } from "@/lib/profiles";
import type { PageProps } from "@/types/page";
import { TAP } from "../story/demo";
import { loadError } from "@/components/mission/words";

/** The demo's callers (seeded by `make seed`): each told Tempo how they need to be spoken to. */
export const CALLERS = [
  { id: "u_margaret", name: "Margaret" },
  { id: "u_dilip", name: "Dilip" },
  { id: "u_joan", name: "Joan" },
] as const;

const RIGHT_TO_LEFT = new Set(["ur"]);

function languageName(code: unknown): string {
  return LANGUAGE_NAMES[String(code)] ?? String(code);
}

export default function CallersPage({ gateway, events, speak, showcase }: PageProps) {
  const [caller, setCaller] = useState<string>(CALLERS[0].id);
  const [view, setView] = useState<VoiceProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const applied = useMemo(() => events.filter((e) => e.type === "profile_applied"), [events]);
  const lastCall = applied.find((e) => e.user_id === caller);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setView(null);
    setError(null);
    gateway
      .voiceProfile(caller)
      .then((v) => {
        if (live) setView(v);
      })
      .catch((e) => {
        if (live) setError(loadError(e));
      });
    return () => {
      live = false;
    };
  }, [gateway, caller, applied.length, attempt]);

  const profile = view?.profile;
  const override = view?.initiation.conversation_config_override;
  const greeting = override?.agent?.first_message;
  const keywords = override?.asr?.keywords ?? profile?.keywords ?? [];
  const name = CALLERS.find((c) => c.id === caller)?.name ?? caller;

  return (
    <div className="space-y-5">
      <PageTitle lede="How Tempo will speak with each caller, set up before the first word from what they asked it to remember. The same settings reach the phone line, the texts and this chat.">
        Who's calling?
      </PageTitle>

      <div role="group" aria-label="Caller" className="inline-flex max-w-full flex-wrap gap-1 rounded-full border border-white/10 bg-white/5 p-1">
        {CALLERS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={caller === c.id}
            onClick={() => setCaller(c.id)}
            className={`inline-flex ${TAP} items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4 text-sm font-medium transition-colors motion-reduce:transition-none ${FOCUS} ${caller === c.id ? "bg-indigo-600 text-white" : "text-slate-300 hover:bg-white/10"}`}
          >
            <span aria-hidden className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${caller === c.id ? "bg-white/20" : "bg-nexus-badge text-white"}`}>
              {c.name.charAt(0)}
            </span>
            {c.name}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="text-sm">
        {lastCall && (
          <Card tone="emerald" padding="tight">
            <PhoneCall size={14} className="mr-1.5 inline text-emerald-300" aria-hidden />
            Last call: {name}, in {languageName(lastCall.language)}
            {lastCall.speed && lastCall.speed !== "1.0" ? ", slower" : ""}
            {lastCall.voice === "low" ? ", lower voice" : ""}
            {lastCall.patience === "high" ? ", extra time" : ""}.
          </Card>
        )}
        {!lastCall && !showcase && applied.length === 0 && <p className="text-slate-400">No live call yet. When the voice line answers, the profile it applied appears here.</p>}
      </div>

      {error && (
        <EmptyState title={`Can't load ${name}'s settings right now`} tone="error" action={<Button variant="quiet" onClick={retry} className={TAP}>Try again</Button>}>
          {error.replace(/\.?$/, ".")} Check the Gateway in Settings, or switch on the showcase there.
        </EmptyState>
      )}
      {!error && !view && (
        <div role="status" aria-label={`Loading how Tempo speaks with ${name}`} className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-nexus-card p-5">
              <Skeleton className="mb-4 h-3 w-1/3" />
              <Skeleton className="mb-2 h-4 w-full" />
              <Skeleton className="mb-2 h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      )}

      {view && profile && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card as="section" aria-labelledby="settings-heading">
            <SectionTitle id="settings-heading">The Patience Profile</SectionTitle>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="flex items-center gap-1.5 text-slate-400">
                <Languages size={14} aria-hidden /> Language
              </dt>
              <dd className="text-slate-100">
                {languageName(profile.language)}
                {profile.other_language ? <span className="text-slate-400"> (asked for {profile.other_language}, which Tempo can't speak yet)</span> : ""}
              </dd>
              <dt className="flex items-center gap-1.5 text-slate-400">
                <Timer size={14} aria-hidden /> Pace
              </dt>
              <dd className="text-slate-100">{profile.speed === "1.0" ? "Usual" : `Slower (${profile.speed}×)`}</dd>
              <dt className="flex items-center gap-1.5 text-slate-400">
                <Volume2 size={14} aria-hidden /> Voice
              </dt>
              <dd className="text-slate-100">
                {profile.voice === "low" ? "Tempo, lower" : "Tempo"}
                {profile.voice === "low" && !view.low_voice_configured ? <span className="text-amber-200"> (not set up yet, so the usual voice)</span> : ""}
              </dd>
              <dt className="flex items-center gap-1.5 text-slate-400">
                <Ear size={14} aria-hidden /> Time to answer
              </dt>
              <dd className="text-slate-100">{profile.patience === "high" ? "Extra: never rushed" : "Patient, as for everyone"}</dd>
              <dt className="flex items-center gap-1.5 text-slate-400">
                <MessageSquareText size={14} aria-hidden /> Questions
              </dt>
              <dd className="text-slate-100">{profile.prefers_text ? "Offered by text too" : "By voice"}</dd>
            </dl>
            <ul aria-label="Access needs" className="mt-3 flex flex-wrap gap-1.5">
              {profile.stammer && <li><Badge tone="indigo">stammer: never finish their words</Badge></li>}
              {profile.hearing && <li><Badge tone="indigo">hard of hearing</Badge></li>}
              {profile.prefers_text && <li><Badge tone="indigo">prefers text</Badge></li>}
              {profile.patience === "high" && <li><Badge tone="indigo">extra time</Badge></li>}
              {profile.speed !== "1.0" && <li><Badge tone="indigo">slower</Badge></li>}
              {!view.adjusted && <li><Badge tone="slate">nothing remembered: the usual patient voice</Badge></li>}
            </ul>
          </Card>

          <Card as="section" aria-labelledby="words-heading">
            <SectionTitle
              id="words-heading"
              right={
                <Button variant="quiet" onClick={() => speak(view.how_to_speak)} icon={<Volume2 size={14} aria-hidden />} className={TAP}>
                  Speak it
                </Button>
              }
            >
              The words Tempo's agent is given
            </SectionTitle>
            <blockquote className="border-l-2 border-indigo-400 pl-3 text-sm text-slate-100">{view.how_to_speak}</blockquote>
            {greeting && (
              <div className="mt-4">
                <SectionTitle as="h3">First words</SectionTitle>
                <p lang={profile.language} dir={RIGHT_TO_LEFT.has(profile.language) ? "rtl" : "ltr"} className="text-sm text-slate-100">
                  {greeting}
                </p>
              </div>
            )}
            {keywords.length > 0 && (
              <div className="mt-4">
                <SectionTitle as="h3">Words it listens out for</SectionTitle>
                <ul aria-label="Words it listens out for" className="flex flex-wrap gap-1.5">
                  {keywords.map((k) => (
                    <li key={k}>
                      <Badge tone="slate">{k}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card as="section" aria-labelledby="because-heading" className="lg:col-span-2">
            <SectionTitle id="because-heading">Because they said</SectionTitle>
            {profile.reasons.length === 0 ? (
              <p className="text-sm text-slate-300">Nothing yet, so Tempo's usual patient voice.</p>
            ) : (
              <ul aria-label="Because they said" className="flex flex-wrap gap-2">
                {profile.reasons.map((r) => (
                  <li key={r} className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-sm text-slate-100">
                    “{r}”
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-400">
              Every setting comes from something they said and said yes to keeping. Forget it on the Memory page and the next call forgets it too. Voice ids stay on the
              Gateway: this page never sees one.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
