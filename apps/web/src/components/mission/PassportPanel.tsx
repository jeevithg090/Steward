import { BadgeCheck, Fingerprint } from "lucide-react";
import { Badge, Button, Card, SectionTitle } from "@/components/ui";
import type { MandateView } from "@/lib/api";
import type { LiveEvent } from "@/lib/live";
import { shortDateTime } from "./words";

const WORDS: Record<string, string> = {
  claim: "claim",
  call: "call",
  accept_cash: "take cash",
  accept_voucher: "take vouchers",
  discuss_other_accounts: "talk about other accounts",
  change_contract: "change the contract",
  share_personal_data: "share personal details",
  escalate: "take it further",
};

function words(action: string): string {
  return WORDS[action] ?? action.replaceAll("_", " ");
}

const STATUS_TONE: Record<MandateView["status"], "emerald" | "rose" | "amber" | "slate"> = {
  active: "emerald",
  revoked: "rose",
  expired: "amber",
  unknown: "slate",
};

/** The Agent Passport: what a company can check Tempo may do, and the checks it made. */
export function PassportPanel({
  mandate,
  events = [],
  busy = false,
  onRevoke,
}: {
  mandate: MandateView | null | undefined;
  events?: LiveEvent[];
  busy?: boolean;
  onRevoke?: (id: string) => void;
}) {
  const checks = events.filter((e) => e.type === "mandate_verified" || e.type === "mandate_refused").slice(0, 6);
  return (
    <Card as="section" aria-labelledby="passport-heading">
      <SectionTitle id="passport-heading" as="h3" right={mandate ? <Badge tone={STATUS_TONE[mandate.status]}>{mandate.status}</Badge> : undefined}>
        Agent Passport
      </SectionTitle>
      {!mandate ? (
        <p className="text-sm text-slate-300">
          No mandate was signed for this mission. Signing one needs Tempo Mesh (a paired phone with Face ID or a fingerprint), which is not in this UI.
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="flex flex-wrap items-center gap-2 text-slate-100">
            <BadgeCheck size={16} aria-hidden className="text-emerald-300" />
            <span className="font-semibold">
              For {mandate.counterparty}
              {mandate.account_ref ? `, account ${mandate.account_ref}` : ""}
            </span>
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
            <Fingerprint size={12} aria-hidden />
            {mandate.assurance === "device-biometric" ? "Signed with Face ID on a phone" : "Signed by Tempo after a spoken yes"} · up to £{mandate.max_gbp} · until{" "}
            {shortDateTime(mandate.expires_at)} · fingerprint <span className="font-mono">{mandate.digest.slice(0, 12)}</span>
          </p>
          <ul aria-label="Tempo may" className="flex flex-wrap gap-2">
            {mandate.may.map((a) => (
              <li key={a} className="rounded-full bg-emerald-500/15 px-3 py-0.5 text-xs text-emerald-100">
                may {words(a)}
              </li>
            ))}
          </ul>
          <ul aria-label="Tempo may not" className="flex flex-wrap gap-2">
            {mandate.may_not.map((a) => (
              <li key={a} className="rounded-full bg-white/5 px-3 py-0.5 text-xs text-slate-300">
                not {words(a)}
              </li>
            ))}
          </ul>
          {mandate.status === "active" && onRevoke && (
            <Button variant="danger" size="sm" busy={busy} onClick={() => onRevoke(mandate.id)}>
              Revoke this mandate
            </Button>
          )}
        </div>
      )}
      {checks.length > 0 && (
        <>
          <h4 className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">What the company checked</h4>
          <ul aria-live="polite" className="mt-1 space-y-1 text-xs">
            {checks.map((e, i) => (
              <li key={i} className={e.type === "mandate_verified" ? "text-emerald-200" : "text-rose-200"}>
                {e.type === "mandate_verified" ? "Allowed" : "Refused"}: {words(String(e.action))}
                {e.type === "mandate_refused" ? ` (${String(e.reason).replaceAll("_", " ")})` : ""}
                {typeof e.latency_ms === "number" && <> · {e.latency_ms.toFixed(2)} ms</>}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
