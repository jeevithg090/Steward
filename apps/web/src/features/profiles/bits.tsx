// Small pieces the profile list, detail and import share (ported from the old ProfileBits and
// site/ui, re-skinned for the dark theme).
import { Badge, type BadgeTone } from "@/components/ui";
import { ACTION_WORDS, type Action, type ProfileAccess, type ProfileLimits, type ProfileStatus, type SkillStatus, accessChips } from "@/lib/profiles";

export const GITHUB = "https://github.com/jeevithg090/Tempo";
export const DOCS = {
  addUseCase: `${GITHUB}/blob/main/docs/add-a-usecase.md`,
  profiles: `${GITHUB}/blob/main/docs/profiles.md`,
  security: `${GITHUB}/blob/main/docs/security.md`,
};

/** Plain words for a status, said out loud (honesty is a product rule). */
export const STATUS_WORDS: Record<SkillStatus | ProfileStatus, string> = {
  ready: "ready",
  "demo-values": "demo values: not yet checked against the published terms",
  experimental: "experimental",
  starter: "starter profile by the Tempo team",
  community: "community profile",
};

export const STATUS_TONE: Record<SkillStatus | ProfileStatus, BadgeTone> = {
  ready: "emerald",
  "demo-values": "amber",
  experimental: "slate",
  starter: "indigo",
  community: "purple",
};

export const CHANNEL_WORDS: Record<string, string> = { web: "the web", sms: "text message", voice: "the phone" };

export function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function StatusBadge({ status }: { status: SkillStatus | ProfileStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_WORDS[status]}</Badge>;
}

export function AccessChips({ access }: { access: ProfileAccess }) {
  return (
    <ul aria-label="How Tempo speaks with you" className="flex flex-wrap gap-1.5">
      {accessChips(access).map((chip) => (
        <li key={chip}>
          <Badge tone="indigo">{chip}</Badge>
        </li>
      ))}
    </ul>
  );
}

export function MayNever({ actions, id, as: Tag = "h3", limit }: { actions: Action[]; id: string; as?: "h2" | "h3"; limit?: number }) {
  const shown = limit ? actions.slice(0, limit) : actions;
  return (
    <div>
      <Tag id={id} className="text-[10px] font-semibold uppercase tracking-wider text-rose-300">
        What it may never do
      </Tag>
      {actions.length === 0 ? (
        <p className="mt-1 text-sm text-slate-300">Nothing is ruled out, but nothing binding happens without your signed yes.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm text-slate-200">
          {shown.map((a) => (
            <li key={a} className="flex items-start gap-2">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
              {capital(ACTION_WORDS[a])}
            </li>
          ))}
        </ul>
      )}
      {limit && actions.length > limit && <p className="mt-1 text-xs text-slate-400">and {actions.length - limit} more</p>}
    </div>
  );
}

export function WillDo({ jobs, id, limit, as: Tag = "h3" }: { jobs: string[]; id: string; limit?: number; as?: "h2" | "h3" }) {
  const shown = limit ? jobs.slice(0, limit) : jobs;
  return (
    <div>
      <Tag id={id} className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
        What this profile will do for you
      </Tag>
      <ul className="mt-1 space-y-1 text-sm text-slate-200">
        {shown.map((job) => (
          <li key={job} className="flex items-start gap-2">
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            {job}
          </li>
        ))}
      </ul>
      {limit && jobs.length > limit && <p className="mt-1 text-xs text-slate-400">and {jobs.length - limit} more</p>}
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

export function accessInWords(access: ProfileAccess): string {
  const parts = [
    `speaks ${accessChips(access)[0]}`,
    access.pace === "slower" ? "at a slower pace" : "at the usual pace",
    access.patience === "high" ? "with extra time to answer, never rushed" : "patiently, as for everyone",
    access.voice === "low" ? "in a lower voice" : "in the usual voice",
  ];
  if (access.prefers_text) parts.push("and offers every question by text too");
  if (access.plain_words) parts.push("in plain words");
  return `Tempo ${parts.join(", ")}.`;
}
