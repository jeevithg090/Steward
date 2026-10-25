// Scam Shield's "check a message" panel (docs/scam-shield.md §8): paste a message, hear the
// verdict in your language, see why, and tell Tempo if it got it wrong. Ported from the old
// ShieldPanel; dark theme. The same code path answers the phone, the SMS CHECK word and the voice agent.
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { ClipboardPaste, HelpCircle, Link2, RefreshCw, ShieldAlert, ShieldCheck, ThumbsDown, ThumbsUp, TriangleAlert, Volume2 } from "lucide-react";
import { Badge, type BadgeTone, Button, Card, FOCUS, SectionTitle, Skeleton, toast } from "@/components/ui";
import { TAP } from "../story/demo";
import { LANGUAGES, LEVEL_WORDS, RULE_WORDS, SAMPLES, ZONE_WORDS, type Language, type ShieldSource, type ShieldStatus, type ShieldVerdict, translatedSay } from "@/lib/shield";

export interface ShieldPanelProps {
  source: ShieldSource;
  language: Language;
  onLanguage: (language: Language) => void;
  userId: string;
  speak: (text: string) => void;
}

const ZONE_BADGE: Record<ShieldVerdict["zone"], { tone: BadgeTone; words: string }> = {
  warn: { tone: "rose", words: "Tempo speaks" },
  sandbox: { tone: "amber", words: "held and looked at" },
  quiet: { tone: "slate", words: "quiet" },
};

/** The verdict's colour band: strong, and readable (white on rose-700/emerald-700/slate-600, near-black on amber-300). */
const LEVEL_LOOK: Record<ShieldVerdict["level"], { band: string; border: string; chip: string; icon: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }> }> = {
  likely_scam: { band: "bg-rose-700 text-white", border: "border-rose-500", chip: "bg-black/25 text-white", icon: ShieldAlert },
  caution: { band: "bg-amber-300 text-slate-950", border: "border-amber-400", chip: "bg-black/15 text-slate-950", icon: TriangleAlert },
  unknown: { band: "bg-slate-600 text-white", border: "border-slate-400", chip: "bg-black/25 text-white", icon: HelpCircle },
  no_flags: { band: "bg-emerald-700 text-white", border: "border-emerald-500", chip: "bg-black/25 text-white", icon: ShieldCheck },
};

const TEXTAREA = `w-full rounded-xl border border-white/15 bg-black/30 p-3 text-sm text-slate-100 placeholder:text-slate-500 ${FOCUS}`;
const SELECT = `min-h-[44px] rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100 ${FOCUS}`;

