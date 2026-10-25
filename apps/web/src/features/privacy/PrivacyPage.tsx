// Privacy Proof (plan.md §2): what is true of this deployment, each line checked by the Gateway
// rather than claimed: mode and region, outside AI companies, the image digest against the signed
// allowlist, where the key is held, what an operator sees of a row, the canary test. Ported from
// the old PrivacyProof; dark theme. The gaps are stated, not hidden.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Cloud, Eye, Fingerprint, Globe, Info, KeyRound, Lock, Server, ShieldCheck, Smartphone, TestTube2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, FOCUS, PageTitle, SectionTitle, Skeleton } from "@/components/ui";
import type { PrivacyProofData } from "@/lib/api";
import type { PageProps } from "@/types/page";
import { TAP } from "../story/demo";
import { Figure } from "../profiles/bits";
import { loadError } from "@/components/mission/words";

const MODE_WORDS: Record<string, string> = {
  local: "on this machine",
  "cloud-standard": "a standard cloud deployment",
  "cloud-private": "a private cloud: no outside AI company sees your data",
  "cloud-confidential": "confidential computing: the hardware attests what runs",
};

const THIRD_PARTY_WORDS: Record<string, string> = {
  cortex: "Cortex (jurors)",
  elevenlabs: "ElevenLabs (voice)",
  gemini: "Gemini (vision and a juror)",
  openai: "OpenAI (a juror)",
  anthropic: "Anthropic (a juror)",
};

type Verdict = "ok" | "gap" | "info";

const RAIL: Record<Verdict, string> = { ok: "bg-emerald-400", gap: "bg-amber-400", info: "bg-second-400/70" };
const TILE: Record<Verdict, string> = {
  ok: "bg-emerald-500/[0.12] text-emerald-200 ring-emerald-400/25",
  gap: "bg-amber-500/[0.12] text-amber-200 ring-amber-400/25",
  info: "bg-white/[0.05] text-accent-200 ring-white/10",
};

function Line({ icon, label, verdict, children }: { icon: ReactNode; label: string; verdict: Verdict; children: ReactNode }) {
  return (
    <div className="relative rounded-2xl border border-white/[0.06] bg-black/20 py-3.5 pl-5 pr-4 transition-colors hover:border-white/[0.1] motion-reduce:transition-none">
      <span aria-hidden className={`absolute inset-y-3 left-0 w-[3px] rounded-r-full ${RAIL[verdict]}`} />
      <dt className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm font-semibold text-white">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ring-1 ring-inset ${TILE[verdict]}`} aria-hidden>
          {icon}
        </span>
        <span className="min-w-0 flex-1">{label}</span>
        {verdict === "ok" && (
          <Badge tone="emerald">
            <CheckCircle2 size={11} aria-hidden /> checked
          </Badge>
        )}
        {verdict === "gap" && (
          <Badge tone="amber">
            <AlertTriangle size={11} aria-hidden /> a gap
          </Badge>
        )}
        {verdict === "info" && (
          <Badge tone="purple">
            <Info size={11} aria-hidden /> stated
          </Badge>
        )}
      </dt>
      <dd className="mt-2 min-w-0 break-words pl-11 text-sm leading-relaxed text-slate-100">{children}</dd>
    </div>
  );
}

/** Whether the outside AI companies are really called in this run: the Gateway's own list of what
 * answers from recordings (`/health.simulated`) says so, step by step, never the mode alone. */
export function recordedWords(simulated: readonly string[] | undefined): string {
  const recorded = ["jurors", "vision"].filter((step) => simulated?.includes(step));
  if (recorded.length === 2) return "In this run they are named but not called: the jurors and vision answer from recordings.";
  if (recorded.length === 1) return `In this run ${recorded[0] === "jurors" ? "the jurors answer" : "vision answers"} from recordings; the rest is called for real. They see what Tempo sends them for that step, and nothing is remembered from what they return.`;
  return "They are called for real in this run. They see what Tempo sends them for that step, and nothing is remembered from what they return.";
}

