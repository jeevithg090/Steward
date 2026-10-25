// Who's calling? (plan.md §2): the Patience Profile for Margaret, Dilip and Joan: language, pace,
// voice, the words the voice agent is given, and the memories behind them. Ported from the old
// WhoIsCalling; dark theme. Voice ids never reach the browser.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AudioWaveform, Check, Ear, Languages, MessageSquareText, PhoneCall, Quote, ShieldCheck, Timer, Volume2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, FOCUS, PageTitle, SectionTitle, Skeleton, TempoMark } from "@/components/ui";
import type { VoiceProfileView } from "@/lib/api";
import { LANGUAGE_NAMES } from "@/lib/profiles";
import type { PageProps } from "@/types/page";
import { TAP } from "../story/demo";
import { Avatar } from "../profiles/bits";
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
    <div className="space-y-6">
      <PageTitle lede="How Tempo will speak with each caller, set up before the first word from what they asked it to remember. The same settings reach the phone line, the texts and this chat.">
        Who's calling?
      </PageTitle>

      <div role="group" aria-label="Caller" className="stagger grid grid-cols-3 gap-2.5 sm:max-w-2xl sm:gap-4">
        {CALLERS.map((c) => {
          const on = caller === c.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => setCaller(c.id)}
              className={`group relative flex ${TAP} flex-col items-center gap-2.5 rounded-3xl border px-2 pb-4 pt-5 text-center transition-[transform,border-color,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:flex-row sm:gap-3.5 sm:px-4 sm:py-4 sm:text-left ${FOCUS} ${
                on
                  ? "border-violet-400/50 bg-gradient-to-b from-violet-500/[0.16] to-violet-500/[0.04] shadow-glow"
                  : "surface hover:border-white/[0.16]"
              }`}
            >
              <Avatar name={c.name} seed={`caller-${c.id}`} size="md" glow={on} />
              <span className="min-w-0">
                <span className={`block text-[15px] font-semibold ${on ? "text-white" : "text-slate-200"}`}>{c.name}</span>
              </span>
              <span
                aria-hidden
                className={`absolute right-2.5 top-2.5 grid h-5 w-5 place-items-center rounded-full transition-opacity duration-200 motion-reduce:transition-none sm:right-3 sm:top-1/2 sm:-translate-y-1/2 ${on ? "bg-violet-500 text-white opacity-100" : "opacity-0"}`}
              >
                <Check size={12} strokeWidth={3} />
              </span>
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="text-sm">
        {lastCall && (
          <Card tone="emerald" padding="tight" className="flex items-center gap-3 motion-safe:animate-fade-up">
            <span aria-hidden className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
              <span className="absolute inset-0 animate-ripple rounded-full bg-emerald-400/20 motion-reduce:animate-none" />
              <PhoneCall size={14} />
            </span>
            <p className="text-emerald-50">
              Last call: {name}, in {languageName(lastCall.language)}
              {lastCall.speed && lastCall.speed !== "1.0" ? ", slower" : ""}
              {lastCall.voice === "low" ? ", lower voice" : ""}
              {lastCall.patience === "high" ? ", extra time" : ""}.
            </p>
          </Card>
        )}
        {!lastCall && !showcase && applied.length === 0 && (
          <p className="flex items-center gap-2 text-slate-400">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-slate-500" />
            No live call yet. When the voice line answers, the profile it applied appears here.
          </p>
        )}
      </div>

      {error && (
        <EmptyState title={`Can't load ${name}'s settings right now`} tone="error" action={<Button variant="quiet" onClick={retry} className={TAP}>Try again</Button>}>
          {error.replace(/\.?$/, ".")} Check the Gateway in Settings, or switch on the showcase there.
        </EmptyState>
      )}
      {!error && !view && (
        <div role="status" aria-label={`Loading how Tempo speaks with ${name}`} className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="surface rounded-3xl p-5 lg:p-6">
              <Skeleton className="mb-5 h-3 w-1/3" />
              <div className="grid gap-3 sm:grid-cols-2">
                {[0, 1, 2, 3].map((j) => (
                  <Skeleton key={j} className="h-16 rounded-2xl" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view && profile && (
        <div className="grid gap-4 motion-safe:animate-fade-up lg:grid-cols-2">
          <Card as="section" aria-labelledby="settings-heading" className="relative overflow-hidden">
            <span aria-hidden className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-violet-500/10 blur-3xl" />
            <div className="relative">
              <div className="mb-5 flex items-center gap-4">
                <Avatar name={name} seed={`caller-${caller}`} size="lg" glow />
                <div className="min-w-0">
                  <p className="font-display text-[2rem] leading-none text-white">{name}</p>
                  <SectionTitle id="settings-heading" className="!mb-0 mt-2">
                    The Patience Profile
                  </SectionTitle>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-2.5">
                <Tile icon={<Languages size={14} />} label="Language" wide={Boolean(profile.other_language)}>
                  {languageName(profile.language)}
                  {profile.other_language ? <span className="block text-sm font-normal text-slate-400"> (asked for {profile.other_language}, which Tempo can't speak yet)</span> : ""}
                </Tile>
                <Tile icon={<Timer size={14} />} label="Pace">
                  {profile.speed === "1.0" ? "Usual" : `Slower (${profile.speed}×)`}
                </Tile>
                <Tile icon={<Volume2 size={14} />} label="Voice">
                  {profile.voice === "low" ? "Tempo, lower" : "Tempo"}
                  {profile.voice === "low" && !view.low_voice_configured ? <span className="block text-sm font-normal text-amber-200"> (not set up yet, so the usual voice)</span> : ""}
                </Tile>
                <Tile icon={<Ear size={14} />} label="Time to answer">
                  {profile.patience === "high" ? "Extra: never rushed" : "Patient, as for everyone"}
                </Tile>
                <Tile icon={<MessageSquareText size={14} />} label="Questions" wide>
                  {profile.prefers_text ? "Offered by text too" : "By voice"}
                </Tile>
              </dl>
              <ul aria-label="Access needs" className="mt-4 flex flex-wrap gap-1.5">
                {profile.stammer && <li><Badge tone="indigo" dot>stammer: never finish their words</Badge></li>}
                {profile.hearing && <li><Badge tone="indigo" dot>hard of hearing</Badge></li>}
                {profile.prefers_text && <li><Badge tone="indigo" dot>prefers text</Badge></li>}
                {profile.patience === "high" && <li><Badge tone="indigo" dot>extra time</Badge></li>}
                {profile.speed !== "1.0" && <li><Badge tone="indigo" dot>slower</Badge></li>}
                {!view.adjusted && <li><Badge tone="slate" dot>nothing remembered: the usual patient voice</Badge></li>}
              </ul>
            </div>
          </Card>

          <Card as="section" aria-labelledby="words-heading" className="flex flex-col">
            <SectionTitle
              id="words-heading"
              right={
                <Button variant="quiet" size="sm" onClick={() => speak(view.how_to_speak)} icon={<Volume2 size={14} aria-hidden />} className={TAP}>
                  Speak it
                </Button>
              }
            >
              The words Tempo's agent is given
            </SectionTitle>
            <blockquote className="relative rounded-2xl border border-violet-400/20 bg-gradient-to-b from-violet-500/[0.1] to-violet-500/[0.02] py-4 pl-12 pr-5 text-[15px] leading-relaxed text-slate-100">
              <span aria-hidden className="absolute left-3.5 top-4 grid h-6 w-6 place-items-center rounded-full bg-violet-500/20 text-violet-200">
                <Quote size={11} className="fill-current" />
              </span>
              {view.how_to_speak}
            </blockquote>
            {greeting && (
              <div className="mt-5">
                <SectionTitle as="h3" className="!mb-2">
                  First words
                </SectionTitle>
                <div className="flex items-start gap-3">
                  <TempoMark size={30} className="mt-0.5 shrink-0" />
                  <p
                    lang={profile.language}
                    dir={RIGHT_TO_LEFT.has(profile.language) ? "rtl" : "ltr"}
                    className="glass rounded-2xl rounded-tl-md px-4 py-2.5 text-[15px] leading-relaxed text-slate-100"
                  >
                    {greeting}
                  </p>
                </div>
              </div>
            )}
            {keywords.length > 0 && (
              <div className="mt-5">
                <SectionTitle as="h3" className="!mb-2">
                  Words it listens out for
                </SectionTitle>
                <ul aria-label="Words it listens out for" className="flex flex-wrap gap-1.5">
                  {keywords.map((k) => (
                    <li key={k}>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 font-mono text-[12px] text-slate-200">
                        <AudioWaveform size={12} aria-hidden className="text-violet-300" />
                        {k}
                      </span>
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
                  <li key={r} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] py-2 pl-2.5 pr-4 text-[15px] text-slate-100">
                    <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-violet-500/15 text-violet-200">
                      <Quote size={11} className="fill-current" />
                    </span>
                    “{r}”
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 flex items-start gap-2.5 border-t border-white/[0.06] pt-4 text-sm leading-relaxed text-slate-400">
              <ShieldCheck size={15} aria-hidden className="mt-0.5 shrink-0 text-emerald-300" />
              <span>
                Every setting comes from something they said and said yes to keeping. Forget it on the Memory page and the next call forgets it too. Voice ids stay on the
                Gateway: this page never sees one.
              </span>
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}

/** One line of the Patience Profile as a tile: an icon, the label (dt) and the setting (dd). */
function Tile({ icon, label, children, wide = false }: { icon: ReactNode; label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 rounded-2xl border border-white/[0.07] bg-black/20 px-3.5 py-3 ${wide ? "col-span-2" : ""}`}>
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        <span aria-hidden className="text-violet-300">
          {icon}
        </span>
        {label}
      </dt>
      <dd className="mt-1 break-words text-[15px] font-medium leading-snug text-white">{children}</dd>
    </div>
  );
}
