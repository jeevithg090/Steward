// Skills (plan.md §2): the manifests in plain words: jobs, capabilities needed, status, operators,
// and how to add one. Ported from the old SkillsPage; dark theme.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpen, ExternalLink, FolderPlus, MessageCircle, Puzzle } from "lucide-react";
import { Badge, Button, Card, EmptyState, FOCUS, PageTitle, SectionTitle, SkeletonCards } from "@/components/ui";
import { CatalogClient, type CatalogSource } from "@/lib/catalog-client";
import { ACTION_WORDS, type SkillManifest } from "@/lib/profiles";
import { ShowcaseCatalog } from "@/lib/showcase";
import { useCatalog } from "@/lib/use-showcase";
import { linkProps } from "@/router";
import type { PageProps } from "@/types/page";
import { DOCS, GITHUB, StatusBadge } from "../profiles/bits";
import { SAY, TAP, chatSay, shortSay } from "../story/demo";

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

const LINK = `inline-flex min-h-[44px] items-center gap-1 text-indigo-300 underline ${FOCUS}`;

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
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [source]);
  useEffect(load, [load]);

  return (
    <div className="space-y-5">
      <PageTitle lede="A skill is the unit a profile is made of: a folder with a manifest in plain words and, usually, a YAML rule pack that decides the amounts. A profile that turns a skill on must allow every capability the skill needs.">
        Skills
      </PageTitle>

      {error && (
        <EmptyState title="Couldn't load the skills" tone="error" action={<Button variant="quiet" onClick={load} className={TAP}>Try again</Button>}>
          {error.replace(/\.?$/, ".")} Check the Gateway in Settings, or switch on the showcase there.
        </EmptyState>
      )}
      {!error && skills === null && <SkeletonCards count={4} label="Loading skills" />}
      {skills && skills.length === 0 && <EmptyState title="No skills yet">Add a folder under skills/ with a skill.yaml and it appears here.</EmptyState>}
      {skills && skills.length > 0 && (
        <ul className="grid gap-4 md:grid-cols-2">
          {skills.map((s) => {
            const tryIt = TRY_SKILL[s.id];
            return (
            <Card key={s.id} as="li" id={s.id} className="flex flex-col gap-3 scroll-mt-24">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-lg font-semibold text-slate-100">{s.name}</h2>
                <StatusBadge status={s.status} />
              </div>
              <p className="text-sm text-slate-300">{s.summary}</p>
              <div>
                <SectionTitle as="h3">What Tempo does when this skill is on</SectionTitle>
                <ul className="space-y-1 text-sm text-slate-200">
                  {s.jobs.map((job) => (
                    <li key={job} className="flex items-start gap-2">
                      <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                      {job}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <SectionTitle as="h3">Needs your permission to</SectionTitle>
                {s.needs.length ? (
                  <ul aria-label={`Capabilities ${s.name} needs`} className="flex flex-wrap gap-1.5">
                    {s.needs.map((n) => (
                      <li key={n}>
                        <Badge tone="amber">{ACTION_WORDS[n]}</Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-300">nothing binding: it only reads, explains and warns</p>
                )}
              </div>
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-400">Reaches you by</dt>
                  <dd className="text-slate-200">{s.channels.map((c) => CHANNEL_WORDS[c] ?? c).join(", ")}</dd>
                </div>
                {s.operators && s.operators.length > 0 && (
                  <div>
                    <dt className="text-xs text-slate-400">Companies it knows</dt>
                    <dd className="text-slate-200">{s.operators.join(", ")}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-slate-400">Version</dt>
                  <dd className="text-slate-200">
                    v{s.version} · maintained by {s.maintainers.join(", ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Where it lives</dt>
                  <dd className="flex flex-wrap gap-x-3 text-slate-200">
                    <a href={`${GITHUB}/tree/main/skills/${s.id}`} rel="noopener noreferrer" className={LINK}>
                      skills/{s.id} <ExternalLink size={12} aria-hidden />
                    </a>
                    {s.docs && (
                      <a href={s.docs.startsWith("http") ? s.docs : `${GITHUB}/blob/main/${s.docs}`} rel="noopener noreferrer" className={LINK}>
                        docs <ExternalLink size={12} aria-hidden />
                      </a>
                    )}
                  </dd>
                </div>
              </dl>
              {s.notes && (
                <p className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
                  <span className="font-semibold">Note:</span> {s.notes}
                </p>
              )}
              {tryIt && (
                <div className="mt-auto space-y-1.5 border-t border-white/10 pt-3">
                  <a
                    {...linkProps(tryIt.href)}
                    aria-describedby={`${s.id}-try-hint`}
                    className={`inline-flex ${TAP} items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 ${FOCUS}`}
                  >
                    {tryIt.href.startsWith("#/chat") ? <MessageCircle size={14} aria-hidden /> : <ArrowRight size={14} aria-hidden />}
                    Try it<span className="sr-only">: {s.name}</span>
                  </a>
                  <p id={`${s.id}-try-hint`} className="text-xs text-slate-400">
                    {tryIt.hint}
                  </p>
                </div>
              )}
            </Card>
            );
          })}
        </ul>
      )}

      <Card as="section" aria-labelledby="add-heading" tone="indigo">
        <SectionTitle id="add-heading" as="h2">
          <span className="inline-flex items-center gap-1.5">
            <FolderPlus size={12} aria-hidden /> Add your own use case
          </span>
        </SectionTitle>
        <p className="text-sm text-slate-200">
          Tempo prices nothing from a model: every amount comes from a rule pack with a citation. Most use cases are a YAML file, not Python. Three ways in,
          shortest first:
        </p>
        <ol className="mt-3 grid gap-3 sm:grid-cols-3">
          {WAYS_IN.map((way, i) => (
            <li key={way.title} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-sm font-semibold text-slate-100">
                <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[11px] text-white" aria-hidden>
                  {i + 1}
                </span>
                {way.title}
              </p>
              <p className="mt-1 text-xs text-slate-300">{way.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <a href={DOCS.addUseCase} rel="noopener noreferrer" className={LINK}>
            <BookOpen size={14} aria-hidden /> docs/add-a-usecase.md on GitHub <ExternalLink size={12} aria-hidden />
          </a>
          <a href={`${GITHUB}/tree/main/skills`} rel="noopener noreferrer" className={LINK}>
            <Puzzle size={14} aria-hidden /> the skills folder <ExternalLink size={12} aria-hidden />
          </a>
        </p>
      </Card>
      {showcase && skills && <p className="text-xs text-slate-400">Showcase: read from the committed catalogue (skills/*/skill.yaml), not from a Gateway.</p>}
    </div>
  );
}
