// One thing a sweep found (plan.md §14.1): a kind icon and colour, the title, why in plain words,
// where it came from, and one action that follows `finding.action.href` (`#/chat?say=…` or a page).
// Used on the Connectors page and, compact, inside the chat's replies.
import { useId, type ComponentType } from "react";
import { ArrowRight, CircleCheck, CircleHelp, FileText, MessageCircle, PoundSterling, ShieldAlert } from "lucide-react";
import { Badge, type BadgeTone, FOCUS } from "@/components/ui";
import type { Finding, FindingKind } from "@/lib/api";
import { sourceLine } from "@/lib/connectors";
import { linkProps } from "@/router";

interface KindStyle {
  icon: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
  /** The card's border and wash. */
  box: string;
  /** The icon's circle. */
  ring: string;
  badge: BadgeTone;
  /** The badge's words; `amount` is the finding's amount in pounds, when it has one; `started` when its claim is already live. */
  words: (amount: string | null, started: boolean) => string;
  /** The action's look: a strong pill for something to do, a quiet one when nothing is needed. */
  action: string;
}

export const FINDING_STYLE: Record<FindingKind, KindStyle> = {
  late_train: {
    icon: PoundSterling,
    box: "border-emerald-500/30 bg-emerald-950/20",
    ring: "bg-emerald-500/15 text-emerald-300",
    badge: "emerald",
    words: (amount, started) => (started ? (amount ? `£${amount} claim started` : "Claim started") : amount ? `£${amount} to claim` : "Money to claim"),
    action: "bg-emerald-600 text-white hover:bg-emerald-500",
  },
  engineer_visit: {
    icon: CircleHelp,
    box: "border-amber-500/30 bg-amber-950/20",
    ring: "bg-amber-500/15 text-amber-300",
    badge: "amber",
    words: (_amount, started) => (started ? "Claim started" : "A question for you"),
    action: "bg-amber-500 text-slate-950 hover:bg-amber-400",
  },
  scam: {
    icon: ShieldAlert,
    box: "border-rose-500/30 bg-rose-950/20",
    ring: "bg-rose-500/15 text-rose-300",
    badge: "rose",
    words: () => "A trick: don't click",
    action: "bg-rose-600 text-white hover:bg-rose-500",
  },
  money_arrived: {
    icon: CircleCheck,
    box: "border-white/10 bg-white/[0.03]",
    ring: "bg-white/10 text-slate-200",
    badge: "slate",
    words: () => "Nothing to do",
    action: "border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10",
  },
  letter: {
    icon: FileText,
    box: "border-indigo-500/30 bg-indigo-950/30",
    ring: "bg-indigo-500/15 text-indigo-300",
    badge: "indigo",
    words: () => "A letter to read",
    action: "bg-indigo-600 text-white hover:bg-indigo-500",
  },
};

interface FindingCardProps {
  finding: Finding;
  /** Smaller, for a chat bubble; the title is then a paragraph rather than a heading. */
  compact?: boolean;
  /** The title's heading level on a page. */
  headingLevel?: "h3" | "h4";
}

export function FindingCard({ finding, compact = false, headingLevel = "h3" }: FindingCardProps) {
  const titleId = useId();
  const style = FINDING_STYLE[finding.kind] ?? FINDING_STYLE.letter;
  const Icon = style.icon;
  const Title = compact ? "p" : headingLevel;
  const toChat = finding.action.href.startsWith("#/chat");
  // A late train or a visit whose claim is already live opens Mission Control instead of the chat (findings.py under_way).
  const started = finding.action.href.startsWith("#/missions") && (finding.kind === "late_train" || finding.kind === "engineer_visit");
  return (
    <article aria-labelledby={titleId} data-kind={finding.kind} className={`rounded-2xl border ${style.box} ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-start gap-3">
        <span className={`flex shrink-0 items-center justify-center rounded-full ${style.ring} ${compact ? "h-8 w-8" : "h-10 w-10"}`}>
          <Icon size={compact ? 16 : 20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <Badge tone={style.badge}>{style.words(finding.amount_gbp ?? null, started)}</Badge>
          <Title id={titleId} className={`mt-1 break-words font-semibold text-slate-50 ${compact ? "text-sm" : "text-base"}`}>
            {finding.title}
          </Title>
          <p className="mt-1 break-words text-sm leading-relaxed text-slate-300">{finding.why}</p>
          <p className="mt-1.5 break-words text-xs text-slate-400">{sourceLine(finding)}</p>
          <a
            {...linkProps(finding.action.href)}
            aria-describedby={titleId}
            className={`mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors motion-reduce:transition-none ${style.action} ${FOCUS}`}
          >
            {toChat ? <MessageCircle size={14} aria-hidden /> : <ArrowRight size={14} aria-hidden />}
            {finding.action.label}
          </a>
        </div>
      </div>
    </article>
  );
}