export default function PrivacyPage({ gateway, user, health, showcase }: PageProps) {
  const [proof, setProof] = useState<PrivacyProofData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProof(await gateway.privacy(user.id));
      setError(null);
    } catch (e) {
      setError(loadError(e));
    }
  }, [gateway, user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const outsiders = proof?.third_parties.length ? proof.third_parties : (health?.third_parties ?? []);
  const privateMode = proof?.mode === "cloud-private" || proof?.mode === "cloud-confidential" || proof?.mode === "local";

  const verdicts: Verdict[] = proof
    ? [
        "info",
        outsiders.length === 0 ? "ok" : "info",
        proof.allowlist === "signed" && proof.image_allowlisted ? "ok" : "gap",
        proof.key_held_on.length ? "ok" : "gap",
        proof.operator_view ? "ok" : "info",
        "ok",
        proof.attestation === "n/a" ? "gap" : "ok",
      ]
    : [];
  const count = (v: Verdict) => String(verdicts.filter((x) => x === v).length);

  return (
    <div className="space-y-8">
      <PageTitle lede="What is true of this deployment. Each line is something the Gateway checked, not something it claims; where there is a gap, it says so.">
        Privacy Proof
      </PageTitle>

      <Card tone="indigo" padding="none" className="relative overflow-hidden motion-safe:animate-fade-up">
        <span aria-hidden className="pointer-events-none absolute -left-24 -top-32 h-80 w-80 rounded-full bg-accent-500/20 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-32 right-0 h-72 w-72 rounded-full bg-emerald-500/[0.08] blur-3xl" />
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent-300/60 to-transparent" />
        <div className="relative grid gap-6 p-5 lg:grid-cols-[1.4fr_1fr] lg:items-center lg:p-7">
          <div className="flex flex-col items-start gap-4 sm:flex-row">
            <span aria-hidden className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-accent-500/35 to-accent-700/10 text-accent-50 ring-1 ring-inset ring-accent-300/30 shadow-[0_14px_34px_-12px_rgb(var(--accent-600)/0.9)]">
              <ShieldCheck size={26} strokeWidth={1.6} />
            </span>
            <div className="min-w-0">
              <p className="font-display text-[1.85rem] leading-[1.1] text-white sm:text-[2.2rem]">
                <strong className="font-normal">The gaps are stated, not hidden.</strong>
              </p>
              <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-slate-200">
                A missing allowlist, an unpaired device or an unavailable attestation is shown as a gap below, in the same place a pass would be.{" "}
                {showcase ? "In the showcase this is the proof recorded from a replay-mode Gateway, which had the same gaps." : ""}
              </p>
            </div>
          </div>
          {proof && (
            <div className="grid grid-cols-3 gap-3 rounded-2xl border border-white/[0.08] bg-black/25 p-4">
              <Figure label="Checked" value={count("ok")} tone="emerald" icon={<CheckCircle2 size={12} aria-hidden className="text-emerald-300" />} />
              <Figure label="Stated" value={count("info")} icon={<Info size={12} aria-hidden className="text-second-300" />} />
              <Figure label="Gaps" value={count("gap")} tone="amber" icon={<AlertTriangle size={12} aria-hidden className="text-amber-300" />} />
            </div>
          )}
        </div>
      </Card>

      {error && (
        <EmptyState title="Couldn't fetch the proof" tone="error" action={<Button variant="quiet" onClick={() => void load()} className={TAP}>Try again</Button>}>
          {error.replace(/\.?$/, ".")} Check the Gateway in Settings, or switch on the showcase there.
        </EmptyState>
      )}
      {!error && !proof && (
        <div role="status" aria-label="Asking the Gateway what is true" className="surface space-y-4 rounded-3xl p-5 lg:p-6">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="h-8 w-8 shrink-0 rounded-xl" />
              <div className="flex-1">
                <Skeleton className="mb-2 h-3 w-1/3" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      )}

      {proof && (
        <section aria-labelledby="who-heading">
          <SectionTitle id="who-heading">
            <Eye size={12} aria-hidden /> Who sees what
          </SectionTitle>
          <div className="stagger grid gap-4 lg:grid-cols-3">
            <Card tone="emerald" className="flex flex-col">
              <ZoneHead icon={<Smartphone size={18} />} tone="emerald" title="Stays with you" sub="On the devices you hold" />
              <ul className="mt-4 space-y-2.5 text-sm">
                <Fact label="Your data key" ok={proof.key_held_on.length > 0}>
                  {proof.key_held_on.length ? `on ${proof.key_held_on.length} of your ${proof.key_held_on.length === 1 ? "devices, as a passkey" : "devices, as passkeys"}` : "not on a device yet: pair one on Devices"}
                </Fact>
                <Fact label="Your Face ID or fingerprint" ok>
                  never leaves the device; Tempo keeps only a public key
                </Fact>
              </ul>
              <ZoneLink href="#/devices">Your devices</ZoneLink>
            </Card>

            <Card tone="indigo" className="flex flex-col">
              <ZoneHead icon={<Server size={18} />} tone="violet" title="Tempo's Gateway" sub={`${MODE_WORDS[proof.mode] ?? "a deployment the Gateway names itself"} · ${proof.region}`} />
              <ul className="mt-4 space-y-2.5 text-sm">
                <Fact label="What an operator sees" ok={Boolean(proof.operator_view)}>
                  {proof.operator_view ? "ciphertext bytes only" : "the Vault is empty so far"}
                </Fact>
                <Fact label="Logs, traces and model calls" ok>
                  a planted fake secret fails the build if it ever shows up in one
                </Fact>
              </ul>
              <ZoneLink href="#/memory">What Tempo remembers, and how to forget it</ZoneLink>
            </Card>

            <Card tone={outsiders.length === 0 ? "emerald" : "amber"} className="flex flex-col">
              <ZoneHead icon={<Globe size={18} />} tone={outsiders.length === 0 ? "emerald" : "amber"} title="Outside AI companies" sub={outsiders.length === 0 ? "None in this deployment" : `${outsiders.length} named by the Gateway`} />
              {outsiders.length === 0 ? (
                <p className="mt-4 text-sm leading-relaxed text-emerald-50">The Gateway names no outside AI company for this deployment.</p>
              ) : (
                <>
                  <ul aria-label="Outside AI companies" className="mt-4 space-y-2">
                    {outsiders.map((t) => {
                      const [company, role] = companyParts(t);
                      return (
                        <li key={t} className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-black/25 px-3 py-2">
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.07] font-display text-[15px] text-white ring-1 ring-inset ring-white/10">
                              {company.charAt(0)}
                            </span>
                            <span className="truncate text-sm font-medium text-white">{company}</span>
                          </span>
                          {role && <Badge tone="amber">{role}</Badge>}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-3 rounded-2xl border border-amber-400/20 bg-black/20 px-3 py-2.5 text-sm leading-relaxed text-amber-50">{recordedWords(health?.simulated)}</p>
                </>
              )}
            </Card>
          </div>
        </section>
      )}

      {proof && (
        <Card as="section" aria-labelledby="proof-heading" tone="default">
          <SectionTitle id="proof-heading">
            <ShieldCheck size={12} aria-hidden /> Line by line
          </SectionTitle>
          <dl className="stagger space-y-2.5">
            <Line icon={<Cloud size={16} />} label="Deployment mode and region" verdict="info">
              <span className="font-mono text-[13px] font-medium text-white">{proof.mode}</span> · {proof.region}
              <span className="block text-sm text-slate-400">{MODE_WORDS[proof.mode] ?? "a deployment the Gateway names itself"}.</span>
            </Line>

            <Line icon={<Globe size={16} />} label="Outside AI companies" verdict={outsiders.length === 0 ? "ok" : "info"}>
              {outsiders.length === 0 ? (
                <>
                  none{privateMode ? ": in private mode nothing leaves the deployment" : ""}
                </>
              ) : (
                <>
                  {outsiders.map((t) => THIRD_PARTY_WORDS[t] ?? t).join(", ")}
                  <span className="block text-sm text-slate-400">
                    {recordedWords(health?.simulated)}
                  </span>
                </>
              )}
            </Line>

            <Line icon={<Fingerprint size={16} />} label="Running image against the signed allowlist" verdict={proof.allowlist === "signed" && proof.image_allowlisted ? "ok" : "gap"}>
              {proof.image_digest ? (
                <code className="break-all rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-accent-200">{proof.image_digest.slice(0, 19)}…</code>
              ) : (
                <span>a local build, so no image digest</span>
              )}
              <span className="block text-sm text-slate-400">
                {proof.allowlist === "missing"
                  ? "There is no signed allowlist yet, so nothing can vouch for this image. A key is released to a worker only after its report is checked against that list; until it exists, that check cannot pass."
                  : proof.image_allowlisted
                    ? "This image is on the allowlist signed by Tempo's deploy key."
                    : "This image is not on the signed allowlist: a device would refuse to release a key to it."}
              </span>
            </Line>

            <Line icon={<KeyRound size={16} />} label="Your data key is held on" verdict={proof.key_held_on.length ? "ok" : "gap"}>
              {proof.key_held_on.length ? (
                <>{proof.key_held_on.join(", ")} (a passkey on the device; the Gateway never holds it)</>
              ) : (
                <>
                  no device yet: pairing a phone with a passkey is what puts the key on it.{" "}
                  <a href="#/devices" className={`font-medium text-accent-300 underline decoration-accent-400/40 underline-offset-[3px] hover:text-accent-200 ${FOCUS}`}>
                    Set one up on Devices
                  </a>
                  .
                </>
              )}
            </Line>

            <Line icon={<Lock size={16} />} label="What an operator sees of a stored row" verdict={proof.operator_view ? "ok" : "info"}>
              {proof.operator_view ? (
                <code aria-label="Operator view of one stored row" className="break-all rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-accent-200">
                  {proof.operator_view.table}: {proof.operator_view.bytes}…
                </code>
              ) : (
                <>nothing stored in the Vault yet, so nothing to show; a row would appear here as ciphertext bytes</>
              )}
            </Line>

            <Line icon={<TestTube2 size={16} />} label="The canary test" verdict="ok">
              <span className="font-mono text-[13px]">{proof.canary_test}</span>
              <span className="block text-sm text-slate-400">A fake secret is planted; the test fails the build if it ever shows up in a log, a trace or a model call.</span>
            </Line>

            <Line icon={<ShieldCheck size={16} />} label="Hardware attestation" verdict={proof.attestation === "n/a" ? "gap" : "ok"}>
              {proof.attestation === "n/a" ? "not available in this mode: only confidential computing can attest what runs" : proof.attestation}
            </Line>
          </dl>
        </Card>
      )}
    </div>
  );
}

/** "Cortex (jurors)" as ["Cortex", "jurors"], for the company tiles. */
function companyParts(id: string): [string, string | null] {
  const words = THIRD_PARTY_WORDS[id] ?? id;
  const match = /^(.*?)\s*\((.*)\)$/.exec(words);
  return match ? [match[1]!, match[2]!] : [words, null];
}

function ZoneHead({ icon, tone, title, sub }: { icon: ReactNode; tone: "emerald" | "violet" | "amber"; title: string; sub: string }) {
  const tones = {
    emerald: "from-emerald-500/30 to-emerald-700/10 text-emerald-100 ring-emerald-300/25",
    violet: "from-accent-500/30 to-accent-700/10 text-accent-100 ring-accent-300/25",
    amber: "from-amber-500/25 to-amber-700/10 text-amber-100 ring-amber-300/25",
  };
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-b ring-1 ring-inset ${tones[tone]}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-white">{title}</h3>
        <p className="mt-0.5 text-xs leading-snug text-slate-300">{sub}</p>
      </div>
    </div>
  );
}

function ZoneLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="mt-auto pt-5">
      <a href={href} className={`inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-slate-200 underline decoration-white/20 underline-offset-[3px] hover:text-white hover:decoration-white ${FOCUS}`}>
        {children} <ArrowRight size={14} aria-hidden />
      </a>
    </p>
  );
}

function Fact({ label, ok, children }: { label: string; ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span aria-hidden className={`mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full ${ok ? "bg-emerald-500/25 text-emerald-200" : "bg-amber-500/25 text-amber-200"}`}>
        {ok ? <Check size={10} strokeWidth={3} /> : <AlertTriangle size={9} strokeWidth={2.5} />}
      </span>
      <span className="min-w-0 leading-snug">
        <span className="block text-xs font-medium text-slate-400">{label}</span>
        <span className="text-slate-100">{children}</span>
        <span className="sr-only">{ok ? " (holds)" : " (a gap for now)"}</span>
      </span>
    </li>
  );
}
