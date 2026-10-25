// Skills (plan.md §2): the manifests in plain words: jobs, capabilities needed, status, operators,
// and how to add one. Ported from the old SkillsPage; dark theme.
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { ArrowRight, BadgeCheck, BookOpen, ExternalLink, Eye, FlaskConical, FolderPlus, HandCoins, Hourglass, Info, KeyRound, MessageCircle, Plane, Puzzle, Router, ScrollText, ShieldAlert, TrainFront } from "lucide-react";
import { Badge, Button, Card, EmptyState, FOCUS, PageTitle, SectionTitle, SkeletonCards } from "@/components/ui";
import { CatalogClient, type CatalogSource } from "@/lib/catalog-client";
import { ACTION_WORDS, type SkillManifest } from "@/lib/profiles";
import { ShowcaseCatalog } from "@/lib/showcase";
import { useCatalog } from "@/lib/use-showcase";
import { linkProps } from "@/router";
import type { PageProps } from "@/types/page";
import { DOCS, Figure, GITHUB, StatusBadge } from "../profiles/bits";
import { SAY, TAP, chatSay, shortSay } from "../story/demo";
import { loadError } from "@/components/mission/words";

/** Where a skill can be tried right now: a sentence in the chat, or its own page. */
export const TRY_SKILL: Record<string, { href: string; hint: string }> = {
  "clawback-uk-rail": { href: chatSay(SAY.lateTrain), hint: `Sends “${shortSay(SAY.lateTrain)}” in the chat.` },
  "clawback-ofcom": { href: chatSay(SAY.broadband), hint: `Sends “${SAY.broadband}” in the chat.` },
  "scam-shield": { href: chatSay(SAY.scam), hint: "Sends a fake HMRC refund text to the chat to check." },
  "entitlement-check": { href: chatSay(SAY.owed), hint: `Asks “${SAY.owed}” in the chat.` },
  "letter-explainer": { href: "#/read", hint: "Opens Read It To Me: press a sample photo." },
};

const CHANNEL_WORDS: Record<string, string> = { web: "web", sms: "text message", voice: "phone" };

const WAYS_IN = [
  { title: "One YAML rule pack", body: "A new operator, scheme or deadline for a skill that exists: one file in skills/<skill>/rules/, with a citation. No Python." },
  { title: "A skill folder", body: "A new kind of help with its own jobs: `make new-skill` writes skills/<id>/skill.yaml for you to fill in, plus an optional rules/ folder." },
  { title: "A mission in Python", body: "A multi-step workflow with its own tools, waits and consent points: copy clawback_ofcom under packages/tempo_missions/." },
];

const LINK = `inline-flex min-h-[44px] items-center gap-1 font-medium text-accent-300 underline decoration-accent-400/40 underline-offset-[3px] hover:text-accent-200 hover:decoration-accent-200 ${FOCUS}`;
const META_LINK = `inline-flex min-h-[32px] items-center gap-1 rounded-full font-mono text-[12px] text-accent-200 underline decoration-accent-400/30 underline-offset-[3px] hover:text-white hover:decoration-white ${FOCUS}`;