export function LanguagePicker({ id, label, value, onChange }: { id: string; label: string; value: Language; onChange: (l: Language) => void }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-400">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as Language)} className={`mt-1 ${SELECT}`}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
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

  return (
    <div className="space-y-5">
      <Card as="section" aria-labelledby="check-heading">
        <SectionTitle id="check-heading">Check a message</SectionTitle>
        <p className="text-sm text-slate-300">
          Paste a text you are unsure of. Tempo checks the words, the links, the official registers and public phishing lists, and says what it found. It never says
          “safe”.
        </p>
        <div role="group" aria-label="Try one of these" className="mt-3 flex flex-wrap gap-2">
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setText(s.text)}
              aria-pressed={text === s.text}
              className={`${TAP} rounded-full border px-4 py-1.5 text-sm font-medium transition-colors motion-reduce:transition-none ${FOCUS} ${text === s.text ? "border-indigo-400 bg-indigo-600 text-white" : "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
          <label htmlFor="shield-text" className="block text-sm font-medium text-slate-200">
            Paste the text you're unsure of
          </label>
          <Button variant="quiet" onClick={() => void paste()} icon={<ClipboardPaste size={14} aria-hidden />} className={TAP}>
            Paste from clipboard
          </Button>
        </div>
        <textarea id="shield-text" ref={textRef} value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000} className={`mt-2 ${TEXTAREA}`} placeholder="Paste the message here, or press one of the examples above." />
        {source.showcase && <p className="mt-1 text-xs text-amber-200">Showcase: there is no Gateway, so only the four example messages can be checked; their replies were recorded from a real replay-mode Gateway.</p>}
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <LanguagePicker id="shield-language" label="Say it in" value={language} onChange={onLanguage} />
          <Button size="lg" disabled={busy || !text.trim()} busy={busy} onClick={() => void check(text)} icon={<ShieldAlert size={16} aria-hidden />}>
            Check this message
          </Button>
        </div>
        {error && (
          <p role="alert" className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-sm text-amber-50">
            {error}
          </p>
        )}
      </Card>

      <div aria-live="polite">
        {verdict && look && (
          <section aria-labelledby="verdict-heading" className={`overflow-hidden rounded-2xl border-2 bg-nexus-card text-slate-200 ${look.border}`}>
            <div className={`flex items-start gap-3 px-4 py-4 lg:px-5 ${look.band}`}>
              <LevelIcon size={32} className="mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${look.chip}`}>{ZONE_BADGE[verdict.zone].words}</span>
                  {verdict.held && <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${look.chip}`}>held, looked behind the link</span>}
                </div>
                <h2 id="verdict-heading" className="mt-1 text-2xl font-bold leading-tight">
                  {LEVEL_WORDS[verdict.level]}
                </h2>
              </div>
            </div>
            <div className="space-y-4 p-4 lg:p-5">
            {verdict.simulated && (
              <div className="flex flex-wrap gap-2">
                <Badge tone="amber">registers and sandbox: recorded</Badge>
              </div>
            )}
            <p lang={spoken?.bcp47} dir={spoken?.rtl ? "rtl" : "ltr"} className="text-lg leading-relaxed text-slate-100">
              {say}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => speak(say)} icon={<Volume2 size={16} aria-hidden />} className={TAP}>
                Speak it
              </Button>
            </div>

            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">What Tempo would do</dt>
              <dd className="text-slate-200">{ZONE_WORDS[verdict.zone]}</dd>
              {verdict.confidence !== null && (
                <>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">How sure the text model is</dt>
                  <dd className="text-slate-200">
                    <span aria-hidden className="mr-2 inline-block h-2 w-32 overflow-hidden rounded-full bg-white/10 align-middle">
                      <span className="block h-full rounded-full bg-current" style={{ width: `${Math.round(verdict.confidence * 100)}%` }} />
                    </span>
                    {Math.round(verdict.confidence * 100)} in 100 that this is a scam. The model ranks; code decides.
                  </dd>
                </>
              )}
              {verdict.rules.length > 0 && (
                <>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">The words</dt>
                  <dd>
                    <ul className="flex flex-wrap gap-1.5">
                      {verdict.rules.map((r) => (
                        <li key={r}>
                          <Badge tone="amber">It {RULE_WORDS[r] ?? r.replaceAll("_", " ")}.</Badge>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </>
              )}
              {verdict.links.length > 0 && (
                <>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">The links</dt>
                  <dd>
                    <ul className="space-y-1 text-slate-200">
                      {verdict.links.map((l) => (
                        <li key={l.url} className="flex items-start gap-2">
                          <Link2 size={14} className="mt-0.5 shrink-0 text-rose-300" aria-hidden />
                          <span>
                            <span className="font-mono text-xs text-rose-200">{l.host}</span>
                            {l.words.length > 0 ? `: ${l.words.join("; ")}` : ": no finding on the link itself"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </>
              )}
              {verdict.reasons.length > 0 && (
                <>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">Every reason, in order</dt>
                  <dd>
                    <ol className="list-decimal space-y-0.5 pl-5 text-slate-200">
                      {verdict.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ol>
                  </dd>
                </>
              )}
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">What to do</dt>
              <dd className="text-slate-200">{verdict.advice}</dd>
            </dl>

            <div role="group" aria-label="Was Tempo right?" className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
              <span className="text-sm font-medium text-slate-200">Was Tempo right?</span>
              <Button variant="quiet" disabled={label !== null} aria-pressed={label === "scam"} onClick={() => void feedback("scam")} icon={<ThumbsDown size={14} aria-hidden />} className={TAP}>
                That was a scam
              </Button>
              <Button variant="quiet" disabled={label !== null} aria-pressed={label === "real"} onClick={() => void feedback("real")} icon={<ThumbsUp size={14} aria-hidden />} className={TAP}>
                That was real
              </Button>
              {label && <span className="text-xs text-slate-300">You said: that was {label === "scam" ? "a scam" : "real"}. Only the verdict and your answer are kept.</span>}
            </div>
            <p className="text-xs text-slate-400">
              {verdict.simulated ? "Registers and the link sandbox answered from recordings (replay mode)." : "Registers and the link sandbox were checked live."}
              {verdict.model ? ` Text model ${verdict.model.version}.` : ""}
            </p>
            </div>
          </section>
        )}
      </div>

      <Card as="section" aria-labelledby="log-heading">
        <SectionTitle
          id="log-heading"
          right={
            <Button variant="quiet" size="sm" onClick={() => void refresh()} busy={refreshing} icon={<RefreshCw size={12} aria-hidden />} className={TAP}>
              Refresh
            </Button>
          }
        >
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={12} aria-hidden /> The Shield log
          </span>
        </SectionTitle>
        <p className="text-sm text-slate-300">What Tempo has checked. It keeps the verdict and the link hosts, never a word of the message. It updates after every check.</p>
        {!status && !statusFailed && (
          <div role="status" aria-label="Loading the log" className="mt-3 grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        )}
        {statusFailed && <p className="mt-3 text-sm text-amber-100">The Shield log is not reachable right now. Press Refresh, or check the Gateway in Settings.</p>}
        {status && (
          <>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
              {[
                { label: "Checked today", value: status.today.checked },
                { label: "Held and looked at", value: status.today.held },
                { label: "Warned about", value: status.today.warned },
              ].map((s) => (
                <div key={s.label} className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-3">
                  <dt className="text-xs text-slate-400">{s.label}</dt>
                  <dd className="text-2xl font-semibold text-slate-100">{s.value}</dd>
                </div>
              ))}
            </dl>
            {status.recent.length > 0 ? (
              <ul aria-label="Recent checks" className="mt-4 divide-y divide-white/10 text-sm">
                {status.recent.slice(0, 8).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="flex items-center gap-2">
                      <Badge tone={ZONE_BADGE[a.zone].tone}>{ZONE_BADGE[a.zone].words}</Badge>
                      <span className="font-medium text-slate-100">{LEVEL_WORDS[a.level]}</span>
                    </span>
                    <span className="min-w-0 break-words text-xs text-slate-400">
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
              <p className="mt-3 text-xs text-slate-400">Nothing checked yet today.</p>
            )}
            {status.model && (
              <p className="mt-4 text-xs text-slate-400">
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
