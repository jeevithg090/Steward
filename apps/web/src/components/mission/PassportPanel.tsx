// The Agent Passport (plan.md §12, demo beat 9): the mandate a company can check, what it lets
// Tempo do and not do, how it was signed, and the company's own checks. "Let the company check
// it" plays the company: it sends the signed envelope to Tempo's public check (POST
// /mandates/verify, no login), and the browser checks the Face ID signature itself too.
// Without a mandate, a device with Face ID signs one here (useMesh().signs).
import { useEffect, useId, useMemo, useState } from "react";
import { BadgeCheck, CheckCircle2, Fingerprint, Scale, ShieldCheck, Smartphone, XCircle } from "lucide-react";
import { Badge, Button, Card, FOCUS, toast } from "@/components/ui";
import type { MandateView, MissionState, MissionView } from "@/lib/api";
import type { LiveEvent } from "@/lib/live";
import { meshWords } from "@/lib/mesh";
import { useMesh } from "@/lib/mesh-context";
import { type CompanyVerdict, type Envelope, type Reason, signedOn, summarise, verifyMandate } from "@/lib/passport";
import { linkProps, match, parseHash } from "@/router";
import { PanelHeading } from "./look";
import { gbp, shortDateTime } from "./words";

/** A quiet note inside the card: why nothing can be signed here yet. */
const NOTE = "rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm leading-relaxed text-slate-300";
/** One fact about the mandate, as a small glass chip. */
const CHIP = "inline-flex items-center gap-1 rounded-full bg-white/[0.05] px-2.5 py-1 ring-1 ring-inset ring-white/10";

/** Short words for an action, as the company's checks list them. */
const SHORT: Record<string, string> = {
  claim: "claim",
  call: "call",
  accept_cash: "take cash",
  accept_voucher: "take vouchers",
  discuss_other_accounts: "other accounts",
  change_contract: "change the contract",
  share_personal_data: "share personal details",
  escalate: "take it further",
};

/** What each action means, in the person's own terms. */
const PLAIN: Record<string, string> = {
  claim: "Claim this money for you",
  call: "Phone the company about it",
  accept_cash: "Accept a cash refund",
  escalate: "Take it further, as a complaint",
  accept_voucher: "Accept vouchers instead of money",
  discuss_other_accounts: "Talk about your other accounts, like your mobile contract",
  change_contract: "Change your contract",
  share_personal_data: "Share your personal details",
};

const REASON: Record<string, string> = {
  ok: "covered",
  revoked: "you revoked it",
  action_not_allowed: "the mandate doesn't allow that",
  wrong_counterparty: "it's for a different company",
  amount_above_max: "more than the mandate allows",
  amount_below_min: "less than the mandate allows",
  expired: "it has run out",
  not_yet_valid: "it hasn't started yet",
  bad_signature: "the signature doesn't match",
  bad_key: "the key can't be used",
  unknown_version: "a form Tempo doesn't know",
  status_unreachable: "Tempo couldn't be asked",
};

function short(action: string): string {
  return SHORT[action] ?? action.replaceAll("_", " ");
}

function plain(action: string): string {
  return PLAIN[action] ?? action.replaceAll("_", " ");
}

function reasonWords(reason: unknown): string {
  const r = String(reason ?? "");
  return REASON[r] ?? r.replaceAll("_", " ");
}

const STATUS_TONE: Record<MandateView["status"], "emerald" | "rose" | "amber" | "slate"> = {
  active: "emerald",
  revoked: "rose",
  expired: "amber",
  unknown: "slate",
};

/** After a yes: the claim may go ahead, so a mandate for it makes sense. */
const SIGNABLE: ReadonlySet<MissionState> = new Set<MissionState>(["running", "checkpoint", "waiting", "completed", "verified"]);

function missionIdFromRoute(): string | null {
  if (typeof window === "undefined") return null;
  return match("/missions/:id", parseHash(window.location.hash).path)?.id ?? null;
}

type CheckKey = "claim" | "other";
type CheckResult = { verdict?: CompanyVerdict; error?: string; busy?: boolean };

export interface PassportPanelProps {
  mandate: MandateView | null | undefined;
  events?: LiveEvent[];
  busy?: boolean;
  onRevoke?: (id: string) => void;
  /** The mission this passport is for: signing needs its id, and its state says whether a yes was given. */
  mission?: Pick<MissionView, "id" | "state"> | null;
  /** Called after a mandate is signed here, so the page can fetch the mission again. */
  onChanged?: () => void;
}

