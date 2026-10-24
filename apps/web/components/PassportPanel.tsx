import type { MandateView } from "@/lib/api";
import type { LiveEvent } from "@/lib/live";

const WORDS: Record<string, string> = {
  claim: "claim", call: "call", accept_cash: "take cash", accept_voucher: "take vouchers",
  discuss_other_accounts: "other accounts", change_contract: "change the contract",
  share_personal_data: "share personal details", escalate: "take it further",
};

function words(action: string): string {
  return WORDS[action] ?? action.replaceAll("_", " ");
}

function until(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** The mandate a company can check, and every check it made. Tempo can't act outside it. */
export function PassportPanel({
  mandate, events, canIssue, busy, onIssue, onRevoke,
}: {
  mandate: MandateView | null | undefined;
  events: LiveEvent[];
  canIssue: boolean;
  busy: boolean;
  onIssue: () => void;
  onRevoke: (id: string) => void;
}) {
  const checks = events.filter((e) => e.type === "mandate_verified" || e.type === "mandate_refused").slice(0, 6);
  return (
    <section aria-labelledby="passport-heading" className="rounded-xl border-2 border-slate-300 bg-white p-4">
      <h2 id="passport-heading" className="text-lg font-semibold">Agent Passport</h2>
      {!mandate ? (
        <div className="mt-2 space-y-2">
          <p>No mandate yet. A company can't check who authorised Tempo until you sign one.</p>
          {canIssue ? (
            <button type="button" disabled={busy} onClick={onIssue} className="rounded-lg bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50">
              Sign a mandate with Face ID
            </button>
          ) : (
            <p className="text-sm text-slate-700">Add Face ID or a fingerprint on a device to sign one.</p>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">For {mandate.counterparty}{mandate.account_ref ? `, account ${mandate.account_ref}` : ""}</span>
            <span role="status" className={`rounded-full px-3 py-0.5 text-sm font-semibold ${mandate.status === "active" ? "bg-teal-100 text-teal-900" : "bg-rose-100 text-rose-900"}`}>
              {mandate.status}
            </span>
          </p>
          <p className="text-sm text-slate-700">
            {mandate.assurance === "device-biometric" ? "Signed with Face ID on your phone" : "Signed by Tempo after your spoken yes"}
            {" "}· up to £{mandate.max_gbp} · until {until(mandate.expires_at)} · fingerprint {mandate.digest.slice(0, 12)}
          </p>
          <ul aria-label="Tempo may" className="flex flex-wrap gap-2">
            {mandate.may.map((a) => <li key={a} className="rounded-full bg-teal-50 px-3 py-0.5 text-sm text-teal-900">may {words(a)}</li>)}
          </ul>
          <ul aria-label="Tempo may not" className="flex flex-wrap gap-2">
            {mandate.may_not.map((a) => <li key={a} className="rounded-full bg-slate-100 px-3 py-0.5 text-sm text-slate-700">not {words(a)}</li>)}
          </ul>
          {mandate.status === "active" && (
            <button type="button" disabled={busy} onClick={() => onRevoke(mandate.id)} className="text-sm font-semibold text-rose-800 underline">
              Cancel this mandate
            </button>
          )}
        </div>
      )}
      <h3 className="mt-4 font-semibold">What the company checked</h3>
      {checks.length === 0 ? (
        <p className="text-sm text-slate-700">No checks yet.</p>
      ) : (
        <ul aria-live="polite" className="mt-1 space-y-1 text-sm">
          {checks.map((e, i) => (
            <li key={i} className={e.type === "mandate_verified" ? "text-teal-900" : "text-rose-900"}>
              {e.type === "mandate_verified" ? "Allowed" : "Refused"}: {words(String(e.action))}
              {e.type === "mandate_refused" ? ` (${String(e.reason).replaceAll("_", " ")})` : ""}
              {" "}· {Number(e.latency_ms).toFixed(2)} ms
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
