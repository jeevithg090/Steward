// Small pieces the profile list, detail and import share (ported from the old ProfileBits and
// site/ui, re-skinned for the golden-hour theme). The Avatar is also used by Who's calling?.
import type { ComponentType, ReactNode } from "react";
import { BookOpenText, Ban, Check, Gauge, Hourglass, Languages, MessageSquareText, Volume1 } from "lucide-react";
import { Badge, type BadgeTone, useCountUp } from "@/components/ui";
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
  return (
    <Badge tone={STATUS_TONE[status]} dot className="!whitespace-normal text-left">
      {STATUS_WORDS[status]}
    </Badge>
  );
}

// --- the avatar: an initial on ink inside a gradient ring ---------------------------------------

const RINGS = [
  "from-accent-300 via-second-400 to-accent-600",
  "from-sky-300 via-accent-400 to-accent-600",
  "from-emerald-200 via-teal-400 to-sky-500",
  "from-rose-300 via-second-400 to-accent-500",
  "from-amber-200 via-rose-300 to-second-500",
  "from-accent-300 via-accent-400 to-second-500",
  "from-teal-200 via-emerald-300 to-accent-500",
];

function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** The letter a name is known by: "The Commuter" is C, not T. */
export function initialOf(name: string): string {
  return (name.replace(/^the\s+/i, "").trim().charAt(0) || "?").toUpperCase();
}

const AVATAR_SIZES = {
  sm: { box: "h-9 w-9 rounded-xl", inner: "rounded-[10px]", text: "text-lg" },
  md: { box: "h-12 w-12 rounded-2xl", inner: "rounded-[14px]", text: "text-2xl" },
  lg: { box: "h-16 w-16 rounded-[1.35rem]", inner: "rounded-[1.25rem]", text: "text-[2rem]" },
  xl: { box: "h-20 w-20 rounded-3xl", inner: "rounded-[1.4rem]", text: "text-[2.6rem]" },
} as const;

/** A decorative initial tile; the name itself is always written next to it. */
export function Avatar({ name, seed, size = "md", glow = false, className = "" }: { name: string; seed?: string; size?: keyof typeof AVATAR_SIZES; glow?: boolean; className?: string }) {
  const s = AVATAR_SIZES[size];
  const ring = RINGS[hash(seed ?? name) % RINGS.length];
  return (
    <span
      aria-hidden
      className={`relative grid shrink-0 place-items-center bg-gradient-to-br p-[1.5px] ${ring} ${s.box} ${glow ? "shadow-[0_0_0_4px_rgb(var(--accent-500)/0.14),0_14px_34px_-12px_rgb(var(--accent-600)/0.85)]" : "shadow-[0_10px_26px_-14px_rgb(0_0_0/0.9)]"} ${className}`}
    >
      <span className={`grid h-full w-full place-items-center bg-[radial-gradient(120%_90%_at_30%_10%,rgb(var(--accent-900))_0%,#0b0c0e_70%)] ${s.inner}`}>
        <span className={`font-display leading-none text-white ${s.text}`}>{initialOf(name)}</span>
      </span>
    </span>
  );
}

// --- how Tempo speaks: chips with an icon each ----------------------------------------------------

type Icon = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;

const CHIP_ICONS: Record<string, Icon> = {
  slower: Gauge,
  patient: Hourglass,
  "lower voice": Volume1,
  "texts the question": MessageSquareText,
  "plain words": BookOpenText,
};

