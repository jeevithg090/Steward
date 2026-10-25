"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CatalogSource } from "@/lib/catalog-client";
import { ACTION_WORDS, type ProfileView, encodeShareCode, profileToYaml, toProfile } from "@/lib/profiles";
import { useCatalog } from "@/lib/use-showcase";
import { AccessChips, MayNever, WillDo, capital, limitsInWords } from "./ProfileBits";
import { Card, Chip, ErrorNote, Note, STATUS_WORDS, buttonClass } from "./ui";

/** One profile in full, with sharing: a link that carries the whole profile, or the YAML file. */
export function ProfileDetail({ id, source: injected }: { id: string; source?: CatalogSource }) {
  const { source, showcase } = useCatalog(injected);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    source.profile(id).then((p) => live && setProfile(p)).catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [source, id]);

  useEffect(() => {
    if (!profile) return;
    try {
      setLink(`${window.location.origin}/profiles/import#p=${encodeShareCode(toProfile(profile))}`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  }, [profile]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setNote("Link copied. The whole profile is in the link itself; nothing was stored anywhere.");
    } catch {
      setNote("Couldn't copy on this browser. Select the link below and copy it yourself.");
    }
  };

  const download = () => {
    if (!profile) return;
    const blob = new Blob([profileToYaml(profile)], { type: "application/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${profile.id}.yaml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote(`Downloaded ${profile.id}.yaml. Put it in profiles/ and open a pull request to share it with everyone.`);
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <p className="mb-4">
        <Link href={showcase.href("/profiles")} className="inline-flex min-h-11 items-center underline">← All profiles</Link>
      </p>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!error && !profile && <p role="status">Loading the profile…</p>}
      {profile && (
        <>
          <h1 className="text-4xl font-bold text-slate-900">{profile.name}</h1>
          <p className="mt-2"><Chip>{STATUS_WORDS[profile.status]}</Chip> <span className="ml-2 text-sm text-slate-700">v{profile.version} · by {profile.share.author}</span></p>
          <p className="mt-4 text-xl text-slate-800">{profile.summary}</p>
          <p className="mt-2 text-lg text-slate-800"><span className="font-semibold">Who it is for:</span> {profile.for_whom}</p>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <Card><WillDo jobs={profile.jobs} id="detail-jobs" level={2} /></Card>
            <Card className="border-rose-200"><MayNever actions={profile.may_not} id="detail-may-not" level={2} /></Card>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <Card>
              <h2 className="text-lg font-semibold">What it may do, once you say yes</h2>
              {profile.may.length === 0 ? (
                <p className="mt-1 text-slate-800">Nothing binding at all. This profile only looks, explains and warns.</p>
              ) : (
                <ul className="mt-1 list-disc space-y-1 pl-6 text-slate-800">{profile.may.map((a) => <li key={a}>{capital(ACTION_WORDS[a])}</li>)}</ul>
              )}
            </Card>
            <Card>
              <h2 className="text-lg font-semibold">Its limits</h2>
              <ul className="mt-1 list-disc space-y-1 pl-6 text-slate-800">{limitsInWords(profile.limits).map((l) => <li key={l}>{l}</li>)}</ul>
            </Card>
          </div>

          <Card className="mt-6">
            <h2 className="text-lg font-semibold">How Tempo speaks with you</h2>
            <div className="mt-2"><AccessChips access={profile.access} /></div>
            <p className="mt-2 text-slate-800">
              Reaches you by {profile.channels.map((c) => ({ web: "the web", sms: "text message", voice: "phone" })[c]).join(", ")}. Your time is valued at
              £{profile.time_value_gbp_h} an hour when Tempo weighs whether a claim is worth it.
            </p>
          </Card>

          <Card className="mt-6">
            <h2 className="text-lg font-semibold">The skills it turns on</h2>
            <ul className="mt-2 space-y-2">
              {profile.skills.map((s) => (
                <li key={s.id}>
                  <Link href={showcase.href(`/skills#${s.id}`)} className="font-medium text-teal-900 underline">{s.name}</Link>
                  <span className="ml-2 text-sm text-slate-700">({STATUS_WORDS[s.status]})</span>
                </li>
              ))}
            </ul>
          </Card>

          <section aria-labelledby="share-heading" className="mt-8 rounded-xl border-2 border-teal-800 bg-teal-50 p-5">
            <h2 id="share-heading" className="text-2xl font-bold text-teal-900">Share this profile</h2>
            <p className="mt-2 text-slate-800">
              The link carries the whole profile in its fragment, so it never reaches a server log. Whoever opens it sees exactly this page
              and nothing is stored until they choose to use it.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={copy} disabled={!link} className={buttonClass("primary")}>Copy link</button>
              <button type="button" onClick={download} className={buttonClass("secondary")}>Download YAML</button>
              {link && <Link href={link.slice(window.location.origin.length)} className={buttonClass("quiet")}>Open the share link</Link>}
            </div>
            <label htmlFor="share-link" className="mt-4 block text-sm font-medium text-slate-700">The link</label>
            <textarea id="share-link" readOnly value={link ?? ""} rows={3} className="mt-1 w-full rounded-lg border-2 border-slate-400 p-2 font-mono text-xs" />
            {note && <p role="status" className="mt-2 text-slate-900">{note}</p>}
          </section>

          {showcase.active && (
            <div className="mt-6"><Note>Showcase: this profile comes from the committed catalogue (profiles/{profile.id}.yaml), not from a Gateway.</Note></div>
          )}
        </>
      )}
    </div>
  );
}
