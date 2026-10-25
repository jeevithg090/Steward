import { useState } from "react";
import { Link2, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Badge, Button, type BadgeTone } from "@/components/ui";
import { LEVEL_WORDS, RULE_WORDS, type ShieldVerdict, ZONE_WORDS } from "@/lib/shield";

const LEVEL_TONE: Record<ShieldVerdict["level"], BadgeTone> = {
  likely_scam: "rose",
  caution: "amber",
  unknown: "slate",
  no_flags: "emerald",
};

const ZONE_TONE: Record<ShieldVerdict["zone"], BadgeTone> = { warn: "rose", sandbox: "amber", quiet: "slate" };

/** Scam Shield's verdict inside the chat: the level, the zone, what Tempo says, and why. */
export function ScamVerdictCard({ verdict, onFeedback }: { verdict: ShieldVerdict; onFeedback?: (alertId: string, label: "scam" | "real") => Promise<void> }) {
  const [sent, setSent] = useState<"scam" | "real" | null>(null);
  const [busy, setBusy] = useState(false);
  const Icon = verdict.level === "likely_scam" ? ShieldAlert : verdict.level === "no_flags" ? ShieldCheck : ShieldQuestion;
  const tone = LEVEL_TONE[verdict.level];
  const rtl = verdict.language === "ur";

  const feedback = async (label: "scam" | "real") => {
    if (!onFeedback) return;
    setBusy(true);
    try {
      await onFeedback(verdict.alert_id, label);
      setSent(label);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Scam Shield verdict" className={`mt-3 space-y-3 rounded-xl border p-3 ${tone === "rose" ? "border-rose-500/30 bg-rose-950/20" : tone === "emerald" ? "border-emerald-500/30 bg-emerald-950/20" : "border-amber-500/30 bg-amber-950/10"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon size={16} aria-hidden className={tone === "rose" ? "text-rose-300" : tone === "emerald" ? "text-emerald-300" : "text-amber-300"} />
        <Badge tone={tone}>{LEVEL_WORDS[verdict.level]}</Badge>
        <Badge tone={ZONE_TONE[verdict.zone]}>{verdict.zone === "warn" ? "warn" : verdict.zone === "sandbox" ? "hold" : "quiet"}</Badge>
        {verdict.confidence !== null && <span className="text-[11px] text-slate-400">{Math.round(verdict.confidence * 100)}% sure</span>}
        {verdict.simulated && <Badge tone="amber">registers simulated</Badge>}
      </div>
      <p className="text-sm font-medium text-slate-100" lang={verdict.language} dir={rtl ? "rtl" : undefined}>
        {verdict.say}
      </p>
      <p className="text-xs text-slate-400">{ZONE_WORDS[verdict.zone]}</p>
      {verdict.reasons.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-300">
          {verdict.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {verdict.rules.length > 0 && (
        <ul aria-label="Rules that fired" className="flex flex-wrap gap-1.5">
          {verdict.rules.map((rule) => (
            <li key={rule} className="rounded-full bg-white/5 px-2.5 py-0.5 text-[11px] text-slate-300">
              {RULE_WORDS[rule] ?? rule.replace(/^scam_/, "").replaceAll("_", " ")}
            </li>
          ))}
        </ul>
      )}
      {verdict.links.length > 0 && (
        <ul aria-label="Links checked" className="space-y-1 text-xs text-slate-300">
          {verdict.links.map((l) => (
            <li key={l.url} className="flex flex-wrap items-center gap-1.5">
              <Link2 size={12} aria-hidden className="text-slate-400" />
              <span className="font-mono text-slate-200">{l.host}</span>
              {l.findings.length > 0 && <span className="text-rose-200">· {l.findings.join(", ").replaceAll("_", " ")}</span>}
            </li>
          ))}
        </ul>
      )}
      {verdict.advice && <p className="text-xs text-slate-300">{verdict.advice}</p>}
      {onFeedback && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {sent ? (
            <p role="status" className="text-xs text-slate-400">
              Thanks. Noted as {sent === "scam" ? "a scam" : "real"}.
            </p>
          ) : (
            <>
              <Button variant="quiet" size="sm" busy={busy} onClick={() => void feedback("real")}>
                This was real
              </Button>
              <Button variant="quiet" size="sm" busy={busy} onClick={() => void feedback("scam")}>
                This was a scam
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
