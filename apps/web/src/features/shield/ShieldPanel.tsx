// Scam Shield's "check a message" panel (docs/scam-shield.md §8): paste a message, hear the
// verdict in your language, see why, and tell Tempo if it got it wrong. Ported from the old
// ShieldPanel; dark theme. The same code path answers the phone, the SMS CHECK word and the voice agent.
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  Banknote,
  Check,
  ChevronDown,
  ClipboardPaste,
  Gauge,
  HelpCircle,
  Hourglass,
  Info,
  Landmark,
  Languages,
  Lightbulb,
  Link2,
  ListOrdered,
  type LucideIcon,
  Megaphone,
  Receipt,
  RefreshCw,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  Volume2,
  WifiOff,
} from "lucide-react";
import { Badge, type BadgeTone, Button, Card, FOCUS, Skeleton, toast, useCountUp } from "@/components/ui";
import { TAP } from "../story/demo";
import { LANGUAGES, LEVEL_WORDS, RULE_WORDS, SAMPLES, ZONE_WORDS, type Language, type ShieldSource, type ShieldStatus, type ShieldVerdict, translatedSay } from "@/lib/shield";

export interface ShieldPanelProps {
  source: ShieldSource;
  language: Language;
  onLanguage: (language: Language) => void;
  userId: string;
  speak: (text: string) => void;
}

const ZONE_BADGE: Record<ShieldVerdict["zone"], { tone: BadgeTone; words: string; rail: string }> = {
  warn: { tone: "rose", words: "Tempo speaks", rail: "before:bg-rose-400" },
  sandbox: { tone: "amber", words: "held and looked at", rail: "before:bg-amber-400" },
  quiet: { tone: "slate", words: "quiet", rail: "before:bg-slate-500" },
};

type IconType = ComponentType<{ size?: number; className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>;

/** The verdict's colour band: strong, and readable (white on rose-700/emerald-700/slate-600, near-black on amber-300).
 * The flat colour stays under the gradient so the band reads the same where gradients are off. */
const LEVEL_LOOK: Record<ShieldVerdict["level"], { band: string; border: string; glow: string; chip: string; tile: string; meter: string; accent: string; icon: IconType }> = {
  likely_scam: {
    band: "bg-rose-700 bg-gradient-to-br from-rose-600 via-rose-700 to-rose-900 text-white",
    border: "border-rose-400/40",
    glow: "shadow-[0_40px_90px_-40px_rgb(225_29_72/0.7)]",
    chip: "bg-black/25 text-white ring-1 ring-inset ring-white/20",
    tile: "bg-white/15 ring-white/25",
    meter: "from-rose-400 to-rose-600",
    accent: "border-rose-400/70",
    icon: ShieldAlert,
  },
  caution: {
    band: "bg-amber-300 bg-gradient-to-br from-amber-200 via-amber-300 to-amber-400 text-slate-950",
    border: "border-amber-300/45",
    glow: "shadow-[0_40px_90px_-40px_rgb(245_158_11/0.6)]",
    chip: "bg-black/15 text-slate-950 ring-1 ring-inset ring-black/10",
    tile: "bg-black/10 ring-black/10",
    meter: "from-amber-300 to-amber-500",
    accent: "border-amber-300/70",
    icon: TriangleAlert,
  },
  unknown: {
    band: "bg-slate-600 bg-gradient-to-br from-slate-600 via-slate-600 to-slate-800 text-white",
    border: "border-slate-400/40",
    glow: "shadow-[0_40px_90px_-40px_rgb(100_116_139/0.6)]",
    chip: "bg-black/25 text-white ring-1 ring-inset ring-white/20",
    tile: "bg-white/15 ring-white/25",
    meter: "from-slate-300 to-slate-500",
    accent: "border-slate-400/70",
    icon: HelpCircle,
  },
  no_flags: {
    band: "bg-emerald-700 bg-gradient-to-br from-emerald-700 via-emerald-700 to-emerald-900 text-white",
    border: "border-emerald-400/40",
    glow: "shadow-[0_40px_90px_-40px_rgb(16_185_129/0.6)]",
    chip: "bg-black/25 text-white ring-1 ring-inset ring-white/20",
    tile: "bg-white/15 ring-white/25",
    meter: "from-emerald-300 to-emerald-500",
    accent: "border-emerald-400/70",
    icon: ShieldCheck,
  },
};

const SAMPLE_ICONS: Record<string, LucideIcon> = { hmrc: Receipt, grey: Link2, genuine: Landmark, loan: Banknote };

/** Glass fields with a violet glow on focus (the glow is the focus ring here, so it is strong). */
export const FIELD = "w-full rounded-2xl border border-white/10 bg-white/[0.03] text-slate-100 shadow-[0_1px_0_0_rgb(255_255_255/0.03)_inset] transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-slate-500 hover:border-white/20 focus:border-violet-300 focus:bg-white/[0.05] focus:outline-none focus:ring-4 focus:ring-violet-500/25 focus-visible:outline-none motion-reduce:transition-none";
const TEXTAREA = `${FIELD} p-4 text-[15px] leading-relaxed`;
const SELECT = `${FIELD} min-h-[44px] cursor-pointer appearance-none py-2 pl-10 pr-10 text-sm`;
const DT = "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400";

export function LanguagePicker({ id, label, value, onChange }: { id: string; label: string; value: Language; onChange: (l: Language) => void }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-medium text-slate-400">
        {label}
      </label>
      <div className="relative mt-1.5">
        <Languages size={16} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-violet-300" />
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as Language)} className={SELECT}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code} className="bg-ink-800 text-slate-100">
              {l.name}
            </option>
          ))}
        </select>
        <ChevronDown size={16} aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
      </div>
    </div>
  );
}

