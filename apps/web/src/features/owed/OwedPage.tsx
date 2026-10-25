// Am I Owed Anything? (plan.md §2): the Entitlement Check as ten plain questions, one at a time
// with big controls, then what is worth claiming with the official page for each. Screening, not
// a decision. New page; the questions mirror tempo_core.entitlement.QUESTIONS.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CornerDownLeft, ExternalLink, PoundSterling, RotateCcw, Volume2 } from "lucide-react";
import { Badge, type BadgeTone, Button, Card, EmptyState, FOCUS, PageTitle, SkeletonCards } from "@/components/ui";
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

function likelihood(flag: EntitlementFlag): { tone: BadgeTone; words: string } {
  return LIKELIHOOD[flag.likelihood] ?? { tone: "slate", words: flag.likelihood.replaceAll("_", " ") };
}

const BIG_INPUT = `min-h-[56px] rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-2xl text-slate-100 placeholder:text-slate-600 ${FOCUS}`;

/** Two big radio cards. Arrow keys move between them, as for any radio group; Enter goes on. */
function YesNo({ value, onChange, name }: { value: boolean | null; onChange: (v: boolean) => void; name: string }) {
  return (
    <div role="radiogroup" aria-labelledby="question-heading" className="grid max-w-md grid-cols-2 gap-3">
      {[
        { v: true, label: "Yes" },
        { v: false, label: "No" },
      ].map((o) => {
        const on = value === o.v;
        return (
          <label
            key={o.label}
            className={`flex min-h-[72px] cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 px-5 py-4 text-xl font-semibold transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-white motion-reduce:transition-none ${
              on ? "border-indigo-300 bg-indigo-600 text-white" : "border-white/15 bg-black/20 text-slate-100 hover:border-white/30 hover:bg-white/10"
            }`}
          >
            <input type="radio" name={name} value={o.label} checked={on} onChange={() => onChange(o.v)} className="sr-only" />
            <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-white bg-white" : "border-slate-400"}`}>
              {on && <span className="h-2.5 w-2.5 rounded-full bg-indigo-600" />}
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
      <div className="relative w-56 max-w-full">
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-2xl font-semibold text-slate-300">
          £
        </span>
        <input aria-label={label} type="text" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} className={`${BIG_INPUT} w-full pl-10`} placeholder={placeholder} />
      </div>
      {suffix && <span className="text-base text-slate-300">{suffix}</span>}
    </div>
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
            <input aria-label="Your age" type="number" inputMode="numeric" min={16} max={120} value={draft.age} onChange={(e) => set("age", e.target.value)} className={`${BIG_INPUT} w-32`} placeholder="74" />
            <span className="text-base text-slate-300">years</span>
          </div>
        );
      case "weekly_income":
        return <Money label="Weekly income in pounds" value={draft.weekly_income} onChange={(v) => set("weekly_income", v)} placeholder="180" suffix="a week" />;
      case "savings":
        return <Money label="Savings in pounds" value={draft.savings} onChange={(v) => set("savings", v)} placeholder="3000" />;
      case "care_months":
        return (
          <div className="flex items-center gap-2">
            <input aria-label="Months you have needed help" type="number" inputMode="numeric" min={0} max={600} value={draft.care_months} onChange={(e) => set("care_months", e.target.value)} className={`${BIG_INPUT} w-32`} placeholder="8" />
            <span className="text-base text-slate-300">months</span>
          </div>
        );
      case "benefits":
        return (
          <fieldset>
            <legend className="sr-only">Benefits you already get</legend>
            <ul className="grid gap-2 sm:grid-cols-2">
              {BENEFIT_OPTIONS.map((b) => {
                const on = draft.benefits.includes(b.code);
                return (
                  <li key={b.code}>
                    <label className={`flex min-h-[56px] cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 text-base has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-white ${on ? "border-indigo-300 bg-indigo-950/60" : "border-white/15 bg-black/20 hover:bg-white/5"}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            none: false,
                            benefits: e.target.checked ? [...d.benefits, b.code] : d.benefits.filter((c) => c !== b.code),
                          }))
                        }
                        className="h-5 w-5 shrink-0 accent-indigo-500 focus:outline-none"
                      />
                      <span className="text-slate-100">{b.label}</span>
                    </label>
                  </li>
                );
              })}
              <li>
                <label className={`flex min-h-[56px] cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 text-base has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-white ${draft.none ? "border-indigo-300 bg-indigo-950/60" : "border-white/15 bg-black/20 hover:bg-white/5"}`}>
                  <input type="checkbox" checked={draft.none} onChange={(e) => setDraft((d) => ({ ...d, none: e.target.checked, benefits: e.target.checked ? [] : d.benefits }))} className="h-5 w-5 shrink-0 accent-indigo-500 focus:outline-none" />
                  <span className="text-slate-100">None of these</span>
                </label>
              </li>
            </ul>
          </fieldset>
        );
      case "terminally_ill":
        return (
          <div className="space-y-2">
            <YesNo value={draft.terminally_ill} onChange={(v) => set("terminally_ill", v)} name="terminally_ill" />
            <button type="button" onClick={() => set("terminally_ill", false)} className={`${TAP} rounded-full px-1 text-sm text-slate-300 underline ${FOCUS}`}>
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
    <div className="space-y-5">
      <PageTitle lede="Ten plain questions, then what looks worth claiming, with the official page for each. Tempo only looks and explains here; it never files anything for you.">
        Am I Owed Anything?
      </PageTitle>

      {!result && (
        <Card as="section" aria-labelledby="question-heading" className="space-y-5">
          <div>
            <div className="flex items-center justify-between gap-3">
              <p aria-live="polite" className="text-xs font-semibold uppercase tracking-wider text-slate-300">
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
              className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10"
            >
              <div className="h-full rounded-full bg-indigo-500 transition-all motion-reduce:transition-none" style={{ width: `${((step + 1) / QUESTIONS.length) * 100}%` }} />
            </div>
          </div>
          <div>
            <h2 id="question-heading" className="text-2xl font-semibold leading-snug text-slate-100">
              {q.question}
            </h2>
            {q.help && <p className="mt-1 text-sm text-slate-300">{q.help}</p>}
          </div>
          <form
            ref={formRef}
            onKeyDown={onKeyDown}
            onSubmit={(e) => {
              e.preventDefault();
              next();
            }}
          >
            {control}
            {error && (
              <p role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-sm text-rose-100">
                {error}
              </p>
            )}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button type="button" variant="quiet" size="lg" onClick={back} disabled={step === 0 || busy} icon={<ArrowLeft size={16} aria-hidden />}>
                Back
              </Button>
              <Button type="submit" size="lg" disabled={!canGo} busy={busy} icon={last ? <Check size={16} aria-hidden /> : <ArrowRight size={16} aria-hidden />}>
                {last ? "See what I may be owed" : "Next"}
              </Button>
              <span className="plain-hide hidden items-center gap-1 text-xs text-slate-400 sm:inline-flex">
                <CornerDownLeft size={12} aria-hidden /> Enter also means Next
              </span>
            </div>
          </form>
        </Card>
      )}

      {busy && <SkeletonCards count={2} label="Checking the figures" />}

      {result && (
        <section aria-labelledby="results-heading" aria-live="polite" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="results-heading" ref={resultsRef} tabIndex={-1} className="text-xl font-semibold text-slate-100 focus:outline-none">
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
            <Card tone="emerald" className="flex flex-wrap items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-200">
                <PoundSterling size={24} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-3xl font-bold text-emerald-100">
                  about £{total} <span className="text-base font-normal text-emerald-200/80">a week</span>
                </p>
                <p className="text-sm text-emerald-50">if all of these apply. Screening only: the official pages and DWP decide.</p>
              </div>
            </Card>
          )}

          <Card tone="amber" className="flex gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-amber-100">Screening, not a decision</p>
              <p className="mt-1 text-sm text-amber-50">{result.disclaimer}</p>
              {(figures?.demo_values || showcase) && (
                <p className="mt-1 text-xs text-amber-200/80">
                  {figures?.tax_year ? `${figures.tax_year} figures, ` : ""}demo values: the amounts have not yet been checked against this year's published rates.
                </p>
              )}
            </div>
          </Card>

          {result.flags.length === 0 ? (
            <EmptyState title="Nothing looks worth claiming right now" icon={<PoundSterling size={28} aria-hidden />}>
              Circumstances change. Come back if your income, savings or health change.
            </EmptyState>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {result.flags.map((flag) => {
                const l = likelihood(flag);
                return (
                  <Card key={flag.benefit} as="li" className={`flex flex-col gap-2 ${l.tone === "emerald" ? "border-emerald-500/30" : l.tone === "amber" ? "border-amber-500/30" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="text-base font-semibold text-slate-100">{flag.benefit}</h3>
                      <Badge tone={l.tone}>{l.words}</Badge>
                    </div>
                    {flag.weekly_gbp && (
                      <p className="text-2xl font-semibold text-emerald-200">
                        about £{flag.weekly_gbp} <span className="text-sm font-normal text-slate-400">a week</span>
                      </p>
                    )}
                    <p className="text-sm text-slate-200">{flag.why}</p>
                    <a href={flag.signpost} rel="noopener noreferrer" target="_blank" className={`mt-auto inline-flex ${TAP} items-center gap-1 text-sm text-indigo-300 underline ${FOCUS}`}>
                      The official page <ExternalLink size={12} aria-hidden />
                      <span className="sr-only"> for {flag.benefit} (opens in a new tab)</span>
                    </a>
                  </Card>
                );
              })}
            </ul>
          )}

          {pack && (
            <details className="rounded-2xl border border-white/10 bg-nexus-card p-4">
              <summary className={`flex min-h-[44px] cursor-pointer items-center text-sm font-medium text-indigo-300 ${FOCUS}`}>Your answers and the check, as text to keep or hand to an adviser</summary>
              <pre className="mt-3 whitespace-pre-wrap font-sans text-xs text-slate-200">{pack}</pre>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
