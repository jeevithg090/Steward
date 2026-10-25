// Profiles (plan.md §2): who Tempo works for. The catalogue (#/profiles), one profile in full with
// sharing (#/profiles/:id) and the import page (#/profiles/import?p=<code>) with plain-word
// refusals. Ported from the old ProfilesPage, ProfileDetail and ImportProfile; dark theme.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, Download, FileDown, Link2, ShieldCheck, Upload, UserCheck, UserMinus } from "lucide-react";
import { Badge, Button, Card, EmptyState, FOCUS, PageTitle, SectionTitle, Spinner } from "@/components/ui";
import { CatalogClient, type CatalogSource, GatewayError } from "@/lib/catalog-client";
import { ACTION_WORDS, type Profile, ProfileInvalid, type ProfileView, type SkillManifest, codeFromHash, decodeShareCode, encodeShareCode, profileToYaml, toProfile, toView } from "@/lib/profiles";
import { ShowcaseCatalog } from "@/lib/showcase";
import { useCatalog } from "@/lib/use-showcase";
import { linkProps, navigate, useRoute } from "@/router";
import type { PageProps } from "@/types/page";
import { AccessChips, CHANNEL_WORDS, DOCS, MayNever, StatusBadge, WillDo, accessInWords, capital, limitsInWords } from "./bits";

const TEXTAREA = `w-full rounded-xl border border-white/15 bg-black/30 p-3 font-mono text-xs text-slate-100 placeholder:text-slate-500 ${FOCUS}`;

/** The import URL for a profile: the whole profile travels in the fragment's query, never to a server log. */
export function importUrl(profile: Profile): string {
  const base = typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`;
  return `${base}#/profiles/import?p=${encodeShareCode(profile)}`;
}