export function AccessChips({ access }: { access: ProfileAccess }) {
  return (
    <ul aria-label="How Tempo speaks with you" className="flex flex-wrap gap-1.5">
      {accessChips(access).map((chip, i) => {
        const ChipIcon = i === 0 ? Languages : (CHIP_ICONS[chip] ?? Languages);
        return (
          <li key={chip}>
            <Badge tone="indigo" className="py-1">
              <ChipIcon size={12} aria-hidden className="text-accent-300" />
              {chip}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

// --- will do / may never ----------------------------------------------------------------------------

function ListHeading({ as: Tag, id, tone, children }: { as: "h2" | "h3"; id: string; tone: "ok" | "no"; children: ReactNode }) {
  const ok = tone === "ok";
  return (
    <Tag id={id} className={`flex items-start gap-2 text-[11px] font-semibold uppercase leading-5 tracking-[0.12em] ${ok ? "text-emerald-300" : "text-rose-300"}`}>
      <span aria-hidden className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ring-1 ring-inset ${ok ? "bg-emerald-500/15 ring-emerald-400/30" : "bg-rose-500/15 ring-rose-400/30"}`}>
        {ok ? <Check size={11} strokeWidth={3} /> : <Ban size={11} strokeWidth={2.5} />}
      </span>
      {children}
    </Tag>
  );
}

function More({ count }: { count: number }) {
  return <p className="mt-2 pl-4 text-xs font-medium text-slate-400">and {count} more</p>;
}

export function MayNever({ actions, id, as: Tag = "h3", limit }: { actions: Action[]; id: string; as?: "h2" | "h3"; limit?: number }) {
  const shown = limit ? actions.slice(0, limit) : actions;
  return (
    <div>
      <ListHeading as={Tag} id={id} tone="no">
        What it may never do
      </ListHeading>
      {actions.length === 0 ? (
        <p className="mt-2 text-sm leading-relaxed text-slate-300">Nothing is ruled out, but nothing binding happens without your signed yes.</p>
      ) : (
        <ul className="mt-2.5 space-y-1.5 text-sm leading-snug text-slate-200">
          {shown.map((a) => (
            <li key={a} className="flex items-start gap-2.5">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400 shadow-[0_0_0_3px_rgb(244_63_94/0.15)]" />
              {capital(ACTION_WORDS[a])}
            </li>
          ))}
        </ul>
      )}
      {limit && actions.length > limit && <More count={actions.length - limit} />}
    </div>
  );
}

export function WillDo({ jobs, id, limit, as: Tag = "h3" }: { jobs: string[]; id: string; limit?: number; as?: "h2" | "h3" }) {
  const shown = limit ? jobs.slice(0, limit) : jobs;
  return (
    <div>
      <ListHeading as={Tag} id={id} tone="ok">
        What this profile will do for you
      </ListHeading>
      <ul className="mt-2.5 space-y-1.5 text-sm leading-snug text-slate-200">
        {shown.map((job) => (
          <li key={job} className="flex items-start gap-2.5">
            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgb(16_185_129/0.15)]" />
            {job}
          </li>
        ))}
      </ul>
      {limit && jobs.length > limit && <More count={jobs.length - limit} />}
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

// --- a headline number ------------------------------------------------------------------------------

const FIGURE_TONES = { default: "text-white", gold: "text-gold", brand: "text-brand", emerald: "text-emerald-300", amber: "text-amber-200", rose: "text-rose-200" } as const;

/** Like the shared Stat (a label, a counted-up number, a line under it), but the number is read
 * from real text, so it is fine on any element (the shared Stat puts aria-label on a <p>). */
export function Figure({ label, value, sub, icon, tone = "default" }: { label: string; value: string; sub?: ReactNode; icon?: ReactNode; tone?: keyof typeof FIGURE_TONES }) {
  const shown = useCountUp(value);
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 sm:tracking-[0.14em]">
        {icon && <span className="hidden sm:inline-flex">{icon}</span>}
        {label}
      </p>
      <p className={`num mt-1.5 text-[2rem] font-semibold leading-none tracking-[-0.02em] ${FIGURE_TONES[tone]}`}>
        <span aria-hidden>{shown}</span>
        <span className="sr-only">{value}</span>
      </p>
      {sub && <div className="mt-2 text-xs leading-snug text-slate-400">{sub}</div>}
    </div>
  );
}
