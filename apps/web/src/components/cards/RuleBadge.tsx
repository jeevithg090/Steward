import type { Effect, Rule } from "@steward/shared";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/Badge.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import { EFFECT_LABELS, RULE_SOURCE_LABELS } from "@/lib/labels.ts";
import { cn } from "@/lib/utils.ts";

export interface RuleBadgeProps {
  rule: Pick<Rule, "name" | "source"> & { id?: string };
  /** Also show what the rule does: Permitted, Asked, Refused. */
  effect?: Effect;
  className?: string;
}

/** Names a rule and where it came from: "Ask before paying · Built in". */
export function RuleBadge({ rule, effect, className }: RuleBadgeProps) {
  const effectLabel = effect ? EFFECT_LABELS[effect] : undefined;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5 align-middle", className)}>
      <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
      <span className="font-medium text-ink">{rule.name}</span>
      <Badge>{RULE_SOURCE_LABELS[rule.source] ?? rule.source}</Badge>
      {effectLabel ? <Pill tone={effectLabel.tone}>{effectLabel.label}</Pill> : null}
    </span>
  );
}