/** A share code from a pasted link (`?p=` or `#p=`) or a bare code. */
export function codeFrom(text: string): string {
  const trimmed = text.trim();
  const query = /[?&]p=([^&#\s]+)/.exec(trimmed);
  if (query) return decodeURIComponent(query[1]!);
  const hash = trimmed.indexOf("#p=");
  if (hash >= 0) return codeFromHash(trimmed.slice(hash)) ?? trimmed;
  return trimmed;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function ProfilesPage(props: PageProps) {
  const { showcase, params } = props;
  const route = useRoute();
  const injected = useMemo<CatalogSource>(() => (showcase ? new ShowcaseCatalog() : new CatalogClient()), [showcase]);
  const { source } = useCatalog(injected);

  if (route.path === "/profiles/import") return <ImportProfile {...props} source={source} code={route.query.get("p")} />;
  if (params.id) return <ProfileDetail {...props} source={source} id={params.id} />;
  return <ProfileList {...props} source={source} />;
}

// --- the catalogue ----------------------------------------------------------------------------

function ProfileList({ source, user, setProfile, showcase }: PageProps & { source: CatalogSource }) {
  const [profiles, setProfiles] = useState<ProfileView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    source
      .profiles()
      .then((p) => live && setProfiles(p))
      .catch((e) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, [source]);

  const inUse = profiles?.find((p) => p.id === user.profileId);

  return (
    <div className="space-y-5">
      <PageTitle
        lede="A profile says who Tempo works for, which skills are on, how it must speak with you, and what it may never do. It is enforced, not just displayed: a profile that rules something out makes Tempo refuse it."
        right={
          <a {...linkProps("/profiles/import")} className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-slate-200 hover:bg-white/10 ${FOCUS}`}>
            <Upload size={14} aria-hidden /> Import a code
          </a>
        }
      >
        Profiles
      </PageTitle>

      <div aria-live="polite" className="text-sm">
        {inUse ? (
          <Card tone="emerald" padding="tight" className="flex flex-wrap items-center justify-between gap-3">
            <p>
              <UserCheck size={14} className="mr-1.5 inline text-emerald-300" aria-hidden />
              Tempo is working for you as <strong className="text-slate-100">{inUse.name}</strong>. The chat sends this profile with every mission.
            </p>
            <Button variant="quiet" size="sm" onClick={() => setProfile(null)} icon={<UserMinus size={14} aria-hidden />}>
              Stop using
            </Button>
          </Card>
        ) : (
          profiles && <p className="text-slate-400">No profile picked: Tempo asks before anything binding, and uses its usual patient voice.</p>
        )}
      </div>

      {error && <EmptyState title="Couldn't load the profiles" tone="error">{error}</EmptyState>}
      {!error && profiles === null && <Spinner label="Loading profiles" />}
      {profiles && profiles.length === 0 && <EmptyState title="No profiles yet">Add one YAML file to profiles/ and it appears here.</EmptyState>}
      {profiles && profiles.length > 0 && (
        <ul className="grid gap-4 md:grid-cols-2">
          {profiles.map((p) => {
            const active = user.profileId === p.id;
            return (
              <Card key={p.id} as="li" className={`flex flex-col gap-3 ${active ? "border-emerald-500/40" : ""}`}>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-slate-100">
                      <a {...linkProps(`/profiles/${p.id}`)} className={`text-indigo-300 underline decoration-indigo-300/40 underline-offset-2 hover:decoration-indigo-300 ${FOCUS}`}>
                        {p.name}
                      </a>
                    </h2>
                    {active && <Badge tone="emerald">In use</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-slate-300">
                    <span className="text-slate-400">For:</span> {p.for_whom}
                  </p>
                </div>
                <WillDo jobs={p.jobs} id={`${p.id}-jobs`} limit={3} />
                <MayNever actions={p.may_not} id={`${p.id}-may-not`} />
                <div>
                  <SectionTitle as="p">Skills on</SectionTitle>
                  <ul aria-label={`Skills on for ${p.name}`} className="flex flex-wrap gap-1.5">
                    {p.skills.map((s) => (
                      <li key={s.id}>
                        <Badge tone={s.status === "ready" ? "emerald" : s.status === "demo-values" ? "amber" : "slate"}>{s.name}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
                <AccessChips access={p.access} />
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <StatusBadge status={p.status} />
                    <span>v{p.version}</span>
                  </div>
                  {active ? (
                    <Button variant="quiet" size="sm" onClick={() => setProfile(null)} icon={<UserMinus size={14} aria-hidden />}>
                      Stop using
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setProfile(p.id)} icon={<UserCheck size={14} aria-hidden />}>
                      Use this profile
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </ul>
      )}
      {showcase && profiles && <p className="text-xs text-slate-500">Showcase: read from the committed catalogue (profiles/*.yaml), not from a Gateway.</p>}
    </div>
  );
}

// --- one profile, with sharing ----------------------------------------------------------------

function ProfileDetail({ source, id, user, setProfile, showcase }: PageProps & { source: CatalogSource; id: string }) {
  const [profile, setProfileView] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setProfileView(null);
    setError(null);
    source
      .profile(id)
      .then((p) => live && setProfileView(p))
      .catch((e) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, [source, id]);

  useEffect(() => {
    if (!profile) return;
    try {
      setLink(importUrl(toProfile(profile)));
    } catch (e) {
      setNote(message(e));
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

  const active = profile !== null && user.profileId === profile.id;

  return (
    <div className="space-y-5">
      <p>
        <a {...linkProps("/profiles")} className={`inline-flex items-center gap-1 text-sm text-indigo-300 underline ${FOCUS}`}>
          <ArrowLeft size={14} aria-hidden /> All profiles
        </a>
      </p>
      {error && <EmptyState title="There's no such profile" tone="error">{error}</EmptyState>}
      {!error && !profile && (
        <>
          <PageTitle>Profiles</PageTitle>
          <Spinner label="Loading the profile" />
        </>
      )}
      {profile && (
        <>
          <PageTitle
            lede={profile.summary}
            right={
              active ? (
                <div className="flex items-center gap-2">
                  <Badge tone="emerald">In use</Badge>
                  <Button variant="quiet" size="sm" onClick={() => setProfile(null)} icon={<UserMinus size={14} aria-hidden />}>
                    Stop using
                  </Button>
                </div>
              ) : (
                <Button onClick={() => setProfile(profile.id)} icon={<UserCheck size={14} aria-hidden />}>
                  Use this profile
                </Button>
              )
            }
          >
            Profiles
          </PageTitle>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-100">{profile.name}</h2>
            <StatusBadge status={profile.status} />
            <span className="text-xs text-slate-400">v{profile.version} · by {profile.share.author}</span>
          </div>
          <p className="text-sm text-slate-200">
            <span className="text-slate-400">Who it is for:</span> {profile.for_whom}
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <WillDo jobs={profile.jobs} id="detail-jobs" as="h3" />
            </Card>
            <Card tone="rose">
              <MayNever actions={profile.may_not} id="detail-may-not" as="h3" />
            </Card>
            <Card tone="emerald">
              <SectionTitle as="h3">What it may do, once you say yes</SectionTitle>
              {profile.may.length === 0 ? (
                <p className="text-sm text-slate-300">Nothing binding at all. This profile only looks, explains and warns.</p>
              ) : (
                <ul className="space-y-1 text-sm text-slate-200">
                  {profile.may.map((a) => (
                    <li key={a} className="flex items-start gap-2">
                      <Check size={14} className="mt-0.5 shrink-0 text-emerald-300" aria-hidden />
                      {capital(ACTION_WORDS[a])}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <SectionTitle as="h3">Its limits</SectionTitle>
              <ul className="space-y-1 text-sm text-slate-200">
                {limitsInWords(profile.limits).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Card>
          </div>

          <Card>
            <SectionTitle as="h3">How Tempo speaks with you</SectionTitle>
            <AccessChips access={profile.access} />
            <p className="mt-2 text-sm text-slate-200">{accessInWords(profile.access)}</p>
            <p className="mt-2 text-sm text-slate-300">
              Reaches you by {profile.channels.map((c) => CHANNEL_WORDS[c] ?? c).join(", ")}. Your time is valued at £{profile.time_value_gbp_h} an hour when Tempo weighs
              whether a claim is worth it.
            </p>
          </Card>

          <Card>
            <SectionTitle as="h3">The skills it turns on</SectionTitle>
            <ul className="space-y-2">
              {profile.skills.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <a {...linkProps("/skills")} className={`font-medium text-indigo-300 underline ${FOCUS}`}>
                    {s.name}
                  </a>
                  <StatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          </Card>

          <Card as="section" aria-labelledby="share-heading" tone="indigo">
            <SectionTitle id="share-heading" as="h3">
              <span className="inline-flex items-center gap-1.5">
                <Link2 size={12} aria-hidden /> Share this profile
              </span>
            </SectionTitle>
            <p className="text-sm text-slate-200">
              The link carries the whole profile after the <code className="text-indigo-200">#</code>, so it never reaches a server log. Whoever opens it sees exactly this page
              and nothing is stored until they choose to use it.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => void copy()} disabled={!link} icon={<Copy size={14} aria-hidden />}>
                Copy link
              </Button>
              <Button variant="quiet" onClick={download} icon={<FileDown size={14} aria-hidden />}>
                Download YAML
              </Button>
              {link && (
                <a {...linkProps(link.slice(link.indexOf("#")))} className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-slate-200 hover:bg-white/10 ${FOCUS}`}>
                  <Upload size={14} aria-hidden /> Open the import page
                </a>
              )}
            </div>
            <label htmlFor="share-link" className="mt-3 block text-xs font-medium text-slate-400">
              The link
            </label>
            <textarea id="share-link" readOnly value={link ?? ""} rows={3} className={`mt-1 ${TEXTAREA}`} />
            <p role="status" className="mt-2 min-h-[1rem] text-xs text-slate-300">
              {note}
            </p>
          </Card>

          {showcase && <p className="text-xs text-slate-500">Showcase: this profile comes from the committed catalogue (profiles/{profile.id}.yaml), not from a Gateway.</p>}
        </>
      )}
    </div>
  );
}

