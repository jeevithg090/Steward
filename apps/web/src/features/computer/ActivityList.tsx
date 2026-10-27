/**
 * What the agent did on its computer, newest first, as it happens: pages opened, clicks, commands,
 * files saved, help asked for. Output previews are short and never hold secrets or file contents.
 */
import type { ActivityItem } from "@steward/shared";
import {
  ArrowDownUp,
  CircleAlert,
  FileText,
  Globe,
  Hand,
  Keyboard,
  KeyRound,
  LifeBuoy,
  type LucideIcon,
  MousePointerClick,
  ScrollText,
  Terminal,
} from "lucide-react";
import { relativeTime } from "@/lib/utils.ts";

const ICONS: Record<ActivityItem["kind"], LucideIcon> = {
  navigate: Globe,
  click: MousePointerClick,
  type: Keyboard,
  key: Keyboard,
  scroll: ArrowDownUp,
  snapshot: ScrollText,
  file: FileText,
  shell: Terminal,
  secret: KeyRound,
  help: LifeBuoy,
  control: Hand,
};

export function ActivityList({
  items,
  emptyText = "Nothing yet. What Steward does on its computer shows up here.",
}: {
  items: ActivityItem[];
  emptyText?: string;
}) {
  if (items.length === 0) return <p className="m-0 py-6 text-center text-ink-2 text-sub">{emptyText}</p>;
  return (
    <ol aria-label="Activity on Steward's computer" className="m-0 list-none divide-y divide-hair-2 p-0">
      {items.map((item) => {
        const Icon = item.ok ? (ICONS[item.kind] ?? ScrollText) : CircleAlert;
        return (
          <li key={item.id} className="flex items-start gap-3 py-2.5">
            <span
              className={
                item.ok
                  ? "mt-0.5 grid size-7 shrink-0 place-items-center rounded-tile bg-tile text-ink-2"
                  : "mt-0.5 grid size-7 shrink-0 place-items-center rounded-tile bg-needs-soft text-needs"
              }
            >
              <Icon aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 break-words text-ink text-sub">
                {item.ok ? null : <span className="font-medium text-needs">Didn't work: </span>}
                {item.text}
              </p>
              <p className="m-0 text-caption text-ink-3">
                <time dateTime={item.at}>{relativeTime(item.at)}</time>
              </p>
              {item.output ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-caption text-ink-2">Output</summary>
                  <pre className="m-0 mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-tile bg-tile p-2 font-mono text-caption text-ink">
                    {item.output}
                  </pre>
                </details>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