export function PassportPanel({ mandate, events = [], busy = false, onRevoke, mission = null, onChanged }: PassportPanelProps) {
  const { mesh, signs, showcase } = useMesh();
  const [signedHere, setSignedHere] = useState<{ envelope: Envelope; view: MandateView } | null>(null);
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [envelopeState, setEnvelopeState] = useState<"loading" | "ready" | "missing">("loading");
  const [browserCheck, setBrowserCheck] = useState<Reason | null>(null);
  const [results, setResults] = useState<Partial<Record<CheckKey, CheckResult>>>({});
  const [signing, setSigning] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const checkHeading = useId();

  const missionId = mission?.id ?? missionIdFromRoute();
  // The mandate just signed here shows at once; the Gateway's summary wins once it names the same one.
  const fresh = signedHere && (signedHere.envelope.mandate.matter as { mission_id?: string } | undefined)?.mission_id === missionId ? signedHere : null;
  const view: MandateView | null = fresh && fresh.view.id !== mandate?.id ? fresh.view : (mandate ?? null);
  const viewId = view?.id ?? null;

  // The signed envelope for this mandate: just signed, kept on this device, or fetched for one of her devices.
  useEffect(() => {
    let live = true;
    setBrowserCheck(null);
    if (!viewId) {
      setEnvelope(null);
      return;
    }
    if (fresh?.envelope.mandate.mandate_id === viewId) {
      setEnvelope(fresh.envelope);
      setEnvelopeState("ready");
      return;
    }
    setEnvelopeState("loading");
    mesh
      .envelope(viewId)
      .then((found) => {
        if (!live) return;
        setEnvelope(found);
        setEnvelopeState(found ? "ready" : "missing");
      })
      .catch(() => {
        if (!live) return;
        setEnvelope(null);
        setEnvelopeState("missing");
      });
    return () => {
      live = false;
    };
  }, [viewId, mesh, fresh]);

  // Another mandate, or a revoke (or expiry), changes every company's answer: ask again rather
  // than show the old ones.
  const which = `${viewId}:${view?.status ?? ""}`;
  useEffect(() => {
    setResults({});
    setConfirmRevoke(false);
  }, [which]);

  // The browser checks the Face ID signature itself, with WebCrypto: no server, no SDK.
  useEffect(() => {
    let live = true;
    if (!envelope || envelope.signature.kind !== "webauthn") return;
    void verifyMandate(envelope, new Date()).then((r) => live && setBrowserCheck(r));
    return () => {
      live = false;
    };
  }, [envelope]);

  const checks = useMemo(() => events.filter((e) => e.type === "mandate_verified" || e.type === "mandate_refused").slice(0, 8), [events]);

  const sign = async () => {
    if (!missionId) return;
    setSigning(true);
    try {
      const signed = await mesh.signMandate(missionId);
      setSignedHere({ envelope: signed, view: await summarise(signed) });
      toast.success("Mandate signed with Face ID. A company can check it now.");
      onChanged?.();
    } catch (e) {
      toast.error(meshWords(e));
    } finally {
      setSigning(false);
    }
  };

  const check = async (key: CheckKey) => {
    if (!envelope || !view) return;
    setResults((r) => ({ ...r, [key]: { busy: true } }));
    try {
      const verdict =
        key === "claim"
          ? await mesh.verifyWithCompany(envelope, view.counterparty, "claim", view.max_gbp)
          : await mesh.verifyWithCompany(envelope, view.counterparty, "discuss_other_accounts", null);
      setResults((r) => ({ ...r, [key]: { verdict } }));
    } catch (e) {
      const error = meshWords(e);
      setResults((r) => ({ ...r, [key]: { error } }));
      toast.error(error);
    }
  };

  const signButton = (label: string) => (
    <Button variant="primary" busy={signing} icon={<Fingerprint size={16} aria-hidden />} onClick={() => void sign()}>
      {label}
    </Button>
  );

  /** Whether (and why not) a mandate can be signed for this mission from this browser. */
  const signArea = (() => {
    if (showcase) {
      return (
        <p className={NOTE}>
          In the showcase there&apos;s no Gateway, so nothing can be signed. Run Tempo locally and add Face ID on Devices to sign a mandate with your own face or finger.
        </p>
      );
    }
    if (mission && mission.state === "awaiting_consent") {
      return <p className={NOTE}>Answer Tempo&apos;s question first. Once you&apos;ve said yes, you can sign a mandate here for a company to check.</p>;
    }
    if (mission && (mission.state === "declined" || mission.state === "failed_safe")) {
      return <p className={NOTE}>This mission stopped, so there&apos;s nothing to sign.</p>;
    }
    if (mission && !SIGNABLE.has(mission.state)) {
      return <p className={NOTE}>Tempo is still working out the claim. You can sign a mandate once it asks you and you say yes.</p>;
    }
    if (!signs) {
      return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <p className="text-sm text-slate-300">Signing a mandate needs Face ID on this device.</p>
          <a
            {...linkProps("/devices")}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3.5 text-sm font-medium text-slate-100 transition-colors hover:border-white/20 hover:bg-white/[0.09] motion-reduce:transition-none ${FOCUS}`}
          >
            <Smartphone size={14} aria-hidden /> Set up Face ID on Devices
          </a>
        </div>
      );
    }
    if (!missionId) return null;
    return signButton(view ? "Sign a new mandate with Face ID" : "Sign a mandate with Face ID");
  })();

  const assurance = view
    ? view.assurance === "device-biometric"
      ? `Signed with Face ID on ${signedOn(envelope) ?? "one of your devices"}`
      : "Gateway-attested (weaker): Tempo's own key signed it after your spoken yes on the phone"
    : null;

  return (
    <Card as="section" aria-labelledby="passport-heading">
      <PanelHeading
        id="passport-heading"
        icon={<ShieldCheck size={16} />}
        title="Agent Passport"
        sub="The mandate a company checks before it deals with Tempo for you."
        right={
          view ? (
            <Badge tone={STATUS_TONE[view.status]} dot>
              {view.status}
            </Badge>
          ) : undefined
        }
      />

      {!view ? (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-slate-300">
            No mandate yet. A mandate tells a company exactly what Tempo may do for you here, for how much and until when. Face ID signs it on your device, and the company checks
            it with Tempo in milliseconds.
          </p>
          {signArea}
        </div>
      ) : (
        <div className="space-y-5 text-sm">
          <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-transparent p-4">
            <p className="flex flex-wrap items-center gap-2.5 text-[15px] text-white">
              <BadgeCheck size={18} aria-hidden className="text-emerald-300" />
              <span className="font-semibold">
                For {view.counterparty}
                {view.account_ref ? `, account ${view.account_ref}` : ""}
              </span>
            </p>
            <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-300">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ring-inset ${view.assurance === "device-biometric" ? "bg-emerald-500/10 text-emerald-200 ring-emerald-300/25" : "bg-amber-500/10 text-amber-200 ring-amber-300/25"}`}
              >
                <Fingerprint size={12} aria-hidden /> {assurance}
              </span>
              <span className={CHIP}>up to {gbp(view.max_gbp)}</span>
              <span className={CHIP}>until {shortDateTime(view.expires_at)}</span>
              <span className={CHIP} title="SHA-256 of the exact mandate: a company computes the same">
                digest <span className="font-mono text-slate-200">{view.digest.slice(0, 12)}</span>
              </span>
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.05] p-4">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-300">What Tempo may do</h4>
              <ul aria-label="Tempo may" className="mt-2.5 space-y-2">
                {view.may.map((a) => (
                  <li key={a} className="flex items-start gap-2 leading-snug text-slate-100">
                    <CheckCircle2 size={15} aria-hidden className="mt-px shrink-0 text-emerald-300" /> {plain(a)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-rose-400/15 bg-rose-500/[0.05] p-4">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-300">What Tempo may not do</h4>
              <ul aria-label="Tempo may not" className="mt-2.5 space-y-2">
                {view.may_not.map((a) => (
                  <li key={a} className="flex items-start gap-2 leading-snug text-slate-300">
                    <XCircle size={15} aria-hidden className="mt-px shrink-0 text-rose-300" /> {plain(a)}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {view.status === "active" && onRevoke && !confirmRevoke && (
            <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirmRevoke(true)}>
              Revoke this mandate
            </Button>
          )}
          {view.status === "active" && onRevoke && confirmRevoke && (
            <div role="group" aria-label="Revoke this mandate?" className="rounded-2xl border border-rose-400/30 bg-rose-500/[0.08] p-4">
              <p className="text-sm text-rose-100">Revoke it? Every company that checks will be told it&apos;s cancelled, at once.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="danger" size="sm" busy={busy} onClick={() => onRevoke(view.id)}>
                  Yes, revoke it
                </Button>
                <Button variant="quiet" size="sm" disabled={busy} onClick={() => setConfirmRevoke(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          )}
          {view.status !== "active" && signs && !showcase && missionId && (!mission || SIGNABLE.has(mission.state)) && signButton("Sign a new mandate with Face ID")}

          <section aria-labelledby={checkHeading} className="rounded-2xl border border-white/[0.08] bg-black/20 p-4">
            <h4 id={checkHeading} className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              <Scale size={13} aria-hidden className="text-accent-300" /> Let the company check it
            </h4>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Play {view.counterparty}: send this mandate to Tempo&apos;s public check, the one a company&apos;s agent calls with no login.
            </p>
            {envelopeState === "missing" && (
              <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/[0.07] px-3 py-2 text-xs leading-relaxed text-amber-100">
                This browser doesn&apos;t hold the signed mandate, so it can&apos;t play the company. Open this mission on the device that signed it, or on any device you&apos;ve
                set up on Devices.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="quiet" size="sm" busy={results.claim?.busy} disabled={!envelope} onClick={() => void check("claim")}>
                Check: claim {gbp(view.max_gbp)}
              </Button>
              <Button variant="quiet" size="sm" busy={results.other?.busy} disabled={!envelope} onClick={() => void check("other")}>
                Check: discuss her mobile contract
              </Button>
            </div>
            <div aria-live="polite">
              {(results.claim || results.other) && (
                <ul aria-label="Check results" className="mt-3 space-y-2 text-xs">
                  {(["claim", "other"] as const).map((key) => {
                    const r = results[key];
                    if (!r || r.busy) return null;
                    const what = key === "claim" ? `claim ${gbp(view.max_gbp)}` : "discuss her mobile contract";
                    if (r.error) {
                      return (
                        <li key={key} className="rounded-xl border border-rose-400/20 bg-rose-500/[0.06] px-3 py-2 text-rose-200">
                          Couldn&apos;t check “{what}”: {r.error}
                        </li>
                      );
                    }
                    const v = r.verdict!;
                    return (
                      <li
                        key={key}
                        className={`flex items-start gap-2 rounded-xl border px-3 py-2 leading-relaxed ${v.ok ? "border-emerald-400/20 bg-emerald-500/[0.06] text-emerald-200" : "border-rose-400/20 bg-rose-500/[0.06] text-rose-200"}`}
                      >
                        {v.ok ? <CheckCircle2 size={14} aria-hidden className="mt-0.5 shrink-0" /> : <XCircle size={14} aria-hidden className="mt-0.5 shrink-0" />}
                        <span>
                          <span className="font-semibold">{v.ok ? "Allowed" : "Refused"}</span>: {what}. {v.message}{" "}
                          <span className="num text-slate-400">
                            ({v.reason.replaceAll("_", " ")} · {v.latency_ms.toFixed(2)} ms)
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {envelope && envelope.signature.kind === "webauthn" && browserCheck && (
              <p className={`mt-3 flex items-center gap-1.5 text-xs ${browserCheck === "ok" ? "text-emerald-200" : "text-amber-200"}`} role="status">
                <ShieldCheck size={14} aria-hidden /> Signature checked in your browser: {browserCheck === "ok" ? "ok" : reasonWords(browserCheck)}
              </p>
            )}
            {envelope && envelope.signature.kind !== "webauthn" && (
              <p className="mt-3 text-xs leading-relaxed text-slate-400">
                Tempo&apos;s own key signed this one, so only Tempo&apos;s check above can vouch for it; your browser checks Face ID signatures.
              </p>
            )}
          </section>
        </div>
      )}

      {view && (
        <div className="mt-5 border-t border-white/[0.07] pt-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">What the company checked</h4>
          <div aria-live="polite">
            {checks.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400">No company has checked it yet.</p>
            ) : (
              <ul aria-label="What the company checked" className="mt-2 space-y-1.5 text-xs">
                {checks.map((e, i) => (
                  <li key={i} className={`flex items-center gap-2 ${e.type === "mandate_verified" ? "text-emerald-200" : "text-rose-200"}`}>
                    <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${e.type === "mandate_verified" ? "bg-emerald-300" : "bg-rose-300"}`} />
                    {e.type === "mandate_verified" ? "Allowed" : "Refused"}: {short(String(e.action))}
                    {e.counterparty ? `, for ${String(e.counterparty)}` : ""}
                    {e.type === "mandate_refused" ? ` (${reasonWords(e.reason)})` : ""}
                    {typeof e.latency_ms === "number" && <> · {e.latency_ms.toFixed(2)} ms</>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
