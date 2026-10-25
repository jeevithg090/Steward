"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CatalogSource } from "@/lib/catalog-client";
import type { ProfileView } from "@/lib/profiles";
import { useCatalog } from "@/lib/use-showcase";
import { AccessChips, MayNever, WillDo } from "./ProfileBits";
import { Card, Chip, ErrorNote, PageIntro, STATUS_WORDS } from "./ui";

/** The profile catalogue: who each one is for, what it will do, what it may never do. */
export function ProfilesPage({ source: injected }: { source?: CatalogSource }) {
  const { source, showcase } = useCatalog(injected);
  const [profiles, setProfiles] = useState<ProfileView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    source.profiles().then((p) => live && setProfiles(p)).catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [source]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <PageIntro title="Profiles">
        <p>
          A profile says who Tempo works for, which skills are on, how it must speak with you, and what it may never do. It is enforced by the
          Harness, not just displayed: a profile that rules something out makes Tempo refuse it.
        </p>
        <p className="mt-2">
          Share one as a link or a file; <Link href={showcase.href("/profiles/import")} className="underline">import one</Link> somebody sent you.
        </p>
      </PageIntro>

      {error && <ErrorNote>Couldn&apos;t load the profiles: {error}</ErrorNote>}
      {!error && profiles === null && <p role="status">Loading profiles…</p>}
      {profiles && (
        <ul className="grid gap-5 md:grid-cols-2">
          {profiles.map((p) => (
            <li key={p.id}>
              <Card className="flex h-full flex-col gap-4">
                <div>
                  <h2 className="text-2xl font-bold">
                    <Link href={showcase.href(`/profiles/${p.id}`)} className="text-teal-900 underline decoration-2 underline-offset-4">{p.name}</Link>
                  </h2>
                  <p className="mt-1 text-slate-800"><span className="font-semibold">For:</span> {p.for_whom}</p>
                </div>
                <WillDo jobs={p.jobs} id={`${p.id}-jobs`} limit={4} />
                <MayNever actions={p.may_not} id={`${p.id}-may-not`} />
                <AccessChips access={p.access} />
                <p className="mt-auto text-sm text-slate-700">
                  <Chip>{STATUS_WORDS[p.status]}</Chip> <span className="ml-2">{p.skills.length} skills · v{p.version}</span>
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