// --- import a code ----------------------------------------------------------------------------

type Checked = "gateway" | "browser";

interface ImportResult {
  profile: ProfileView;
  checked: Checked;
  /** When the Gateway was asked and could not answer (not a refusal). */
  gatewayNote: string | null;
}

function ImportProfile({ source, code, user, setProfile, showcase }: PageProps & { source: CatalogSource; code: string | null }) {
  const [typed, setTyped] = useState("");
  const [manifests, setManifests] = useState<SkillManifest[] | null>(null);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    source
      .skills()
      .then((s) => live && setManifests(s))
      .catch(() => live && setManifests([]));
    source
      .profiles()
      .then((p) => live && setKnown(new Set(p.map((x) => x.id))))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [source]);

  const check = useCallback(
    async (candidate: string) => {
      const value = codeFrom(candidate);
      setResult(null);
      setRefusal(null);
      setNote(null);
      if (!value) return;
      setBusy(true);
      try {
        // First the browser: every rule the Gateway applies, with a plain reason.
        const decoded = decodeShareCode(value, manifests && manifests.length ? manifests : null);
        if (source.showcase) {
          setResult({ profile: await source.importProfile(value), checked: "browser", gatewayNote: null });
        } else {
          try {
            setResult({ profile: await source.importProfile(value), checked: "gateway", gatewayNote: null });
          } catch (e) {
            if (e instanceof GatewayError && (e.status === 413 || e.status === 422)) throw e;
            setResult({ profile: toView(decoded, manifests ?? []), checked: "browser", gatewayNote: "No Gateway answered, so this was checked in your browser only." });
          }
        }
      } catch (e) {
        setRefusal(e instanceof ProfileInvalid || e instanceof GatewayError ? e.message : `Couldn't read this code: ${message(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [source, manifests],
  );

  // A code in the URL is checked as soon as the manifests are known.
  useEffect(() => {
    if (code && manifests !== null) {
      setTyped(code);
      void check(code);
    }
  }, [code, manifests, check]);

  const reset = () => {
    setTyped("");
    setResult(null);
    setRefusal(null);
    setNote(null);
    if (code) navigate("/profiles/import");
  };

  const download = (profile: ProfileView) => {
    const blob = new Blob([profileToYaml(profile)], { type: "application/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${profile.id}.yaml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote(`Downloaded ${profile.id}.yaml. Put it in profiles/ of your own Tempo and open a pull request.`);
  };

  const profile = result?.profile ?? null;
  const inCatalogue = profile !== null && known.has(profile.id);
  const active = profile !== null && user.profileId === profile.id;

  return (
    <div className="space-y-5">
      <p>
        <a {...linkProps("/profiles")} className={`inline-flex items-center gap-1 text-sm text-indigo-300 underline ${FOCUS}`}>
          <ArrowLeft size={14} aria-hidden /> All profiles
        </a>
      </p>
      <PageTitle lede="Somebody sent you a Tempo profile. The link holds the whole profile; this page only reads it and shows it. Nothing is saved, here or anywhere else, unless you download the file yourself.">
        Profiles
      </PageTitle>
      <h2 className="text-lg font-semibold text-slate-100">Import a profile</h2>

      <Card as="section" aria-labelledby="paste-heading">
        <SectionTitle id="paste-heading" as="h3">
          The share link or code you were sent
        </SectionTitle>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void check(typed);
          }}
        >
          <label htmlFor="share-code" className="sr-only">
            Paste a share link or code
          </label>
          <textarea id="share-code" value={typed} onChange={(e) => setTyped(e.target.value)} rows={3} className={TEXTAREA} placeholder="tp1.…" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" disabled={!typed.trim() || busy || manifests === null} busy={busy} icon={<ShieldCheck size={14} aria-hidden />}>
              Check it
            </Button>
            {(result || refusal) && (
              <Button variant="quiet" onClick={reset}>
                Try another code
              </Button>
            )}
          </div>
        </form>
      </Card>

      <div aria-live="polite" className="space-y-4">
        {busy && <Spinner label="Checking the code" />}
        {refusal && (
          <Card tone="rose" role="alert">
            <p className="text-sm font-semibold text-rose-100">This code can't be trusted.</p>
            <p className="mt-1 text-sm text-rose-50">{refusal}</p>
            <p className="mt-2 text-xs text-rose-200/80">Nothing was stored. Ask whoever sent it to share the profile again.</p>
          </Card>
        )}
        {profile && result && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {result.checked === "gateway" ? <Badge tone="emerald">Checked by the Gateway</Badge> : <Badge tone="amber">Not yet checked by a Gateway</Badge>}
              <StatusBadge status={profile.status} />
              {active && <Badge tone="emerald">In use</Badge>}
            </div>
            {result.checked === "browser" && (
              <Card tone="amber" padding="tight" className="text-sm">
                {showcase
                  ? "The showcase decoded this in your browser and checked its shape and its skills against the committed catalogue. A Gateway re-checks everything before a profile is ever used, and only ever validates: it never stores what is sent."
                  : result.gatewayNote ?? "Checked in your browser."}
              </Card>
            )}
            <div>
              <h3 className="text-lg font-semibold text-slate-100">{profile.name}</h3>
              <p className="mt-1 text-sm text-slate-300">{profile.summary}</p>
              <p className="mt-1 text-sm text-slate-200">
                <span className="text-slate-400">For:</span> {profile.for_whom}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                {profile.jobs.length > 0 ? (
                  <WillDo jobs={profile.jobs} id="import-jobs" />
                ) : (
                  <>
                    <SectionTitle as="h3">The skills it turns on</SectionTitle>
                    <ul className="space-y-1 text-sm text-slate-200">
                      {profile.skills.map((s) => (
                        <li key={s.id}>{s.name}</li>
                      ))}
                    </ul>
                  </>
                )}
              </Card>
              <Card tone="rose">
                <MayNever actions={profile.may_not} id="import-may-not" />
              </Card>
            </div>
            <Card>
              <SectionTitle as="h3">Its limits and how it speaks</SectionTitle>
              <ul className="space-y-1 text-sm text-slate-200">
                {limitsInWords(profile.limits).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <div className="mt-3">
                <AccessChips access={profile.access} />
              </div>
            </Card>
            <Card tone="indigo">
              <SectionTitle as="h3">Use it</SectionTitle>
              {inCatalogue ? (
                <>
                  <p className="text-sm text-slate-200">
                    This Tempo already has a profile called <strong className="text-slate-100">{profile.id}</strong>, so you can pick it for the chat right away. The Gateway only
                    validates a shared code; it never stores one.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {active ? (
                      <Button variant="quiet" onClick={() => setProfile(null)} icon={<UserMinus size={14} aria-hidden />}>
                        Stop using
                      </Button>
                    ) : (
                      <Button onClick={() => setProfile(profile.id)} icon={<UserCheck size={14} aria-hidden />}>
                        Use this profile
                      </Button>
                    )}
                    <Button variant="quiet" onClick={() => download(profile)} icon={<Download size={14} aria-hidden />}>
                      Download YAML
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-200">
                    This profile isn't in this Tempo's catalogue yet. The Gateway only validates a shared code; it never stores one. To use it, put the YAML in{" "}
                    <code className="text-indigo-200">profiles/</code> of your own Tempo and open a pull request, or compare it with the{" "}
                    <a {...linkProps("/profiles")} className={`text-indigo-300 underline ${FOCUS}`}>
                      starter profiles
                    </a>
                    .
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button onClick={() => download(profile)} icon={<Download size={14} aria-hidden />}>
                      Download YAML
                    </Button>
                    <a href={DOCS.profiles} rel="noopener noreferrer" className={`inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-slate-200 hover:bg-white/10 ${FOCUS}`}>
                      How sharing stays safe
                    </a>
                  </div>
                </>
              )}
              <p role="status" className="mt-2 min-h-[1rem] text-xs text-slate-300">
                {note}
              </p>
            </Card>
            <p className="text-xs text-slate-500">This page has stored nothing.</p>
          </>
        )}
      </div>
    </div>
  );
}
