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
  /** The status rail on the left edge. */
  rail: string;
  /** The icon's tile. */
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
    box: "border-gold-400/25 bg-gradient-to-b from-gold-400/[0.08] to-gold-400/[0.01]",
    rail: "bg-gold-400",
    ring: "bg-gold-400/15 text-gold-200 ring-gold-400/30",
    badge: "gold",
    words: (amount, started) => (started ? (amount ? `£${amount} claim started` : "Claim started") : amount ? `£${amount} to claim` : "Money to claim"),
    action: "bg-gradient-to-b from-gold-300 to-gold-400 text-ink shadow-[0_1px_0_0_rgb(255_255_255/0.5)_inset,0_10px_28px_-12px_rgb(245_181_68/0.8)] hover:from-gold-200 hover:to-gold-300",
  },
  engineer_visit: {
    icon: CircleHelp,
    box: "border-amber-400/20 bg-gradient-to-b from-amber-500/[0.07] to-amber-500/[0.01]",
    rail: "bg-amber-400",
    ring: "bg-amber-500/15 text-amber-200 ring-amber-400/30",
    badge: "amber",
    words: (_amount, started) => (started ? "Claim started" : "A question for you"),
    action: "border border-amber-300/30 bg-amber-400/[0.12] text-amber-50 hover:bg-amber-400/20",
  },
  scam: {
    icon: ShieldAlert,
    box: "border-rose-400/25 bg-gradient-to-b from-rose-500/[0.09] to-rose-500/[0.01]",
    rail: "bg-rose-400",
    ring: "bg-rose-500/15 text-rose-200 ring-rose-400/30",
    badge: "rose",
    words: () => "A trick: don't click",
    action: "bg-gradient-to-b from-rose-600 to-rose-700 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.18)_inset,0_10px_26px_-12px_rgb(244_63_94/0.7)] hover:from-rose-500 hover:to-rose-700",
  },
  money_arrived: {
    icon: CircleCheck,
    box: "border-emerald-400/20 bg-gradient-to-b from-emerald-500/[0.06] to-transparent",
    rail: "bg-emerald-400",
    ring: "bg-emerald-500/15 text-emerald-200 ring-emerald-400/30",
    badge: "emerald",
    words: () => "Nothing to do",
    action: "border border-white/10 bg-white/[0.05] text-slate-100 hover:border-white/20 hover:bg-white/[0.09]",
  },
  letter: {
    icon: FileText,
    box: "border-violet-400/25 bg-gradient-to-b from-violet-500/[0.09] to-violet-500/[0.01]",
    rail: "bg-violet-400",
    ring: "bg-violet-500/15 text-violet-200 ring-violet-400/30",
    badge: "indigo",
    words: () => "A letter to read",
    action: "bg-gradient-to-b from-violet-600 to-violet-700 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.22)_inset,0_10px_28px_-12px_rgb(124_58_237/0.9)] hover:from-violet-500 hover:to-violet-700",
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
  // Money in gold: what can come back, or what already did.
  const amount = finding.amount_gbp && (finding.kind === "late_train" || finding.kind === "money_arrived") ? finding.amount_gbp : null;
  return (
    <article aria-labelledby={titleId} data-kind={finding.kind} className={`relative h-full overflow-hidden rounded-2xl border ${style.box} ${compact ? "p-3 pl-4" : "p-4 pl-5 lg:p-5 lg:pl-6"}`}>
      <span aria-hidden className={`absolute inset-y-3 left-0 w-[3px] rounded-r-full ${style.rail}`} />
      <div className="flex items-start gap-3">
        <span aria-hidden className={`grid shrink-0 place-items-center rounded-xl ring-1 ring-inset ${style.ring} ${compact ? "h-8 w-8" : "h-10 w-10"}`}>
          <Icon size={compact ? 16 : 19} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <Badge tone={style.badge} dot>
              {style.words(finding.amount_gbp ?? null, started)}
            </Badge>
            {amount && !compact && (
              <span aria-hidden className="num text-gold text-2xl font-semibold leading-none tracking-[-0.02em]">
                £{amount}
              </span>
            )}
          </div>
          <Title id={titleId} className={`mt-2 break-words font-semibold leading-snug text-white ${compact ? "text-sm" : "text-[15px]"}`}>
            {finding.title}
          </Title>
          <p className={`mt-1 break-words leading-relaxed text-slate-300 ${compact ? "text-[13px]" : "text-sm"}`}>{finding.why}</p>
          <p className="mt-2 break-words text-xs text-slate-400">{sourceLine(finding)}</p>
          <a
            {...linkProps(finding.action.href)}
            aria-describedby={titleId}
            className={`mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-sm font-medium transition-[background-color,box-shadow,border-color] duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 ${style.action} ${FOCUS}`}
          >
            {toChat ? <MessageCircle size={14} aria-hidden /> : <ArrowRight size={14} aria-hidden />}
            {finding.action.label}
          </a>
        </div>
      </div>
    </article>
  );
}
