// Profiles (plan.md §2, §12.3): who Tempo works for. The catalogue (#/profiles), one profile in
// full with sharing (#/profiles/:id) and the import page (#/profiles/import?p=<code>) with plain-word
// refusals. The chosen profile is obvious (a sticky "Tempo is working for" banner), can be
// stopped, and each card can be tried straight away in the chat with a sentence that fits it.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Check, ClipboardPaste, Copy, Download, FileDown, Link2, MessageCircle, ShieldCheck, ShieldX, Upload, UserCheck, UserMinus } from "lucide-react";
import { Badge, Button, Card, EmptyState, FOCUS, PageTitle, SectionTitle, SkeletonCards, toast } from "@/components/ui";
import { CatalogClient, type CatalogSource, GatewayError } from "@/lib/catalog-client";
import { ACTION_WORDS, type Profile, ProfileInvalid, type ProfileView, type SkillManifest, codeFromHash, decodeShareCode, encodeShareCode, profileToYaml, toProfile, toView } from "@/lib/profiles";
import { ShowcaseCatalog } from "@/lib/showcase";
import { useCatalog } from "@/lib/use-showcase";
import { linkProps, navigate, useRoute } from "@/router";
import type { PageProps } from "@/types/page";
import { SAY, TAP, chatSay, shortSay } from "../story/demo";
import { AccessChips, CHANNEL_WORDS, DOCS, MayNever, StatusBadge, WillDo, accessInWords, capital, limitsInWords } from "./bits";
import { loadError } from "@/components/mission/words";
import catalogJson from "@/showcase/catalog.json";

const TEXTAREA = `w-full rounded-xl border border-white/15 bg-black/30 p-3 font-mono text-xs text-slate-100 placeholder:text-slate-500 ${FOCUS}`;
const QUIET_LINK = `inline-flex ${TAP} items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10 ${FOCUS}`;

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

/** The sentence each starter profile is best tried with in the chat, and what to watch for. */
export const TRY_WITH: Record<string, { say: string; watch?: string }> = {
  commuter: { say: SAY.lateTrain, watch: "Tempo prices it from the rule pack and asks once." },
  "read-it-to-me": { say: SAY.lateTrain, watch: "This profile may not claim, so Tempo refuses before it starts." },
  "am-i-owed": { say: SAY.owed, watch: "Tempo only looks and explains: this profile may not claim." },
  "new-to-the-uk": { say: SAY.scam, watch: "Scam Shield warns, in the language you chose." },
  carer: { say: SAY.broadband, watch: "A missed engineer visit, claimed for the person you care for." },
  "take-your-time": { say: SAY.lateTrain, watch: "The same claim, with extra time to answer." },
  "hard-of-hearing": { say: SAY.lateTrain, watch: "The same claim, with every question offered by text too." },
};

export function tryWith(id: string): { href: string; say: string; watch?: string } {
  const t = TRY_WITH[id] ?? { say: SAY.lateTrain };
  return { ...t, href: chatSay(t.say) };
}

function message(e: unknown): string {
  return loadError(e);
}

