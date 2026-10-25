// Am I Owed Anything? (plan.md §2): the Entitlement Check as ten plain questions, one at a time
// with big controls, then what is worth claiming with the official page for each. Screening, not
// a decision. New page; the questions mirror tempo_core.entitlement.QUESTIONS.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, ExternalLink, FileText, Info, PoundSterling, RotateCcw, Volume2 } from "lucide-react";
import { Badge, type BadgeTone, Button, Card, EmptyState, FOCUS, Kbd, PageTitle, SkeletonCards } from "@/components/ui";
import type { EntitlementAnswers, EntitlementFlag, EntitlementResult } from "@/lib/api";
import type { PageProps } from "@/types/page";
import { TAP } from "../story/demo";

export const BENEFIT_OPTIONS: { code: string; label: string }[] = [
  { code: "state_pension", label: "State Pension" },
  { code: "pension_credit", label: "Pension Credit" },
  { code: "universal_credit", label: "Universal Credit" },
  { code: "attendance_allowance", label: "Attendance Allowance" },
  { code: "pip", label: "PIP (Personal Independence Payment)" },
  { code: "housing_benefit", label: "Housing Benefit" },
];

export interface Draft {
  age: string;
  couple: boolean | null;
  weekly_income: string;
  savings: string;
  benefits: string[];
  none: boolean;
  care_day: boolean | null;
  care_night: boolean | null;
  care_months: string;
  terminally_ill: boolean | null;
  broadband: boolean | null;
}

const EMPTY: Draft = {
  age: "",
  couple: null,
  weekly_income: "",
  savings: "",
  benefits: [],
  none: false,
  care_day: null,
  care_night: null,
  care_months: "",
  terminally_ill: null,
  broadband: null,
};

export const QUESTIONS: { key: keyof Draft; question: string; help?: string }[] = [
  { key: "age", question: "How old are you?" },
  { key: "couple", question: "Do you live with a partner?", help: "A husband, wife or partner you live with. Not a lodger or a carer." },
  { key: "weekly_income", question: "Roughly how much comes in each week, from pensions and earnings?", help: "A rough figure is fine. Pounds a week, before anything is taken off." },
  { key: "savings", question: "Roughly how much do you have in savings?", help: "Everything in the bank, building society or Premium Bonds, added up." },
  { key: "benefits", question: "Do you get any benefits now?", help: "Tick everything you already get, or “none of these”." },
  { key: "care_day", question: "Do you need help in the day with washing, dressing, eating or the toilet?" },
  { key: "care_night", question: "Do you need help at night?" },
  { key: "care_months", question: "How many months have you needed that help?", help: "Attendance Allowance usually needs six months. Put 0 if you don't need help." },
  { key: "terminally_ill", question: "Has a doctor said you may have less than 12 months to live?", help: "You can leave this one. If the answer is yes, some help is faster and the six-month wait does not apply." },
  { key: "broadband", question: "Do you pay for broadband or a phone line?" },
];

function money(text: string): string {
  const n = Number(text.replace(/[£,\s]/g, ""));
  return (Number.isFinite(n) && n >= 0 ? n : 0).toFixed(2);
}

export function toAnswers(d: Draft): EntitlementAnswers {
  return {
    age: Math.max(16, Math.min(120, Math.round(Number(d.age) || 0))),
    couple: d.couple === true,
    weekly_income_gbp: money(d.weekly_income),
    savings_gbp: money(d.savings),
    benefits: d.none ? [] : d.benefits,
    needs_care_day: d.care_day === true,
    needs_care_night: d.care_night === true,
    care_months: Math.max(0, Math.round(Number(d.care_months) || 0)),
    terminally_ill: d.terminally_ill === true,
    has_broadband_or_phone: d.broadband !== false,
  };
}

/** Whether a question has been answered well enough to move on. */
export function answered(d: Draft, key: keyof Draft): boolean {
  switch (key) {
    case "age": {
      const n = Number(d.age);
      return Number.isInteger(n) && n >= 16 && n <= 120;
    }
    case "weekly_income":
      return d.weekly_income.trim() !== "" && Number.isFinite(Number(d.weekly_income.replace(/[£,\s]/g, "")));
    case "savings":
      return d.savings.trim() !== "" && Number.isFinite(Number(d.savings.replace(/[£,\s]/g, "")));
    case "benefits":
      return d.none || d.benefits.length > 0;
    case "care_months":
      return d.care_months.trim() !== "" && Number(d.care_months) >= 0;
    case "terminally_ill":
      return true; // optional, gently
    case "none":
      return true;
    default:
      return d[key] !== null;
  }
}

