import { ACTION_WORDS, type Action, type ProfileAccess, type ProfileLimits, accessChips } from "@/lib/profiles";
import { Chip } from "./ui";

export function AccessChips({ access }: { access: ProfileAccess }) {
  return (
    <ul aria-label="How Tempo speaks with you" className="flex flex-wrap gap-2">
      {accessChips(access).map((chip) => (
        <li key={chip}><Chip tone="teal">{chip}</Chip></li>
      ))}
    </ul>
  );
}

export function sentence(actions: Action[]): string {
  return actions.map((a) => ACTION_WORDS[a]).join("; ");
}

type Level = 2 | 3;

function Heading({ level, id, className, children }: { level: Level; id: string; className: string; children: string }) {
  return level === 2 ? <h2 id={id} className={className}>{children}</h2> : <h3 id={id} className={className}>{children}</h3>;
}

export function MayNever({ actions, id, level = 3 }: { actions: Action[]; id: string; level?: Level }) {
  return (
    <div>
      <Heading level={level} id={id} className="text-lg font-semibold text-rose-900">What it may never do</Heading>
      {actions.length === 0 ? (
        <p className="mt-1 text-slate-800">Nothing is ruled out, but nothing binding happens without your signed yes.</p>
      ) : (
        <ul className="mt-1 list-disc space-y-1 pl-6 text-slate-800">
          {actions.map((a) => <li key={a}>{capital(ACTION_WORDS[a])}</li>)}
        </ul>
      )}
    </div>
  );
}

export function WillDo({ jobs, id, limit, level = 3 }: { jobs: string[]; id: string; limit?: number; level?: Level }) {
  const shown = limit ? jobs.slice(0, limit) : jobs;
  return (
    <div>
      <Heading level={level} id={id} className="text-lg font-semibold text-teal-900">What this profile will do for you</Heading>
      <ul className="mt-1 list-disc space-y-1 pl-6 text-slate-800">
        {shown.map((job) => <li key={job}>{job}</li>)}
      </ul>
      {limit && jobs.length > limit && <p className="mt-1 text-slate-700">and {jobs.length - limit} more</p>}
    </div>
  );
}

export function limitsInWords(limits: ProfileLimits): string[] {
  const claim = Number(limits.max_gbp_per_claim);
  return [
    claim > 0 ? `Up to £${limits.max_gbp_per_claim} a claim; above that it asks you first.` : "It never claims money: £0.00 a claim.",
    `Asks you at most ${limits.max_user_questions} ${limits.max_user_questions === 1 ? "question" : "questions"} per case.`,
    `Spends at most £${limits.max_llm_gbp_per_mission} on AI per case.`,
    `A signed mandate lasts ${limits.mandate_days} ${limits.mandate_days === 1 ? "day" : "days"}, then it is asked for again.`,
  ];
}

export function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
