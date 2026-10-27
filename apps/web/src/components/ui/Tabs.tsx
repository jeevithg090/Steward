import type { LucideIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";
import { cn } from "@/lib/utils.ts";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  /** Shown after the label and read with it: "Needs you 3". */
  count?: number;
  icon?: LucideIcon;
}

export interface TabsProps<T extends string> {
  /** Names the tab list for screen readers, e.g. "Task status". */
  label: string;
  items: TabItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** The selected tab's panel. Omit when the tabs only filter content rendered elsewhere. */
  children?: ReactNode;
  className?: string;
}

/**
 * A segmented control with real tab semantics. Roving tabindex: Tab reaches the selected tab once,
 * the arrow keys (and Home/End) move between tabs and select as they go.
 */
export function Tabs<T extends string>({
  label,
  items,
  value,
  onValueChange,
  children,
  className,
}: TabsProps<T>) {
  const baseId = useId();
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  const tabId = (v: string) => `${baseId}-tab-${v}`;
  const panelId = `${baseId}-panel`;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    const item = items[next]!;
    onValueChange(item.value);
    tabs.current.get(item.value)?.focus();
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className="-mx-1 flex snap-x gap-1 overflow-x-auto rounded-field bg-tile p-1 [scrollbar-width:none]"
      >
        {items.map((item, index) => {
          const selected = item.value === value;
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              ref={(el) => {
                if (el) tabs.current.set(item.value, el);
                else tabs.current.delete(item.value);
              }}
              id={tabId(item.value)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={children ? panelId : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => onValueChange(item.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "inline-flex min-h-target shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-[calc(var(--st-radius-field)-0.25rem)] px-3 font-medium text-sub",
                "transition-[background-color,color,box-shadow] duration-(--st-dur-swap) ease-out-soft",
                selected ? "bg-card text-ink shadow-card" : "text-ink-2 hover:text-ink",
              )}
            >
              {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
              {item.label}
              {item.count !== undefined ? (
                <>
                  {" "}
                  <span
                    className={cn(
                      "min-w-6 rounded-full px-1.5 text-center text-caption tabular-nums",
                      selected ? "bg-accent-soft text-accent" : "bg-card/70 text-ink-2",
                    )}
                  >
                    {item.count}
                  </span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
      {children ? (
        <div role="tabpanel" id={panelId} aria-labelledby={tabId(value)} className="mt-4">
          {children}
        </div>
      ) : null}
    </div>
  );
}
