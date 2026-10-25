"use client";

import { useEffect, useState } from "react";
import type { CatalogSource } from "@/lib/catalog-client";
import { ACTION_WORDS, type SkillManifest } from "@/lib/profiles";
import { useCatalog } from "@/lib/use-showcase";
import { Card, Chip, ErrorNote, PageIntro, STATUS_WORDS, DOCS, GITHUB } from "./ui";

const CHANNEL_WORDS = { web: "web", sms: "text message", voice: "phone" };

/** The skills catalogue from the manifests: what each one does in plain words, and what it needs permission for. */
export function SkillsPage({ source: injected }: { source?: CatalogSource }) {
  const { source, showcase } = useCatalog(injected);
  const [skills, setSkills] = useState<SkillManifest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    source.skills().then((s) => live && setSkills(s)).catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [source]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <PageIntro title="Skills">
        <p>
          A skill is the unit a profile is made of: a folder with a manifest in plain words and, usually, a YAML rule pack that decides the
          amounts. A profile that turns a skill on must allow every capability the skill needs.{" "}
          <a href={DOCS.addUseCase} rel="noopener noreferrer" className="underline">Add your own in ten minutes</a>, without writing Python.
        </p>
      </PageIntro>

      {error && <ErrorNote>Couldn&apos;t load the skills: {error}</ErrorNote>}
      {!error && skills === null && <p role="status">Loading skills…</p>}
      {skills && (
        <ul className="space-y-5">
          {skills.map((s) => (
            <li key={s.id}>
              <Card id={s.id} className="scroll-mt-24">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-2xl font-bold text-slate-900">{s.name}</h2>
                  <Chip tone={s.status === "ready" ? "teal" : "amber"}>{STATUS_WORDS[s.status]}</Chip>
                </div>
                <p className="mt-2 text-lg text-slate-800">{s.summary}</p>
                <h3 className="mt-4 font-semibold text-teal-900">What Tempo does when this skill is on</h3>
                <ul className="mt-1 list-disc space-y-1 pl-6 text-slate-800">{s.jobs.map((job) => <li key={job}>{job}</li>)}</ul>
                <dl className="mt-4 grid gap-x-6 gap-y-2 text-slate-800 sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold">Needs your permission to</dt>
                    <dd>{s.needs.length ? s.needs.map((n) => ACTION_WORDS[n]).join("; ") : "nothing binding: it only reads, explains and warns"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Reaches you by</dt>
                    <dd>{s.channels.map((c) => CHANNEL_WORDS[c]).join(", ")}</dd>
                  </div>
                  {s.operators && s.operators.length > 0 && (
                    <div>
                      <dt className="font-semibold">Companies it knows</dt>
                      <dd>{s.operators.join(", ")}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="font-semibold">Where it lives</dt>
                    <dd>
                      <a href={`${GITHUB}/tree/main/skills/${s.id}`} rel="noopener noreferrer" className="underline">skills/{s.id}</a>
                      {s.docs && (
                        <>
                          {" · "}
                          <a href={s.docs.startsWith("http") ? s.docs : `${GITHUB}/blob/main/${s.docs}`} rel="noopener noreferrer" className="underline">docs</a>
                        </>
                      )}
                    </dd>
                  </div>
                </dl>
                {s.notes && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-amber-950">Note: {s.notes}</p>}
                <p className="mt-3 text-sm text-slate-700">v{s.version} · maintained by {s.maintainers.join(", ")}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {showcase.active && skills && (
        <p className="mt-6 text-sm text-slate-700">Showcase: read from the committed catalogue (skills/*/skill.yaml), not from a Gateway.</p>
      )}
    </div>
  );
}