const LIKELIHOOD: Record<string, { tone: BadgeTone; words: string }> = {
  likely: { tone: "emerald", words: "likely" },
  possible: { tone: "amber", words: "possible" },
  worth_checking: { tone: "amber", words: "worth checking" },
  unlikely: { tone: "slate", words: "unlikely" },
};

/** The 3-px rail down a result card's left edge, by how likely it is. */
const RAIL: Partial<Record<BadgeTone, string>> = { emerald: "before:bg-emerald-400", amber: "before:bg-amber-400", slate: "before:bg-slate-500" };

/** "https://www.gov.uk/pension-credit" → "gov.uk" */
function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function likelihood(flag: EntitlementFlag): { tone: BadgeTone; words: string } {
  return LIKELIHOOD[flag.likelihood] ?? { tone: "slate", words: flag.likelihood.replaceAll("_", " ") };
}

/** Big glass fields with a violet glow on focus (the glow is the focus ring here, so it is strong). */
const BIG_INPUT = "num min-h-[64px] rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-3xl font-semibold tracking-[-0.01em] text-white transition-[border-color,box-shadow,background-color] duration-150 placeholder:font-normal placeholder:text-slate-600 hover:border-white/20 focus:border-accent-300 focus:bg-white/[0.05] focus:outline-none focus:ring-4 focus:ring-accent-500/25 focus-visible:outline-none motion-reduce:transition-none";

/** A big answer card: violet and glowing when chosen. Its input is visually hidden; the ring shows its focus. */
const CHOICE = "flex cursor-pointer items-center gap-3 rounded-2xl border transition-[background-color,border-color,box-shadow] duration-150 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-300 motion-reduce:transition-none";
const CHOICE_ON = "border-accent-300/70 bg-gradient-to-b from-accent-500/25 to-accent-600/10 text-white shadow-glow";
const CHOICE_OFF = "border-white/10 bg-white/[0.03] text-slate-100 hover:border-accent-300/40 hover:bg-white/[0.06]";