type Icon = ComponentType<{ size?: number; className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>;

/** A mark for each skill, so the grid reads at a glance. */
const SKILL_ICONS: Record<string, { icon: Icon; tile: string }> = {
  "clawback-uk-rail": { icon: TrainFront, tile: "from-accent-400/30 to-accent-700/10 text-accent-100 ring-accent-300/25" },
  "clawback-uk-flights": { icon: Plane, tile: "from-sky-400/25 to-sky-700/10 text-sky-100 ring-sky-300/25" },
  "clawback-ofcom": { icon: Router, tile: "from-accent-400/25 to-accent-700/10 text-accent-100 ring-accent-300/25" },
  "entitlement-check": { icon: HandCoins, tile: "from-emerald-400/25 to-emerald-700/10 text-emerald-100 ring-emerald-300/25" },
  "letter-explainer": { icon: ScrollText, tile: "from-second-400/25 to-second-700/10 text-second-100 ring-second-300/25" },
  "rights-decay": { icon: Hourglass, tile: "from-amber-400/25 to-amber-700/10 text-amber-100 ring-amber-300/25" },
  "scam-shield": { icon: ShieldAlert, tile: "from-rose-400/25 to-rose-700/10 text-rose-100 ring-rose-300/25" },
};
const FALLBACK = { icon: Puzzle, tile: "from-white/15 to-white/[0.03] text-slate-100 ring-white/15" };

const TRY_LINK = `inline-flex ${TAP} items-center gap-2 rounded-full bg-accent-500/[0.14] px-4 text-sm font-medium text-accent-50 ring-1 ring-inset ring-accent-400/30 transition-colors hover:bg-accent-500/25 hover:ring-accent-300/50 motion-reduce:transition-none ${FOCUS}`;

export default function SkillsPage({ showcase }: PageProps) {
  const injected = useMemo<CatalogSource>(() => (showcase ? new ShowcaseCatalog() : new CatalogClient()), [showcase]);
  const { source } = useCatalog(injected);
  const [skills, setSkills] = useState<SkillManifest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let live = true;
    setError(null);
    source
      .skills()
      .then((s) => live && setSkills(s))
      .catch((e) => live && setError(loadError(e)));
    return () => {
      live = false;
    };
  }, [source]);
  useEffect(load, [load]);

  const readyCount = skills?.filter((s) => s.status === "ready").length ?? 0;
  const demoCount = skills?.filter((s) => s.status === "demo-values").length ?? 0;

  return (
    <div className="space-y-8">
      <PageTitle lede="A skill is the unit a profile is made of: a folder with a manifest in plain words and, usually, a YAML rule pack that decides the amounts. A profile that turns a skill on must allow every capability the skill needs.">
        Skills
      </PageTitle>

      {skills && skills.length > 0 && (
        <Card className="grid grid-cols-3 gap-4 motion-safe:animate-fade-up sm:gap-6">
          <Figure label="Skills" value={String(skills.length)} icon={<Puzzle size={12} aria-hidden />} sub="in this catalogue" />
          <Figure label="Ready" value={String(readyCount)} tone="emerald" icon={<BadgeCheck size={12} aria-hidden />} sub="checked against the published terms" />
          <Figure label="Demo values" value={String(demoCount)} icon={<FlaskConical size={12} aria-hidden />} sub="labelled on every card" />
        </Card>
      )}

      {error && (
        <EmptyState title="Couldn't load the skills" tone="error" action={<Button variant="quiet" onClick={load} className={TAP}>Try again</Button>}>
          {error.replace(/\.?$/, ".")} Check the Gateway in Settings, or switch on the showcase there.
        </EmptyState>
      )}
      {!error && skills === null && <SkeletonCards count={4} label="Loading skills" />}
      {skills && skills.length === 0 && <EmptyState title="No skills yet">Add a folder under skills/ with a skill.yaml and it appears here.</EmptyState>}
      {skills && skills.length > 0 && (
        <ul className="stagger grid gap-4 lg:grid-cols-2">
          {skills.map((s) => {
            const tryIt = TRY_SKILL[s.id];
            const { icon: SkillIcon, tile } = SKILL_ICONS[s.id] ?? FALLBACK;
            const railTone = s.status === "ready" ? "bg-emerald-400/80" : s.status === "demo-values" ? "bg-amber-400/80" : "bg-slate-500";
            return (
              <Card key={s.id} as="li" id={s.id} interactive padding="none" className="relative flex scroll-mt-24 flex-col overflow-hidden">
                <span aria-hidden className={`absolute inset-y-6 left-0 w-[3px] rounded-r-full ${railTone}`} />
                <div className="flex flex-1 flex-col gap-4 p-5 lg:p-6">
                  <div className="flex items-start gap-4">
                    <span aria-hidden className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-b ring-1 ring-inset shadow-[0_12px_28px_-14px_rgb(0_0_0/0.9)] ${tile}`}>
                      <SkillIcon size={22} strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[17px] font-semibold leading-snug tracking-[-0.01em] text-white">{s.name}</h2>
                      <div className="mt-1.5">
                        <StatusBadge status={s.status} />
                      </div>
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-300">{s.summary}</p>
                  <div>
                    <SectionTitle as="h3" className="!mb-2">
                      What Tempo does when this skill is on
                    </SectionTitle>
                    <ul className="space-y-1.5 text-sm leading-snug text-slate-200">
                      {s.jobs.map((job) => (
                        <li key={job} className="flex items-start gap-2.5">
                          <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400 shadow-[0_0_0_3px_rgb(var(--accent-500)/0.18)]" />
                          {job}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <SectionTitle as="h3" className="!mb-2">
                      Needs your permission to
                    </SectionTitle>
                    {s.needs.length ? (
                      <ul aria-label={`Capabilities ${s.name} needs`} className="flex flex-wrap gap-1.5">
                        {s.needs.map((n) => (
                          <li key={n}>
                            <Badge tone="amber" className="py-1">
                              <KeyRound size={11} aria-hidden />
                              {ACTION_WORDS[n]}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="inline-flex items-center gap-2 rounded-full bg-emerald-500/[0.08] px-3 py-1 text-sm text-emerald-100 ring-1 ring-inset ring-emerald-400/20">
                        <Eye size={13} aria-hidden className="shrink-0 text-emerald-300" />
                        nothing binding: it only reads, explains and warns
                      </p>
                    )}
                  </div>
                  {s.notes && (
                    <p className="flex items-start gap-2.5 rounded-2xl border border-amber-400/25 bg-amber-500/[0.07] px-3.5 py-2.5 text-xs leading-relaxed text-amber-50">
                      <Info size={14} aria-hidden className="mt-px shrink-0 text-amber-300" />
                      <span>
                        <span className="font-semibold">Note:</span> {s.notes}
                      </span>
                    </p>
                  )}
                  <dl className="mt-auto grid gap-x-5 gap-y-3 rounded-2xl border border-white/[0.06] bg-black/20 p-3.5 text-sm sm:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Reaches you by</dt>
                      <dd className="mt-0.5 text-slate-200">{s.channels.map((c) => CHANNEL_WORDS[c] ?? c).join(", ")}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Version</dt>
                      <dd className="num mt-0.5 text-slate-200">
                        v{s.version} · maintained by {s.maintainers.join(", ")}
                      </dd>
                    </div>
                    {s.operators && s.operators.length > 0 && (
                      <div className="min-w-0 sm:col-span-2">
                        <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Companies it knows</dt>
                        <dd className="mt-0.5 text-slate-200">{s.operators.join(", ")}</dd>
                      </div>
                    )}
                    <div className="min-w-0 sm:col-span-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Where it lives</dt>
                      <dd className="flex flex-wrap gap-x-3">
                        <a href={`${GITHUB}/tree/main/skills/${s.id}`} rel="noopener noreferrer" className={META_LINK}>
                          skills/{s.id} <ExternalLink size={11} aria-hidden />
                        </a>
                        {s.docs && (
                          <a href={s.docs.startsWith("http") ? s.docs : `${GITHUB}/blob/main/${s.docs}`} rel="noopener noreferrer" className={META_LINK}>
                            docs <ExternalLink size={11} aria-hidden />
                          </a>
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
                {tryIt && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] bg-white/[0.015] px-5 py-3.5 lg:px-6">
                    <a {...linkProps(tryIt.href)} aria-describedby={`${s.id}-try-hint`} className={TRY_LINK}>
                      {tryIt.href.startsWith("#/chat") ? <MessageCircle size={14} aria-hidden /> : <ArrowRight size={14} aria-hidden />}
                      Try it<span className="sr-only">: {s.name}</span>
                    </a>
                    <p id={`${s.id}-try-hint`} className="min-w-0 flex-1 basis-48 text-xs leading-relaxed text-slate-400">
                      {tryIt.hint}
                    </p>
                  </div>
                )}
              </Card>
            );
          })}
        </ul>
      )}

      <Card as="section" aria-labelledby="add-heading" tone="indigo" className="relative overflow-hidden">
        <span aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent-500/15 blur-3xl" />
        <div className="relative">
          <SectionTitle id="add-heading" as="h2">
            <FolderPlus size={12} aria-hidden /> Add your own use case
          </SectionTitle>
          <p className="max-w-3xl text-[15px] leading-relaxed text-slate-200">
            Tempo prices nothing from a model: every amount comes from a rule pack with a citation. Most use cases are a YAML file, not Python. Three ways in,
            shortest first:
          </p>
          <ol className="mt-5 grid gap-3 md:grid-cols-3">
            {WAYS_IN.map((way, i) => (
              <li key={way.title} className="relative rounded-2xl border border-white/[0.08] bg-black/25 p-4">
                {i < WAYS_IN.length - 1 && <span aria-hidden className="absolute -right-3 top-8 hidden h-px w-3 bg-gradient-to-r from-accent-400/50 to-transparent md:block" />}
                <span aria-hidden className="num grid h-7 w-7 place-items-center rounded-full bg-gradient-to-b from-accent-500 to-accent-700 text-[12px] font-semibold text-white shadow-[0_6px_16px_-6px_rgb(var(--accent-600)/0.9)]">
                  {i + 1}
                </span>
                <p className="mt-3 text-[15px] font-semibold text-white">{way.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-300">{way.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <a href={DOCS.addUseCase} rel="noopener noreferrer" className={LINK}>
              <BookOpen size={14} aria-hidden /> docs/add-a-usecase.md on GitHub <ExternalLink size={12} aria-hidden />
            </a>
            <a href={`${GITHUB}/tree/main/skills`} rel="noopener noreferrer" className={LINK}>
              <Puzzle size={14} aria-hidden /> the skills folder <ExternalLink size={12} aria-hidden />
            </a>
          </p>
        </div>
      </Card>
      {showcase && skills && (
        <p className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-400/20 bg-amber-500/[0.06] px-4 py-2.5 text-sm text-amber-100">
          <Badge tone="amber" dot>
            showcase
          </Badge>
          Showcase: read from the committed catalogue (skills/*/skill.yaml), not from a Gateway.
        </p>
      )}
    </div>
  );
}