function downloadYaml(profile: ProfileView, then: string) {
  try {
    const blob = new Blob([profileToYaml(profile)], { type: "application/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${profile.id}.yaml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`Downloaded ${profile.id}.yaml. ${then}`);
  } catch (e) {
    toast.error(`Couldn't make the file: ${message(e)}. Copy the share link instead.`);
  }
}

/** Use / stop using, with the confirmation every change gets. */
function useChoose(setProfile: PageProps["setProfile"]) {
  return useMemo(
    () => ({
      use: (p: { id: string; name: string }) => {
        setProfile(p.id);
        toast.success(`Tempo now works under ${p.name}.`);
      },
      stop: (name: string) => {
        setProfile(null);
        toast.info(`Tempo no longer works under ${name}. It asks before anything binding, as usual.`);
      },
    }),
    [setProfile],
  );
}

export default function ProfilesPage(props: PageProps) {
  const { showcase, params, user } = props;
  const route = useRoute();
  const injected = useMemo<CatalogSource>(() => (showcase ? new ShowcaseCatalog() : new CatalogClient()), [showcase]);
  const { source } = useCatalog(injected);

  // Who Tempo works for, right under the page's heading and sticky while the page scrolls.
  const banner = user.profileId ? <WorkingFor source={source} id={user.profileId} setProfile={props.setProfile} /> : null;

  if (route.path === "/profiles/import") return <ImportProfile {...props} source={source} code={route.query.get("p")} banner={banner} />;
  if (params.id) return <ProfileDetail {...props} source={source} id={params.id} banner={banner} />;
  return <ProfileList {...props} source={source} banner={banner} />;
}

type Sub = PageProps & { source: CatalogSource; banner: ReactNode };

// --- who Tempo works for, always in view -------------------------------------------------------

// The starter profiles' names ship with the app, so the banner never falls back to an id while the
// Gateway is busy or restarting; the Gateway's own answer still wins once it comes.
const KNOWN_NAMES: Record<string, string> = Object.fromEntries(
  (catalogJson as { profiles: { id: string; name: string }[] }).profiles.map((p) => [p.id, p.name]),
);

function WorkingFor({ source, id, setProfile }: { source: CatalogSource; id: string; setProfile: PageProps["setProfile"] }) {
  const [name, setName] = useState<string>(KNOWN_NAMES[id] ?? id);
  const choose = useChoose(setProfile);
  useEffect(() => {
    let live = true;
    setName(KNOWN_NAMES[id] ?? id);
    source
      .profile(id)
      .then((p) => live && setName(p.name))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [source, id]);

  return (
    <div className="sticky top-0 z-20 pt-1">
      <div
        role="region"
        aria-label="Who Tempo is working for"
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl border border-emerald-500/40 bg-emerald-950/95 py-1.5 pl-4 pr-1.5 shadow-lg shadow-black/40 backdrop-blur"
      >
        <p className="flex min-w-0 items-center gap-2 text-sm text-emerald-50">
          <UserCheck size={18} className="shrink-0 text-emerald-300" aria-hidden />
          <span>
            Tempo is working for:{" "}
            <a {...linkProps(`/profiles/${id}`)} className={`font-semibold text-white underline decoration-emerald-300/50 underline-offset-2 hover:decoration-white ${FOCUS}`}>
              {name}
            </a>
          </span>
        </p>
        <Button variant="quiet" onClick={() => choose.stop(name)} icon={<UserMinus size={14} aria-hidden />} className={`${TAP} ml-auto`}>
          Stop using
        </Button>
      </div>
    </div>
  );
}

function TryLink({ profile, setProfile, className = QUIET_LINK }: { profile: { id: string; name: string }; setProfile: PageProps["setProfile"]; className?: string }) {
  const t = tryWith(profile.id);
  return (
    <a
      {...linkProps(t.href)}
      onClick={(e) => {
        setProfile(profile.id);
        linkProps(t.href).onClick(e);
      }}
      aria-describedby={`${profile.id}-try-hint`}
      className={className}
    >
      <MessageCircle size={14} aria-hidden /> Try it with this profile<span className="sr-only">: {profile.name}</span>
    </a>
  );
}

function TryHint({ id }: { id: string }) {
  const t = tryWith(id);
  return (
    <p id={`${id}-try-hint`} className="text-xs text-slate-400">
      Sends “{shortSay(t.say, 56)}” in the chat under this profile.{t.watch ? ` ${t.watch}` : ""}
    </p>
  );
}

// --- the catalogue ----------------------------------------------------------------------------

function ProfileList({ source, user, setProfile, showcase, banner }: Sub) {
  const [profiles, setProfiles] = useState<ProfileView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const choose = useChoose(setProfile);

  const load = useCallback(() => {
    let live = true;
    setError(null);
    source
      .profiles()
      .then((p) => live && setProfiles(p))
      .catch((e) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, [source]);
  useEffect(load, [load]);

  return (
    <div className="space-y-5">
      <PageTitle
        lede="A profile says who Tempo works for, which skills are on, how it must speak with you, and what it may never do. It is enforced, not just displayed: if you ask for something a profile rules out, Tempo refuses before it starts."
        right={
          <a {...linkProps("/profiles/import")} className={QUIET_LINK}>
            <Upload size={14} aria-hidden /> Import a code
          </a>
        }
      >
        Profiles
      </PageTitle>

      {banner}
      {!user.profileId && profiles && (
        <p className="rounded-2xl border border-dashed border-white/15 px-4 py-3 text-sm text-slate-300">
          No profile chosen: Tempo asks before anything binding, and uses its usual patient voice. Choose one below and the chat sends it with every mission.
        </p>
      )}

      {error && (
        <EmptyState title="Couldn't load the profiles" tone="error" action={<Button variant="quiet" onClick={load} className={TAP}>Try again</Button>}>
          {error} Check the Gateway in Settings, or switch on the showcase there.
        </EmptyState>
      )}
      {!error && profiles === null && <SkeletonCards count={4} label="Loading profiles" />}
      {profiles && profiles.length === 0 && <EmptyState title="No profiles yet">Add one YAML file to profiles/ and it appears here.</EmptyState>}
      {profiles && profiles.length > 0 && (
        <ul className="grid gap-4 md:grid-cols-2">
          {profiles.map((p) => {
            const active = user.profileId === p.id;
            return (
              <Card key={p.id} as="li" tone={active ? "emerald" : "default"} className={`flex flex-col gap-3 ${active ? "ring-1 ring-emerald-400/40" : ""}`}>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-100">
                      <a {...linkProps(`/profiles/${p.id}`)} className={`text-indigo-200 underline decoration-indigo-300/40 underline-offset-2 hover:decoration-indigo-200 ${FOCUS}`}>
                        {p.name}
                      </a>
                    </h2>
                    {active && (
                      <Badge tone="emerald">
                        <Check size={11} aria-hidden /> In use
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-300">
                    <span className="text-slate-400">For:</span> {p.for_whom}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2">
                  <WillDo jobs={p.jobs} id={`${p.id}-jobs`} limit={3} />
                  <MayNever actions={p.may_not} id={`${p.id}-may-not`} limit={3} />
                </div>
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
                <div className="mt-auto space-y-2 border-t border-white/10 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {active ? (
                      <Button variant="quiet" onClick={() => choose.stop(p.name)} icon={<UserMinus size={14} aria-hidden />} className={TAP}>
                        Stop using
                      </Button>
                    ) : (
                      <Button onClick={() => choose.use(p)} icon={<UserCheck size={14} aria-hidden />} className={TAP} aria-label={`Use this profile: ${p.name}`}>
                        Use this profile
                      </Button>
                    )}
                    <TryLink profile={p} setProfile={setProfile} />
                  </div>
                  <TryHint id={p.id} />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <StatusBadge status={p.status} />
                    <span>v{p.version}</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </ul>
      )}
      {showcase && profiles && <p className="text-xs text-slate-400">Showcase: read from the committed catalogue (profiles/*.yaml), not from a Gateway.</p>}
    </div>
  );
}

// --- one profile, with sharing ----------------------------------------------------------------

function ProfileDetail({ source, id, user, setProfile, showcase, banner }: Sub & { id: string }) {
  const [profile, setProfileView] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const choose = useChoose(setProfile);

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
      toast.error(`Couldn't make a share link: ${message(e)}`);
    }
  }, [profile]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied. The whole profile is in the link itself; nothing was stored anywhere.");
    } catch {
      toast.error("This browser wouldn't let Tempo copy. Select the link below and copy it yourself.");
    }
  };

  const active = profile !== null && user.profileId === profile.id;

  return (
    <div className="space-y-5">
      <p>
        <a {...linkProps("/profiles")} className={`inline-flex ${TAP} items-center gap-1 text-sm text-indigo-300 underline ${FOCUS}`}>
          <ArrowLeft size={14} aria-hidden /> All profiles
        </a>
      </p>
      {error && (
        <>
          <PageTitle>Profiles</PageTitle>
          {banner}
          <EmptyState title="There's no such profile" tone="error" action={<a {...linkProps("/profiles")} className={QUIET_LINK}>See all profiles</a>}>
            {error}
          </EmptyState>
        </>
      )}
      {!error && !profile && (
        <>
          <PageTitle>Profiles</PageTitle>
          {banner}
          <SkeletonCards count={3} label="Loading the profile" />
        </>
      )}
      {profile && (
        <>
          <PageTitle lede={profile.summary}>Profiles</PageTitle>
          {banner}
          <Card tone={active ? "emerald" : "indigo"} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-slate-100">{profile.name}</h2>
              {active && (
                <Badge tone="emerald">
                  <Check size={11} aria-hidden /> In use
                </Badge>
              )}
              <StatusBadge status={profile.status} />
              <span className="text-xs text-slate-400">
                v{profile.version} · by {profile.share.author}
              </span>
            </div>
            <p className="text-sm text-slate-200">
              <span className="text-slate-400">Who it is for:</span> {profile.for_whom}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {active ? (
                <Button variant="quiet" onClick={() => choose.stop(profile.name)} icon={<UserMinus size={14} aria-hidden />} className={TAP}>
                  Stop using
                </Button>
              ) : (
                <Button onClick={() => choose.use(profile)} icon={<UserCheck size={14} aria-hidden />} className={TAP} aria-label={`Use this profile: ${profile.name}`}>
                  Use this profile
                </Button>
              )}
              <TryLink profile={profile} setProfile={setProfile} />
            </div>
            <TryHint id={profile.id} />
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <WillDo jobs={profile.jobs} id="detail-jobs" as="h3" />
            </Card>
            <Card tone="rose">
              <MayNever actions={profile.may_not} id="detail-may-not" as="h3" />
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-black/20 px-3 py-2 text-sm text-rose-50">
                <ShieldX size={16} className="mt-0.5 shrink-0 text-rose-300" aria-hidden />
                If you ask for something this profile rules out, Tempo refuses before it starts.
              </p>
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
            <ul className="flex flex-wrap gap-2">
              {profile.skills.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm">
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
              <Button onClick={() => void copy()} disabled={!link} icon={<Copy size={14} aria-hidden />} className={TAP}>
                Copy link
              </Button>
              <Button variant="quiet" onClick={() => downloadYaml(profile, "Put it in profiles/ and open a pull request to share it with everyone.")} icon={<FileDown size={14} aria-hidden />} className={TAP}>
                Download YAML
              </Button>
              {link && (
                <a {...linkProps(link.slice(link.indexOf("#")))} className={QUIET_LINK}>
                  <Upload size={14} aria-hidden /> Open the import page
                </a>
              )}
            </div>
            <label htmlFor="share-link" className="mt-3 block text-xs font-medium text-slate-400">
              The link
            </label>
            <textarea id="share-link" readOnly value={link ?? ""} rows={3} className={`mt-1 ${TEXTAREA}`} onFocus={(e) => e.currentTarget.select()} />
          </Card>

          {showcase && <p className="text-xs text-slate-400">Showcase: this profile comes from the committed catalogue (profiles/{profile.id}.yaml), not from a Gateway.</p>}
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

function ImportProfile({ source, code, user, setProfile, showcase, banner }: Sub & { code: string | null }) {
  const [typed, setTyped] = useState("");
  const [manifests, setManifests] = useState<SkillManifest[] | null>(null);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choose = useChoose(setProfile);

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
    if (code) navigate("/profiles/import");
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.info("The clipboard is empty. Copy the link you were sent, then try again.");
        return;
      }
      setTyped(text);
      void check(text);
    } catch {
      toast.info("This browser won't let Tempo read the clipboard. Long-press or right-click in the box and choose Paste.");
    }
  };

  const profile = result?.profile ?? null;
  const inCatalogue = profile !== null && known.has(profile.id);
  const active = profile !== null && user.profileId === profile.id;

  return (
    <div className="space-y-5">
      <p>
        <a {...linkProps("/profiles")} className={`inline-flex ${TAP} items-center gap-1 text-sm text-indigo-300 underline ${FOCUS}`}>
          <ArrowLeft size={14} aria-hidden /> All profiles
        </a>
      </p>
      <PageTitle lede="Somebody sent you a Tempo profile. The link holds the whole profile; this page only reads it and shows it. Nothing is saved, here or anywhere else, unless you download the file yourself.">
        Profiles
      </PageTitle>
      {banner}

      <Card as="section" aria-labelledby="paste-heading" tone="indigo">
        <h2 id="paste-heading" className="flex items-center gap-2 text-base font-semibold text-slate-100">
          <Upload size={16} className="text-indigo-300" aria-hidden /> Import a profile
        </h2>
        <p className="mt-1 text-sm text-slate-300">Paste the share link or code you were sent. Tempo checks every rule a Gateway would, and tells you plainly if one fails.</p>
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void check(typed);
          }}
        >
          <label htmlFor="share-code" className="sr-only">
            Paste a share link or code
          </label>
          <textarea id="share-code" value={typed} onChange={(e) => setTyped(e.target.value)} rows={3} className={TEXTAREA} placeholder="https://…#/profiles/import?p=tp1.…  or  tp1.…" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" disabled={!typed.trim() || busy || manifests === null} busy={busy} icon={<ShieldCheck size={14} aria-hidden />} className={TAP}>
              Check it
            </Button>
            <Button variant="quiet" onClick={() => void paste()} disabled={busy} icon={<ClipboardPaste size={14} aria-hidden />} className={TAP}>
              Paste from clipboard
            </Button>
            {(result || refusal) && (
              <Button variant="quiet" onClick={reset} className={TAP}>
                Try another code
              </Button>
            )}
          </div>
        </form>
      </Card>

      <div aria-live="polite" className="space-y-4">
        {busy && <SkeletonCards count={1} label="Checking the code" />}
        {refusal && (
          <Card tone="rose" role="alert">
            <p className="flex items-center gap-2 text-sm font-semibold text-rose-100">
              <ShieldX size={16} className="text-rose-300" aria-hidden /> This code can't be trusted.
            </p>
            <p className="mt-1 text-sm text-rose-50">{refusal}</p>
            <p className="mt-2 text-xs text-rose-200/80">Nothing was stored. Ask whoever sent it to share the profile again.</p>
          </Card>
        )}
        {profile && result && (
          <>
            <Card className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {result.checked === "gateway" ? <Badge tone="emerald">Checked by the Gateway</Badge> : <Badge tone="amber">Not yet checked by a Gateway</Badge>}
                <StatusBadge status={profile.status} />
                {active && <Badge tone="emerald">In use</Badge>}
              </div>
              <div>
                <h3 className="text-xl font-semibold text-slate-100">{profile.name}</h3>
                <p className="mt-1 text-sm text-slate-300">{profile.summary}</p>
                <p className="mt-1 text-sm text-slate-200">
                  <span className="text-slate-400">For:</span> {profile.for_whom}
                </p>
              </div>
              {result.checked === "browser" && (
                <p className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm text-amber-50">
                  {showcase
                    ? "The showcase decoded this in your browser and checked its shape and its skills against the committed catalogue. A Gateway re-checks everything before a profile is ever used, and only ever validates: it never stores what is sent."
                    : result.gatewayNote ?? "Checked in your browser."}
                </p>
              )}
            </Card>
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
                    This Tempo already has a profile called <strong className="text-slate-100">{profile.id}</strong>, so you can choose it for the chat right away. The Gateway
                    only validates a shared code; it never stores one.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {active ? (
                      <Button variant="quiet" onClick={() => choose.stop(profile.name)} icon={<UserMinus size={14} aria-hidden />} className={TAP}>
                        Stop using
                      </Button>
                    ) : (
                      <Button onClick={() => choose.use(profile)} icon={<UserCheck size={14} aria-hidden />} className={TAP} aria-label={`Use this profile: ${profile.name}`}>
                        Use this profile
                      </Button>
                    )}
                    <TryLink profile={profile} setProfile={setProfile} />
                    <Button variant="quiet" onClick={() => downloadYaml(profile, "Put it in profiles/ of your own Tempo and open a pull request.")} icon={<Download size={14} aria-hidden />} className={TAP}>
                      Download YAML
                    </Button>
                  </div>
                  <div className="mt-2">
                    <TryHint id={profile.id} />
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
                    <Button onClick={() => downloadYaml(profile, "Put it in profiles/ of your own Tempo and open a pull request.")} icon={<Download size={14} aria-hidden />} className={TAP}>
                      Download YAML
                    </Button>
                    <a href={DOCS.profiles} rel="noopener noreferrer" className={QUIET_LINK}>
                      How sharing stays safe
                    </a>
                  </div>
                </>
              )}
            </Card>
            <p className="text-xs text-slate-400">This page has stored nothing.</p>
          </>
        )}
      </div>
    </div>
  );
}