/** One of the log's headline numbers, counted up (instantly under reduced motion). */
function LogStat({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  const shown = useCountUp(String(value));
  return (
    <div className="flex min-w-0 flex-col-reverse justify-end gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5 sm:p-4">
      <dt className="text-[13px] leading-snug text-slate-400">{label}</dt>
      <dd className="flex items-start justify-between gap-2">
        <span className="num text-[2rem] font-semibold leading-none tracking-[-0.02em] text-white">
          <span aria-hidden>{shown}</span>
          <span className="sr-only">{value}</span>
        </span>
        <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.05] ring-1 ring-inset ring-white/[0.08]">
          {icon}
        </span>
      </dd>
    </div>
  );
}

/** A card title with its icon tile, the way the Shield's panels open. */
function PanelTitle({ id, icon, children, tone = "violet" }: { id: string; icon: ReactNode; children: ReactNode; tone?: "violet" | "emerald" }) {
  const tile = tone === "emerald" ? "from-emerald-500/25 to-emerald-700/10 text-emerald-100 ring-emerald-300/25" : "from-violet-500/30 to-violet-700/10 text-violet-100 ring-violet-300/25";
  return (
    <h2 id={id} className="flex items-center gap-3 text-lg font-semibold tracking-[-0.01em] text-white">
      <span aria-hidden className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-b ring-1 ring-inset ${tile}`}>
        {icon}
      </span>
      {children}
    </h2>
  );
}

export function ShieldPanel({ source, language, onLanguage, userId, speak }: ShieldPanelProps) {
  const [text, setText] = useState("");
  const [verdict, setVerdict] = useState<ShieldVerdict | null>(null);
  const [status, setStatus] = useState<ShieldStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState<"scam" | "real" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const spoken = useMemo(() => LANGUAGES.find((l) => l.code === language), [language]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setStatus(await source.status(userId));
      setStatusFailed(false);
    } catch {
      setStatusFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [source, userId]);

  const paste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) {
        toast.info("The clipboard is empty. Copy the message first, then press Paste from clipboard.");
        return;
      }
      setText(clip.slice(0, 2000));
      textRef.current?.focus();
    } catch {
      toast.info("This browser won't let Tempo read the clipboard. Long-press or right-click in the box and choose Paste.");
      textRef.current?.focus();
    }
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const check = async (message: string) => {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    setLabel(null);
    try {
      setVerdict(await source.check(message, language, userId));
      await refresh();
    } catch (e) {
      setVerdict(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // The verdict was spoken in the language it was checked in; a later change is translated here.
  const say = verdict ? (verdict.language === language ? verdict.say : translatedSay(verdict, language)) : "";

  const feedback = async (given: "scam" | "real") => {
    if (!verdict) return;
    try {
      await source.feedback(verdict.alert_id, given);
      setLabel(given);
      toast.success("Thank you. Only the verdict and your answer are kept, never the message.");
      await refresh();
    } catch (e) {
      toast.error(`Couldn't send that: ${e instanceof Error ? e.message : String(e)}. Try again in a moment.`);
    }
  };

  const look = verdict ? LEVEL_LOOK[verdict.level] : null;
  const LevelIcon = look?.icon ?? ShieldAlert;
  const sure = verdict?.confidence !== null && verdict?.confidence !== undefined ? Math.round(verdict.confidence * 100) : null;

  return (
    <div className="space-y-6">
      <Card as="section" aria-labelledby="check-heading" className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-violet-600/15 blur-3xl" />
        <div className="relative">
          <PanelTitle id="check-heading" icon={<ScanSearch size={19} strokeWidth={1.85} />}>
            Check a message
          </PanelTitle>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-slate-300">
            Paste a text you are unsure of. Tempo checks the words, the links, the official registers and public phishing lists, and says what it found. It never says
            “safe”.
          </p>

          <p aria-hidden className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Try one of these
          </p>
          <div role="group" aria-label="Try one of these" className="mt-2.5 flex flex-wrap gap-2">
            {SAMPLES.map((s) => {
              const on = text === s.text;
              const Icon = SAMPLE_ICONS[s.id] ?? ShieldAlert;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setText(s.text)}
                  aria-pressed={on}
                  className={`${TAP} inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 ${FOCUS} ${
                    on
                      ? "border-violet-300/60 bg-gradient-to-b from-violet-600 to-violet-700 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.2)_inset,0_10px_24px_-12px_rgb(124_58_237/0.9)]"
                      : "border-white/10 bg-white/[0.04] text-slate-200 hover:border-violet-300/35 hover:bg-white/[0.08] hover:text-white"
                  }`}
                >
                  {on ? <Check size={15} strokeWidth={2.5} aria-hidden /> : <Icon size={15} aria-hidden className="text-violet-300" />}
                  {s.label}
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap items-end justify-between gap-2">
            <label htmlFor="shield-text" className="block text-sm font-medium text-slate-200">
              Paste the text you're unsure of
            </label>
            <Button variant="ghost" size="sm" onClick={() => void paste()} icon={<ClipboardPaste size={14} aria-hidden />} className={TAP}>
              Paste from clipboard
            </Button>
          </div>
          <textarea
            id="shield-text"
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={2000}
            className={`mt-2 min-h-[8.5rem] resize-y ${TEXTAREA}`}
            placeholder="Paste the message here, or press one of the examples above."
          />
          {source.showcase && (
            <p className="mt-3 flex items-start gap-2.5 rounded-2xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3 text-[13px] leading-relaxed text-amber-100">
              <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-amber-300" />
              <span>Showcase: there is no Gateway, so only the four example messages can be checked; their replies were recorded from a real replay-mode Gateway.</span>
            </p>
          )}
          <div className="mt-5 flex flex-col gap-4 border-t border-white/[0.06] pt-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="sm:w-64">
              <LanguagePicker id="shield-language" label="Say it in" value={language} onChange={onLanguage} />
            </div>
            <Button size="lg" disabled={busy || !text.trim()} busy={busy} onClick={() => void check(text)} icon={<ShieldAlert size={17} aria-hidden />} className="w-full sm:w-auto">
              Check this message
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-4 flex items-start gap-2.5 rounded-2xl border border-amber-400/30 bg-amber-500/[0.08] px-4 py-3 text-sm text-amber-50">
              <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0 text-amber-300" />
              <span>{error}</span>
            </p>
          )}
        </div>
      </Card>

      <div aria-live="polite">
        {busy && !verdict && (
          <div aria-hidden className="surface overflow-hidden rounded-3xl">
            <Skeleton className="h-28 rounded-none" />
            <div className="space-y-3 p-6">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
        )}
        {verdict && look && (
          <section aria-labelledby="verdict-heading" className={`overflow-hidden rounded-3xl border bg-ink-900 text-slate-200 motion-safe:animate-scale-in ${look.border} ${look.glow}`}>
            <div className={`relative overflow-hidden px-5 py-7 sm:px-8 sm:py-8 ${look.band}`}>
              <LevelIcon size={168} strokeWidth={1.25} aria-hidden className="pointer-events-none absolute -right-6 top-1/2 hidden -translate-y-1/2 rotate-[-8deg] opacity-[0.13] sm:block" />
              <div className="relative flex items-start gap-4">
                <span aria-hidden className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ring-1 ring-inset shadow-[0_10px_30px_-12px_rgb(0_0_0/0.6)] ${look.tile}`}>
                  <LevelIcon size={28} strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] ${look.chip}`}>{ZONE_BADGE[verdict.zone].words}</span>
                    {verdict.held && <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${look.chip}`}>held, looked behind the link</span>}
                  </div>
                  <h2 id="verdict-heading" className="mt-2 font-display text-[2.15rem] leading-[1.05] sm:text-[2.75rem]">
                    {LEVEL_WORDS[verdict.level]}
                  </h2>
                </div>
              </div>
            </div>

            <div className="space-y-6 p-5 sm:p-8">
              {verdict.simulated && (
                <div className="flex flex-wrap gap-2">
                  <Badge tone="amber" dot>
                    registers and sandbox: recorded
                  </Badge>
                </div>
              )}

              <div className={`rounded-2xl border-l-[3px] bg-white/[0.035] py-4 pl-5 pr-4 ${look.accent}`}>
                <p aria-hidden className={DT}>
                  <Volume2 size={12} /> Tempo says
                </p>
                <p lang={spoken?.bcp47} dir={spoken?.rtl ? "rtl" : "ltr"} className="mt-2 text-lg leading-relaxed text-white sm:text-xl">
                  {say}
                </p>
                <Button onClick={() => speak(say)} icon={<Volume2 size={16} aria-hidden />} className={`mt-4 ${TAP}`}>
                  Speak it
                </Button>
              </div>

              <dl className="grid gap-3 text-sm lg:grid-cols-2">
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                  <dt className={DT}>
                    <Megaphone size={12} aria-hidden /> What Tempo would do
                  </dt>
                  <dd className="mt-2 text-[15px] text-slate-100">{ZONE_WORDS[verdict.zone]}</dd>
                </div>
                {sure !== null && (
                  <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                    <dt className={DT}>
                      <Gauge size={12} aria-hidden /> How sure the text model is
                    </dt>
                    <dd className="mt-2 text-slate-200">
                      <span aria-hidden className="flex items-center gap-3">
                        <span className="num text-2xl font-semibold leading-none text-white">{sure}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                          <span className={`block h-full rounded-full bg-gradient-to-r ${look.meter}`} style={{ width: `${sure}%` }} />
                        </span>
                      </span>
                      <span className="mt-2 block text-[13px] text-slate-300">{sure} in 100 that this is a scam. The model ranks; code decides.</span>
                    </dd>
                  </div>
                )}
                {verdict.rules.length > 0 && (
                  <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                    <dt className={DT}>
                      <TriangleAlert size={12} aria-hidden /> The words
                    </dt>
                    <dd className="mt-2.5">
                      <ul className="space-y-2">
                        {verdict.rules.map((r) => (
                          <li key={r} className="flex items-start gap-2.5 text-slate-100">
                            <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-300/25">
                              <TriangleAlert size={11} strokeWidth={2.5} />
                            </span>
                            <span>It {RULE_WORDS[r] ?? r.replaceAll("_", " ")}.</span>
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
                {verdict.links.length > 0 && (
                  <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                    <dt className={DT}>
                      <Link2 size={12} aria-hidden /> The links
                    </dt>
                    <dd className="mt-2.5">
                      <ul className="space-y-2.5 text-slate-200">
                        {verdict.links.map((l) => (
                          <li key={l.url} className="leading-relaxed">
                            <span className="mr-1.5 inline-flex max-w-full items-center gap-1.5 break-all rounded-lg bg-rose-500/[0.12] px-2 py-0.5 align-middle ring-1 ring-inset ring-rose-400/25">
                              <Link2 size={12} aria-hidden className="shrink-0 text-rose-300" />
                              <span className="font-mono text-xs text-rose-100">{l.host}</span>
                            </span>
                            {l.words.length > 0 ? l.words.join("; ") : "no finding on the link itself"}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
                {verdict.reasons.length > 0 && (
                  <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 lg:col-span-2">
                    <dt className={DT}>
                      <ListOrdered size={12} aria-hidden /> Every reason, in order
                    </dt>
                    <dd className="mt-2.5">
                      <ol className="space-y-2 text-slate-200">
                        {verdict.reasons.map((r, i) => (
                          <li key={r} className="flex items-start gap-2.5">
                            <span aria-hidden className="num mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/[0.07] text-[11px] font-semibold text-slate-300 ring-1 ring-inset ring-white/10">
                              {i + 1}
                            </span>
                            <span className="leading-relaxed">{r}</span>
                          </li>
                        ))}
                      </ol>
                    </dd>
                  </div>
                )}
                <div className="rounded-2xl border border-violet-300/20 bg-violet-500/[0.07] p-4 lg:col-span-2">
                  <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-200">
                    <Lightbulb size={12} aria-hidden /> What to do
                  </dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-white">{verdict.advice}</dd>
                </div>
              </dl>

              <div role="group" aria-label="Was Tempo right?" className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-5">
                <span className="mr-1 text-sm font-medium text-slate-200">Was Tempo right?</span>
                <Button variant="quiet" disabled={label !== null} aria-pressed={label === "scam"} onClick={() => void feedback("scam")} icon={<ThumbsDown size={14} aria-hidden />} className={TAP}>
                  That was a scam
                </Button>
                <Button variant="quiet" disabled={label !== null} aria-pressed={label === "real"} onClick={() => void feedback("real")} icon={<ThumbsUp size={14} aria-hidden />} className={TAP}>
                  That was real
                </Button>
                {label && (
                  <span className="flex basis-full items-center gap-1.5 text-[13px] text-emerald-200">
                    <Check size={14} aria-hidden className="shrink-0 text-emerald-300" />
                    You said: that was {label === "scam" ? "a scam" : "real"}. Only the verdict and your answer are kept.
                  </span>
                )}
              </div>
              <p className="flex items-start gap-2 text-[13px] leading-relaxed text-slate-300">
                <Info size={14} aria-hidden className={`mt-0.5 shrink-0 ${verdict.simulated ? "text-amber-300" : "text-emerald-300"}`} />
                <span>
                  {verdict.simulated ? "Registers and the link sandbox answered from recordings (replay mode)." : "Registers and the link sandbox were checked live."}
                  {verdict.model ? ` Text model ${verdict.model.version}.` : ""}
                </span>
              </p>
            </div>
          </section>
        )}
      </div>

      <Card as="section" aria-labelledby="log-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PanelTitle id="log-heading" tone="emerald" icon={<ShieldCheck size={19} strokeWidth={1.85} />}>
            The Shield log
          </PanelTitle>
          <Button variant="quiet" size="sm" onClick={() => void refresh()} busy={refreshing} icon={<RefreshCw size={13} aria-hidden />} className={TAP}>
            Refresh
          </Button>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300">What Tempo has checked. It keeps the verdict and the link hosts, never a word of the message. It updates after every check.</p>
        {!status && !statusFailed && (
          <div role="status" aria-label="Loading the log" className="mt-5 grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[6.5rem] rounded-2xl" />
            ))}
          </div>
        )}
        {statusFailed && (
          <p className="mt-5 flex items-start gap-2.5 rounded-2xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-100">
            <WifiOff size={16} aria-hidden className="mt-0.5 shrink-0 text-amber-300" />
            <span>The Shield log is not reachable right now. Press Refresh, or check the Gateway in Settings.</span>
          </p>
        )}
        {status && (
          <>
            <dl className="mt-5 grid grid-cols-3 gap-2.5 sm:gap-3">
              <LogStat label="Checked today" value={status.today.checked} icon={<ScanSearch size={13} aria-hidden className="shrink-0 text-violet-300" />} />
              <LogStat label="Held and looked at" value={status.today.held} icon={<Hourglass size={13} aria-hidden className="shrink-0 text-amber-300" />} />
              <LogStat label="Warned about" value={status.today.warned} icon={<Megaphone size={13} aria-hidden className="shrink-0 text-rose-300" />} />
            </dl>
            {status.recent.length > 0 ? (
              <ul aria-label="Recent checks" className="mt-5 space-y-1.5 text-sm">
                {status.recent.slice(0, 8).map((a, i) => (
                  <li
                    key={`${a.id}-${i}`}
                    className={`relative flex flex-wrap items-center justify-between gap-x-3 gap-y-1 overflow-hidden rounded-xl bg-white/[0.025] py-2.5 pl-4 pr-3 before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${ZONE_BADGE[a.zone].rail}`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Badge tone={ZONE_BADGE[a.zone].tone} dot>
                        {ZONE_BADGE[a.zone].words}
                      </Badge>
                      <span className="font-medium text-slate-100">{LEVEL_WORDS[a.level]}</span>
                    </span>
                    <span className="num min-w-0 break-words text-xs text-slate-400">
                      {a.source}
                      {a.link_hosts.length ? ` · ${a.link_hosts.join(", ")}` : ""}
                      {a.label ? ` · you said: ${a.label}` : ""}
                      {" · "}
                      {new Date(a.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 rounded-2xl border border-dashed border-white/[0.12] px-4 py-5 text-center text-sm text-slate-400">Nothing checked yet today.</p>
            )}
            {status.model && (
              <p className="mt-5 border-t border-white/[0.06] pt-4 text-[13px] leading-relaxed text-slate-400">
                Text model {status.model.version}: on the held-out test fold, {Math.round((status.model.metrics.precision_at_warn ?? 0) * 1000) / 10}% of what it would speak
                about is a scam and it catches {Math.round((status.model.metrics.recall_at_warn ?? 0) * 1000) / 10}% of them; on genuine bank, NHS and council texts it speaks{" "}
                {Math.round((status.model.metrics.synthetic_spoken_on_genuine ?? 0) * 100)}% of the time. Lists:{" "}
                {Object.entries(status.feeds)
                  .map(([name, f]) => `${name} (${f.entries})`)
                  .join(", ") || "none loaded"}
                .{status.simulated.registers || status.simulated.sandbox ? " Registers and sandbox: simulated in this run." : ""}
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