/** Two big radio cards. Arrow keys move between them, as for any radio group; Enter goes on. */
function YesNo({ value, onChange, name }: { value: boolean | null; onChange: (v: boolean) => void; name: string }) {
  return (
    <div role="radiogroup" aria-labelledby="question-heading" className="grid max-w-lg grid-cols-2 gap-3">
      {[
        { v: true, label: "Yes" },
        { v: false, label: "No" },
      ].map((o) => {
        const on = value === o.v;
        return (
          <label key={o.label} className={`${CHOICE} min-h-[80px] justify-center px-5 py-4 text-xl font-semibold ${on ? CHOICE_ON : CHOICE_OFF}`}>
            <input type="radio" name={name} value={o.label} checked={on} onChange={() => onChange(o.v)} className="sr-only" />
            <span aria-hidden className={`grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors motion-reduce:transition-none ${on ? "bg-accent-500 ring-2 ring-accent-200/60" : "ring-2 ring-inset ring-slate-500"}`}>
              {on && <span className="h-2.5 w-2.5 rounded-full bg-white" />}
            </span>
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

function Money({ value, onChange, label, placeholder, suffix }: { value: string; onChange: (v: string) => void; label: string; placeholder: string; suffix?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-60 max-w-full">
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-5 flex items-center text-3xl font-semibold text-accent-200">
          £
        </span>
        <input aria-label={label} type="text" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} className={`${BIG_INPUT} w-full pl-11`} placeholder={placeholder} />
      </div>
      {suffix && <span className="text-lg text-slate-300">{suffix}</span>}
    </div>
  );
}

/** A tick-box answer card (benefits, or none of these). */
function Tick({ on, onChange, children }: { on: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className={`${CHOICE} min-h-[60px] px-4 py-3 text-base ${on ? CHOICE_ON : CHOICE_OFF}`}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <span aria-hidden className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg transition-colors motion-reduce:transition-none ${on ? "bg-accent-500 text-white ring-2 ring-accent-200/60" : "ring-2 ring-inset ring-slate-500"}`}>
        {on && <Check size={15} strokeWidth={3} />}
      </span>
      <span className={on ? "text-white" : "text-slate-100"}>{children}</span>
    </label>
  );
}

/** What the flags add up to a week, if every one that isn't "unlikely" applies. Screening only. */
export function weeklyTotal(result: EntitlementResult): string | null {
  const known = result.flags.filter((f) => f.likelihood !== "unlikely" && f.weekly_gbp !== null && Number.isFinite(Number(f.weekly_gbp)));
  if (known.length === 0) return null;
  const pence = known.reduce((sum, f) => sum + Math.round(Number(f.weekly_gbp) * 100), 0);
  return (pence / 100).toFixed(2);
}

export function spokenSummary(result: EntitlementResult): string {
  const worth = result.flags.filter((f) => f.likelihood !== "unlikely");
  if (worth.length === 0) return "Nothing here looks worth claiming right now. This is a quick check, not a decision.";
  const parts = worth.map((f) => `${f.benefit}: ${likelihood(f).words}${f.weekly_gbp ? `, about £${f.weekly_gbp} a week` : ""}`);
  const total = weeklyTotal(result);
  return `Worth checking: ${parts.join(". ")}.${total ? ` If all of these apply, that is about £${total} a week.` : ""} This is screening, not a decision; use the official pages to claim.`;
}

export default function OwedPage({ gateway, showcase, speak }: PageProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [result, setResult] = useState<EntitlementResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const q = QUESTIONS[step]!;
  const last = step === QUESTIONS.length - 1;
  const canGo = answered(draft, q.key);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // Each new question takes the focus, so the keyboard (and Enter) carries straight on.
  useEffect(() => {
    if (!moved.current) return;
    const form = formRef.current;
    const target = form?.querySelector<HTMLInputElement>("input:checked") ?? form?.querySelector<HTMLInputElement>("input");
    target?.focus();
  }, [step, result]);

  useEffect(() => {
    if (result) resultsRef.current?.focus();
  }, [result]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await gateway.screen(toAnswers(draft)));
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setError(`Couldn't check the figures: ${text.replace(/\.?$/, ".")} Press the button again, or check the Gateway in Settings.`);
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (!canGo || busy) return;
    moved.current = true;
    if (last) void submit();
    else setStep((s) => s + 1);
  };

  const back = () => {
    moved.current = true;
    setStep((s) => Math.max(0, s - 1));
  };

  // Enter means Next everywhere in the question, even on a radio card or a tick box.
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && t instanceof HTMLInputElement && (t.type === "radio" || t.type === "checkbox")) {
      e.preventDefault();
      next();
    }
  };

  const restart = () => {
    moved.current = true;
    setStep(0);
    setDraft(EMPTY);
    setResult(null);
    setError(null);
  };

  const pack = typeof result?.pack === "string" ? result.pack : null;
  const total = result ? weeklyTotal(result) : null;
  const figures = result?.figures as { tax_year?: string; demo_values?: boolean } | undefined;

  const control: ReactNode = useMemo(() => {
    switch (q.key) {
      case "age":
        return (
          <div className="flex flex-wrap items-center gap-3">
            <input aria-label="Your age" type="number" inputMode="numeric" min={16} max={120} value={draft.age} onChange={(e) => set("age", e.target.value)} className={`${BIG_INPUT} w-36`} placeholder="74" />
            <span className="text-lg text-slate-300">years</span>
          </div>
        );
      case "weekly_income":
        return <Money label="Weekly income in pounds" value={draft.weekly_income} onChange={(v) => set("weekly_income", v)} placeholder="180" suffix="a week" />;
      case "savings":
        return <Money label="Savings in pounds" value={draft.savings} onChange={(v) => set("savings", v)} placeholder="3000" />;
      case "care_months":
        return (
          <div className="flex items-center gap-3">
            <input aria-label="Months you have needed help" type="number" inputMode="numeric" min={0} max={600} value={draft.care_months} onChange={(e) => set("care_months", e.target.value)} className={`${BIG_INPUT} w-36`} placeholder="8" />
            <span className="text-lg text-slate-300">months</span>
          </div>
        );
      case "benefits":
        return (
          <fieldset>
            <legend className="sr-only">Benefits you already get</legend>
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {BENEFIT_OPTIONS.map((b) => (
                <li key={b.code}>
                  <Tick
                    on={draft.benefits.includes(b.code)}
                    onChange={(checked) =>
                      setDraft((d) => ({
                        ...d,
                        none: false,
                        benefits: checked ? [...d.benefits, b.code] : d.benefits.filter((c) => c !== b.code),
                      }))
                    }
                  >
                    {b.label}
                  </Tick>
                </li>
              ))}
              <li>
                <Tick on={draft.none} onChange={(checked) => setDraft((d) => ({ ...d, none: checked, benefits: checked ? [] : d.benefits }))}>
                  None of these
                </Tick>
              </li>
            </ul>
          </fieldset>
        );
      case "terminally_ill":
        return (
          <div className="space-y-3">
            <YesNo value={draft.terminally_ill} onChange={(v) => set("terminally_ill", v)} name="terminally_ill" />
            <button type="button" onClick={() => set("terminally_ill", false)} className={`${TAP} rounded-full px-2 text-sm text-slate-300 underline decoration-slate-500 underline-offset-4 hover:text-white hover:decoration-slate-300 ${FOCUS}`}>
              I'd rather not say
            </button>
          </div>
        );
      case "couple":
      case "care_day":
      case "care_night":
      case "broadband":
        return <YesNo value={draft[q.key]} onChange={(v) => set(q.key as "couple" | "care_day" | "care_night" | "broadband", v)} name={q.key} />;
      default:
        return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.key, draft]);

  return (
    <div className="space-y-6">
      <PageTitle lede="Ten plain questions, then what looks worth claiming, with the official page for each. Tempo only looks and explains here; it never files anything for you.">
        Am I Owed Anything?
      </PageTitle>

      {!result && (
        <Card as="section" aria-labelledby="question-heading" className="relative overflow-hidden !p-0">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-accent-600/15 blur-3xl" />
          <div className="relative border-b border-white/[0.06] px-5 pb-5 pt-5 sm:px-8 sm:pt-6">
            <div className="flex items-center justify-between gap-3">
              <p aria-live="polite" className="num text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-200">
                Question {step + 1} of {QUESTIONS.length}
              </p>
              <p className="text-xs text-slate-400">{QUESTIONS.length - step - 1 === 0 ? "Last one" : `${QUESTIONS.length - step - 1} more after this`}</p>
            </div>
            <div
              role="progressbar"
              aria-label="Progress through the questions"
              aria-valuemin={1}
              aria-valuemax={QUESTIONS.length}
              aria-valuenow={step + 1}
              aria-valuetext={`Question ${step + 1} of ${QUESTIONS.length}`}
              className="mt-3 flex gap-1.5"
            >
              {QUESTIONS.map((x, i) => (
                <span
                  key={x.key}
                  className={`h-1.5 flex-1 rounded-full transition-[background-color,box-shadow] duration-300 motion-reduce:transition-none ${
                    i < step ? "bg-gradient-to-r from-accent-500 to-accent-400" : i === step ? "bg-accent-300 shadow-[0_0_12px_rgb(var(--accent-400)/0.8)]" : "bg-white/[0.08]"
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="relative px-5 pb-6 pt-7 sm:px-8 sm:pb-8 sm:pt-9">
            <div key={`q-${q.key}`} className="max-w-2xl motion-safe:animate-fade-up">
              <h2 id="question-heading" className="font-display text-[2rem] leading-[1.1] text-white sm:text-[2.6rem]">
                {q.question}
              </h2>
              {q.help && <p className="mt-3 text-[15px] leading-relaxed text-slate-300">{q.help}</p>}
            </div>
            <form
              ref={formRef}
              onKeyDown={onKeyDown}
              onSubmit={(e) => {
                e.preventDefault();
                next();
              }}
              className="mt-7"
            >
              <div key={`c-${q.key}`} className="motion-safe:animate-fade-up">
                {control}
              </div>
              {error && (
                <p role="alert" className="mt-5 flex items-start gap-2.5 rounded-2xl border border-rose-400/30 bg-rose-500/[0.08] px-4 py-3 text-sm text-rose-100">
                  <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-rose-300" />
                  <span>{error}</span>
                </p>
              )}
              <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-6">
                <Button type="button" variant="quiet" size="lg" onClick={back} disabled={step === 0 || busy} icon={<ArrowLeft size={16} aria-hidden />}>
                  Back
                </Button>
                <Button type="submit" size="lg" disabled={!canGo} busy={busy} icon={last ? <Check size={16} aria-hidden /> : <ArrowRight size={16} aria-hidden />}>
                  {last ? "See what I may be owed" : "Next"}
                </Button>
                <span className="plain-hide ml-auto hidden items-center gap-2 text-xs text-slate-400 sm:inline-flex">
                  <Kbd className="px-1.5">Enter</Kbd> Enter also means Next
                </span>
              </div>
            </form>
          </div>
        </Card>
      )}

      {busy && <SkeletonCards count={2} label="Checking the figures" />}

      {result && (
        <section aria-labelledby="results-heading" aria-live="polite" className="space-y-5 motion-safe:animate-fade-up">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="results-heading" ref={resultsRef} tabIndex={-1} className="font-display text-[2rem] leading-[1.1] text-white focus:outline-none sm:text-[2.4rem]">
              What looks worth claiming
            </h2>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => speak(spokenSummary(result))} icon={<Volume2 size={16} aria-hidden />} className={TAP}>
                Read the results to me
              </Button>
              <Button variant="quiet" onClick={restart} icon={<RotateCcw size={14} aria-hidden />} className={TAP}>
                Start again
              </Button>
            </div>
          </div>

          {total && (
            <Card tone="gold" className="relative overflow-hidden">
              <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gold-400/15 blur-3xl" />
              <div className="relative flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-5">
                <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-gold-300 to-gold-500 text-ink shadow-glow-gold">
                  <PoundSterling size={26} strokeWidth={2.25} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="num font-display text-[2.6rem] leading-none text-gold sm:text-[3.2rem]">
                    about £{total} <span className="whitespace-nowrap font-sans text-lg font-normal text-gold-200/80">a week</span>
                  </p>
                  <p className="mt-2.5 text-sm text-amber-50/90">if all of these apply. Screening only: the official pages and DWP decide.</p>
                </div>
              </div>
            </Card>
          )}

          <Card tone="amber" className="flex gap-4">
            <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-amber-400/15 text-amber-200 ring-1 ring-inset ring-amber-300/25">
              <AlertTriangle size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-amber-50">Screening, not a decision</p>
              <p className="mt-1 text-sm leading-relaxed text-amber-50/90">{result.disclaimer}</p>
              {(figures?.demo_values || showcase) && (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-500/[0.08] px-3 py-2 text-[13px] leading-relaxed text-amber-100 ring-1 ring-inset ring-amber-400/20">
                  <Info size={14} aria-hidden className="mt-0.5 shrink-0 text-amber-300" />
                  <span>{figures?.tax_year ? `${figures.tax_year} figures, ` : ""}demo values: the amounts have not yet been checked against this year's published rates.</span>
                </p>
              )}
            </div>
          </Card>

          {result.flags.length === 0 ? (
            <EmptyState title="Nothing looks worth claiming right now" icon={<PoundSterling size={22} aria-hidden />}>
              Circumstances change. Come back if your income, savings or health change.
            </EmptyState>
          ) : (
            <ul className="stagger grid gap-4 md:grid-cols-2">
              {result.flags.map((flag) => {
                const l = likelihood(flag);
                const unlikely = flag.likelihood === "unlikely";
                const site = host(flag.signpost);
                return (
                  <Card
                    key={flag.benefit}
                    as="li"
                    className={`relative flex flex-col overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${RAIL[l.tone] ?? "before:bg-slate-500"}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-white">{flag.benefit}</h3>
                      <Badge tone={l.tone} dot>
                        {l.words}
                      </Badge>
                    </div>
                    {flag.weekly_gbp && (
                      <p className={`num mt-3 font-display text-[2.1rem] leading-none ${unlikely ? "text-slate-300" : "text-gold"}`}>
                        about £{flag.weekly_gbp} <span className="font-sans text-sm font-normal text-slate-400">a week</span>
                      </p>
                    )}
                    <p className="mt-3 text-sm leading-relaxed text-slate-300">{flag.why}</p>
                    <div className="mt-auto pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-2">
                        <a
                          href={flag.signpost}
                          rel="noopener noreferrer"
                          target="_blank"
                          className={`inline-flex ${TAP} items-center gap-1.5 rounded text-sm font-medium text-accent-200 underline decoration-accent-300/40 underline-offset-4 transition-colors hover:text-white hover:decoration-accent-200 motion-reduce:transition-none ${FOCUS}`}
                        >
                          The official page <ExternalLink size={13} aria-hidden />
                          <span className="sr-only"> for {flag.benefit} (opens in a new tab)</span>
                        </a>
                        {site && <span className="font-mono text-xs text-slate-400">{site}</span>}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </ul>
          )}

          {pack && (
            <details className="group surface rounded-2xl px-4 py-1">
              <summary className={`flex min-h-[48px] cursor-pointer list-none items-center gap-2.5 rounded-xl text-sm font-medium text-accent-200 hover:text-white [&::-webkit-details-marker]:hidden ${FOCUS}`}>
                <FileText size={16} aria-hidden className="shrink-0 text-accent-300" />
                <span className="flex-1">Your answers and the check, as text to keep or hand to an adviser</span>
                <ChevronDown size={16} aria-hidden className="shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              <pre className="mb-4 mt-1 whitespace-pre-wrap rounded-xl bg-black/30 p-4 font-sans text-xs leading-relaxed text-slate-200 ring-1 ring-inset ring-white/[0.06]">{pack}</pre>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
