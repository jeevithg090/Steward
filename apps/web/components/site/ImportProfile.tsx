"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { type CatalogSource, GatewayError } from "@/lib/catalog-client";
import { ProfileInvalid, type ProfileView, codeFromHash, decodeShareCode } from "@/lib/profiles";
import { useCatalog } from "@/lib/use-showcase";
import { AccessChips, MayNever, WillDo, limitsInWords } from "./ProfileBits";
import { Card, Chip, ErrorNote, Note, PageIntro, STATUS_WORDS, buttonClass } from "./ui";

type Checked = "gateway" | "browser";

/** Opens `/profiles/import#p=<code>`: validates with the Gateway when there is one, else in the browser. Stores nothing. */
export function ImportProfile({ source: injected, hash }: { source?: CatalogSource; hash?: string }) {
  const { source, showcase } = useCatalog(injected);
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<{ profile: ProfileView; checked: Checked } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(
    async (candidate: string) => {
      const trimmed = candidate.trim();
      const fromLink = codeFromHash(trimmed.slice(trimmed.indexOf("#")));
      const value = trimmed.includes("#p=") && fromLink ? fromLink : trimmed;
      setResult(null);
      setError(null);
      if (!value) return;
      setBusy(true);
      try {
        if (source.showcase) {
          setResult({ profile: await source.importProfile(value), checked: "browser" });
        } else {
          try {
            setResult({ profile: await source.importProfile(value), checked: "gateway" });
          } catch (e) {
            if (e instanceof GatewayError && (e.status === 413 || e.status === 422)) throw e;
            // The Gateway is not answering: show what the code says, labelled as unchecked.
            const profile = decodeShareCode(value);
            setResult({ profile: { ...profile, skills: profile.skills.map((id) => ({ id, name: id, status: "experimental", jobs: [] })), jobs: [] }, checked: "browser" });
          }
        }
      } catch (e) {
        setError(e instanceof ProfileInvalid || e instanceof GatewayError ? e.message : `Couldn't check this code: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [source],
  );

  useEffect(() => {
    const found = codeFromHash(hash ?? window.location.hash);
    if (found) {
      setCode(found);
      void check(found);
    }
  }, [hash, check]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <PageIntro title="Import a profile">
        <p>
          Somebody sent you a Tempo profile. The link holds the whole profile; this page only reads it and shows it. Nothing is saved, on this
          computer or anywhere else, unless you download the file yourself.
        </p>
      </PageIntro>

      {!code && (
        <form
          className="mb-8"
          onSubmit={(e) => {
            e.preventDefault();
            setCode(typed);
            void check(typed);
          }}
        >
          <label htmlFor="share-code" className="block text-lg font-medium">Paste a share link or code</label>
          <textarea id="share-code" value={typed} onChange={(e) => setTyped(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border-2 border-slate-400 p-2 font-mono text-sm" placeholder="tp1.…" />
          <button type="submit" disabled={!typed.trim() || busy} className={`mt-3 ${buttonClass("primary")}`}>Check it</button>
        </form>
      )}

      {busy && <p role="status">Checking the code…</p>}
      {error && (
        <div className="space-y-3">
          <ErrorNote>This code can&apos;t be trusted: {error}</ErrorNote>
          <button type="button" onClick={() => { setCode(""); setTyped(""); setError(null); }} className={buttonClass("quiet")}>Try another code</button>
        </div>
      )}

      {result && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {result.checked === "gateway" ? (
              <Chip tone="teal">Checked by the Gateway</Chip>
            ) : (
              <Chip tone="amber">Not yet checked by a Gateway</Chip>
            )}
            <Chip>{STATUS_WORDS[result.profile.status]}</Chip>
          </div>
          {result.checked === "browser" && (
            <div className="mb-6">
              <Note>
                {showcase.active
                  ? "The showcase decoded this in your browser and checked its shape and its skills against the committed catalogue. A Gateway re-checks everything before a profile is ever used."
                  : "No Gateway answered, so this was decoded in your browser. Its shape is right, but whether every skill exists and allows what it needs has not been checked."}
              </Note>
            </div>
          )}
          <h2 className="text-3xl font-bold">{result.profile.name}</h2>
          <p className="mt-2 text-lg text-slate-800">{result.profile.summary}</p>
          <p className="mt-1 text-slate-800"><span className="font-semibold">For:</span> {result.profile.for_whom}</p>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <Card>
              {result.profile.jobs.length > 0 ? (
                <WillDo jobs={result.profile.jobs} id="import-jobs" />
              ) : (
                <>
                  <h3 className="text-lg font-semibold text-teal-900">The skills it turns on</h3>
                  <ul className="mt-1 list-disc pl-6">{result.profile.skills.map((s) => <li key={s.id}>{s.name}</li>)}</ul>
                </>
              )}
            </Card>
            <Card className="border-rose-200"><MayNever actions={result.profile.may_not} id="import-may-not" /></Card>
          </div>
          <Card className="mt-6">
            <h3 className="text-lg font-semibold">Its limits and how it speaks</h3>
            <ul className="mt-1 list-disc space-y-1 pl-6 text-slate-800">{limitsInWords(result.profile.limits).map((l) => <li key={l}>{l}</li>)}</ul>
            <div className="mt-3"><AccessChips access={result.profile.access} /></div>
          </Card>
          <p className="mt-6 text-slate-800">
            To use it, put the YAML in <code>profiles/</code> of your own Tempo and open a pull request, or compare it with the{" "}
            <Link href={showcase.href("/profiles")} className="underline">starter profiles</Link>. This page has stored nothing.
          </p>
        </>
      )}
    </div>
  );
}
