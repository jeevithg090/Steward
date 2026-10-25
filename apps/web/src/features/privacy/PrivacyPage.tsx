// Privacy Proof (plan.md §2): what is true of this deployment, each line checked by the Gateway
// rather than claimed: mode and region, outside AI companies, the image digest against the signed
// allowlist, where the key is held, what an operator sees of a row, the canary test. Ported from
// the old PrivacyProof; dark theme. The gaps are stated, not hidden.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Cloud, Fingerprint, Globe, KeyRound, Lock, ShieldCheck, TestTube2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageTitle, SectionTitle, Skeleton } from "@/components/ui";
import type { PrivacyProofData } from "@/lib/api";
import type { PageProps } from "@/types/page";
import { TAP } from "../story/demo";

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

function Line({ icon, label, verdict, children }: { icon: ReactNode; label: string; verdict: Verdict; children: ReactNode }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <dt className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-300">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-indigo-200" aria-hidden>
          {icon}
        </span>
        {label}
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
        {verdict === "info" && <Badge tone="purple">stated</Badge>}
      </dt>
      <dd className="mt-1 min-w-0 break-words pl-9 text-sm text-slate-100">{children}</dd>
    </div>
  );
}

export default function PrivacyPage({ gateway, user, health, showcase }: PageProps) {
  const [proof, setProof] = useState<PrivacyProofData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProof(await gateway.privacy(user.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [gateway, user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const outsiders = proof?.third_parties.length ? proof.third_parties : (health?.third_parties ?? []);
  const privateMode = proof?.mode === "cloud-private" || proof?.mode === "cloud-confidential" || proof?.mode === "local";

  return (
    <div className="space-y-5">
      <PageTitle lede="What is true of this deployment. Each line is something the Gateway checked, not something it claims; where there is a gap, it says so.">
        Privacy Proof
      </PageTitle>

      {error && (
        <EmptyState title="Couldn't fetch the proof" tone="error" action={<Button variant="quiet" onClick={() => void load()} className={TAP}>Try again</Button>}>
          {error.replace(/\.?$/, ".")} Check the Gateway in Settings, or switch on the showcase there.
        </EmptyState>
      )}
      {!error && !proof && (
        <div role="status" aria-label="Asking the Gateway what is true" className="space-y-4 rounded-2xl border border-white/10 bg-nexus-card p-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
              <div className="flex-1">
                <Skeleton className="mb-2 h-3 w-1/3" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      )}

      {proof && (
        <Card as="section" aria-labelledby="proof-heading" tone="default">
          <SectionTitle id="proof-heading">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={12} aria-hidden /> Line by line
            </span>
          </SectionTitle>
          <dl className="divide-y divide-white/10">
            <Line icon={<Cloud size={16} />} label="Deployment mode and region" verdict="info">
              <span className="font-medium">{proof.mode}</span> · {proof.region}
              <span className="block text-xs text-slate-400">{MODE_WORDS[proof.mode] ?? "a deployment the Gateway names itself"}.</span>
            </Line>

            <Line icon={<Globe size={16} />} label="Outside AI companies" verdict={outsiders.length === 0 ? "ok" : "info"}>
              {outsiders.length === 0 ? (
                <>
                  none{privateMode ? ": in private mode nothing leaves the deployment" : ""}
                </>
              ) : (
                <>
                  {outsiders.map((t) => THIRD_PARTY_WORDS[t] ?? t).join(", ")}
                  <span className="block text-xs text-slate-400">
                    {health?.mode === "replay" ? "In replay mode they are named but not called: jurors and vision answer from recordings." : "They see what Tempo sends them for that step, and nothing is remembered from what they return."}
                  </span>
                </>
              )}
            </Line>

            <Line icon={<Fingerprint size={16} />} label="Running image against the signed allowlist" verdict={proof.allowlist === "signed" && proof.image_allowlisted ? "ok" : "gap"}>
              {proof.image_digest ? (
                <code className="break-all text-xs text-indigo-200">{proof.image_digest.slice(0, 19)}…</code>
              ) : (
                <span>a local build, so no image digest</span>
              )}
              <span className="block text-xs text-slate-400">
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
                  <a href="#/devices" className="text-indigo-300 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                    Set one up on Devices
                  </a>
                  .
                </>
              )}
            </Line>

            <Line icon={<Lock size={16} />} label="What an operator sees of a stored row" verdict={proof.operator_view ? "ok" : "info"}>
              {proof.operator_view ? (
                <code aria-label="Operator view of one stored row" className="break-all text-xs text-indigo-200">
                  {proof.operator_view.table}: {proof.operator_view.bytes}…
                </code>
              ) : (
                <>nothing stored in the Vault yet, so nothing to show; a row would appear here as ciphertext bytes</>
              )}
            </Line>

            <Line icon={<TestTube2 size={16} />} label="The canary test" verdict="ok">
              {proof.canary_test}
              <span className="block text-xs text-slate-400">A fake secret is planted; the test fails the build if it ever shows up in a log, a trace or a model call.</span>
            </Line>

            <Line icon={<ShieldCheck size={16} />} label="Hardware attestation" verdict={proof.attestation === "n/a" ? "gap" : "ok"}>
              {proof.attestation === "n/a" ? "not available in this mode: only confidential computing can attest what runs" : proof.attestation}
            </Line>
          </dl>
        </Card>
      )}

      <Card tone="indigo" padding="tight" className="text-sm">
        <p>
          <strong className="text-slate-100">The gaps are stated, not hidden.</strong> A missing allowlist, an unpaired device or an unavailable attestation is shown as a gap
          above, in the same place a pass would be. {showcase ? "In the showcase this is the proof recorded from a replay-mode Gateway, which had the same gaps." : ""}
        </p>
      </Card>
    </div>
  );
}
