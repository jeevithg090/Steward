// Am I Owed Anything? (plan.md §2): the Entitlement Check as ten plain questions, one at a time
// with big controls, then what is worth claiming with the official page for each. Screening, not
// a decision. New page; the questions mirror tempo_core.entitlement.QUESTIONS.
import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ExternalLink, PoundSterling, RotateCcw, Volume2 } from "lucide-react";
import { Badge, type BadgeTone, Button, Card, EmptyState, FOCUS, PageTitle, SectionTitle, Spinner } from "@/components/ui";
import type { EntitlementAnswers, EntitlementFlag, EntitlementResult } from "@/lib/api";
import type { PageProps } from "@/types/page";

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

const BIG_INPUT = `w-40 rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-2xl text-slate-100 placeholder:text-slate-600 ${FOCUS}`;

function YesNo({ value, onChange, name }: { value: boolean | null; onChange: (v: boolean) => void; name: string }) {
  return (
    <div role="group" aria-label={name} className="flex flex-wrap gap-3">
      {[
        { v: true, label: "Yes" },
        { v: false, label: "No" },
      ].map((o) => (
        <button
          key={o.label}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={`min-w-[7rem] rounded-2xl border px-6 py-4 text-xl font-semibold transition-colors motion-reduce:transition-none ${FOCUS} ${value === o.v ? "border-indigo-400 bg-indigo-600 text-white" : "border-white/15 bg-black/20 text-slate-100 hover:bg-white/10"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function spokenSummary(result: EntitlementResult): string {
  const worth = result.flags.filter((f) => f.likelihood !== "unlikely");
  if (worth.length === 0) return "Nothing here looks worth claiming right now. This is a quick check, not a decision.";
  const parts = worth.map((f) => `${f.benefit}: ${likelihood(f).words}${f.weekly_gbp ? `, about £${f.weekly_gbp} a week` : ""}`);
  return `Worth checking: ${parts.join(". ")}. This is screening, not a decision; use the official pages to claim.`;
}

export default function OwedPage({ gateway, showcase, speak }: PageProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [result, setResult] = useState<EntitlementResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = QUESTIONS[step]!;
  const last = step === QUESTIONS.length - 1;
  const canGo = answered(draft, q.key);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await gateway.screen(toAnswers(draft)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (!canGo) return;
    if (last) void submit();
    else setStep((s) => s + 1);
  };

  const restart = () => {
    setStep(0);
    setDraft(EMPTY);
    setResult(null);
    setError(null);
  };

  const pack = typeof result?.pack === "string" ? result.pack : null;
  const figures = result?.figures as { tax_year?: string; demo_values?: boolean } | undefined;

  const control: ReactNode = useMemo(() => {
    switch (q.key) {
      case "age":
        return (
          <input aria-label="Your age" type="number" inputMode="numeric" min={16} max={120} value={draft.age} onChange={(e) => set("age", e.target.value)} className={BIG_INPUT} placeholder="74" autoFocus />
        );
      case "weekly_income":
      case "savings": {
        const key = q.key;
        return (
          <div className="flex items-center gap-2">
            <span className="text-2xl text-slate-300" aria-hidden>
              £
            </span>
            <input
              aria-label={key === "savings" ? "Savings in pounds" : "Weekly income in pounds"}
              type="number"
              inputMode="decimal"
              min={0}
              step="1"
              value={draft[key]}
              onChange={(e) => set(key, e.target.value)}
              className={BIG_INPUT}
              placeholder={key === "savings" ? "3000" : "180"}
              autoFocus
            />
            {key === "weekly_income" && <span className="text-sm text-slate-400">a week</span>}
          </div>
        );
      }
      case "care_months":
        return (
          <div className="flex items-center gap-2">
            <input aria-label="Months you have needed help" type="number" inputMode="numeric" min={0} max={600} value={draft.care_months} onChange={(e) => set("care_months", e.target.value)} className={BIG_INPUT} placeholder="8" autoFocus />
            <span className="text-sm text-slate-400">months</span>
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
                    <label className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-base ${on ? "border-indigo-400 bg-indigo-950/40" : "border-white/15 bg-black/20"}`}>
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
                        className={`h-5 w-5 accent-indigo-500 ${FOCUS}`}
                      />
                      <span className="text-slate-100">{b.label}</span>
                    </label>
                  </li>
                );
              })}
              <li>
                <label className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-base ${draft.none ? "border-indigo-400 bg-indigo-950/40" : "border-white/15 bg-black/20"}`}>
                  <input type="checkbox" checked={draft.none} onChange={(e) => setDraft((d) => ({ ...d, none: e.target.checked, benefits: e.target.checked ? [] : d.benefits }))} className={`h-5 w-5 accent-indigo-500 ${FOCUS}`} />
                  <span className="text-slate-100">None of these</span>
                </label>
              </li>
            </ul>
          </fieldset>
        );
      case "terminally_ill":
        return (
          <div className="space-y-2">
            <YesNo value={draft.terminally_ill} onChange={(v) => set("terminally_ill", v)} name={q.question} />
            <button type="button" onClick={() => set("terminally_ill", false)} className={`text-sm text-slate-400 underline ${FOCUS}`}>
              I'd rather not say
            </button>
          </div>
        );
      case "couple":
      case "care_day":
      case "care_night":
      case "broadband":
        return <YesNo value={draft[q.key]} onChange={(v) => set(q.key as "couple" | "care_day" | "care_night" | "broadband", v)} name={q.question} />;
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
          <div className="flex items-center justify-between gap-3">
            <p aria-live="polite" className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Question {step + 1} of {QUESTIONS.length}
            </p>
            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10" aria-hidden>
              <div className="h-full rounded-full bg-indigo-500 transition-all motion-reduce:transition-none" style={{ width: `${((step + 1) / QUESTIONS.length) * 100}%` }} />
            </div>
          </div>
          <div>
            <h2 id="question-heading" className="text-xl font-semibold text-slate-100">
              {q.question}
            </h2>
            {q.help && <p className="mt-1 text-sm text-slate-400">{q.help}</p>}
          </div>
          <form
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
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Button type="button" variant="quiet" size="lg" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy} icon={<ArrowLeft size={16} aria-hidden />}>
                Back
              </Button>
              <Button type="submit" size="lg" disabled={!canGo} busy={busy} icon={last ? <Check size={16} aria-hidden /> : <ArrowRight size={16} aria-hidden />}>
                {last ? "See what I may be owed" : "Next"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {busy && <Spinner label="Checking the figures" />}

      {result && (
        <section aria-labelledby="results-heading" aria-live="polite" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionTitle id="results-heading" className="mb-0">
              What looks worth claiming
            </SectionTitle>
            <div className="flex flex-wrap gap-2">
              <Button variant="quiet" size="sm" onClick={() => speak(spokenSummary(result))} icon={<Volume2 size={14} aria-hidden />}>
                Speak the results
              </Button>
              <Button variant="quiet" size="sm" onClick={restart} icon={<RotateCcw size={14} aria-hidden />}>
                Start again
              </Button>
            </div>
          </div>

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
                    <a href={flag.signpost} rel="noopener noreferrer" target="_blank" className={`mt-auto inline-flex items-center gap-1 text-sm text-indigo-300 underline ${FOCUS}`}>
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
              <summary className={`cursor-pointer text-sm font-medium text-indigo-300 ${FOCUS}`}>Your answers and the check, as text to keep or hand to an adviser</summary>
              <pre className="mt-3 whitespace-pre-wrap font-sans text-xs text-slate-200">{pack}</pre>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
