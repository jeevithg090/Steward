// ⌘K (plan.md §15.2 S2): every page and the common actions from one box, keyboard first.
// A modal dialog with a combobox and a listbox (the WAI-ARIA pattern): arrows move, Enter runs,
// Escape closes, and focus goes back where it was.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, BookOpen, CornerDownLeft, Eye, Plus, Search, Type, Waves } from "lucide-react";
import { getPrefs, setPrefs, type TextSize } from "@/lib/a11y-prefs";
import { navigate } from "@/router";
import { Kbd } from "../ui/Kbd";
import { NAV_ALL } from "./nav";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: "Go to" | "Do" | "Ask Tempo" | "Comfort";
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

const REDUCE_MOTION_KEY = "tempo.reduceMotion";
const NEXT_SIZE: Record<TextSize, TextSize> = { default: "large", large: "larger", larger: "default" };

function reduceMotionOn(): boolean {
  return document.documentElement.hasAttribute("data-reduce-motion");
}

function setReduceMotion(on: boolean): void {
  try {
    localStorage.setItem(REDUCE_MOTION_KEY, on ? "1" : "0");
  } catch {
    /* the setting still applies to this page */
  }
  if (on) document.documentElement.setAttribute("data-reduce-motion", "");
  else document.documentElement.removeAttribute("data-reduce-motion");
}

/** The built-in commands; `extra` adds the app's own (e.g. a new chat, prompts for the chat). */
export function baseCommands(extra: Command[] = []): Command[] {
  const pages: Command[] = NAV_ALL.map((entry) => ({
    id: `go:${entry.to}`,
    label: entry.label,
    hint: entry.hint,
    group: "Go to",
    icon: <entry.Icon size={16} strokeWidth={1.75} aria-hidden />,
    run: () => navigate(entry.to),
  }));
  const prefs = getPrefs();
  const comfort: Command[] = [
    {
      id: "comfort:text",
      label: prefs.textSize === "larger" ? "Text size: back to normal" : "Make the text larger",
      group: "Comfort",
      icon: <Type size={16} aria-hidden />,
      keywords: "font zoom bigger accessibility",
      run: () => setPrefs({ textSize: NEXT_SIZE[getPrefs().textSize] }),
    },
    {
      id: "comfort:plain",
      label: prefs.plain ? "Plain mode off" : "Plain mode on (bigger buttons, fewer extras)",
      group: "Comfort",
      icon: <Eye size={16} aria-hidden />,
      keywords: "simple accessibility",
      run: () => setPrefs({ plain: !getPrefs().plain }),
    },
    {
      id: "comfort:motion",
      label: reduceMotionOn() ? "Motion back on" : "Reduce motion",
      group: "Comfort",
      icon: <Waves size={16} aria-hidden />,
      keywords: "animation accessibility",
      run: () => setReduceMotion(!reduceMotionOn()),
    },
  ];
  const demo: Command = {
    id: "do:story",
    label: "Start the guided demo",
    hint: "Ten beats, each one real",
    group: "Do",
    icon: <BookOpen size={16} aria-hidden />,
    keywords: "tour walkthrough",
    run: () => navigate("/story"),
  };
  return [...extra, demo, ...pages, ...comfort];
}

export function newChatCommand(onNewChat: () => void): Command {
  return { id: "do:new", label: "New chat", group: "Do", icon: <Plus size={16} aria-hidden />, keywords: "start conversation", run: onNewChat };
}

/** A simple, forgiving match: every word typed appears somewhere in the label, hint or keywords. */
export function matches(command: Command, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${command.label} ${command.hint ?? ""} ${command.keywords ?? ""} ${command.group}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const opener = useRef<Element | null>(null);
  const ids = useId();

  const results = useMemo(() => commands.filter((c) => matches(c, query)), [commands, query]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    setQuery("");
    setActive(0);
    requestAnimationFrame(() => input.current?.focus());
    return () => (opener.current as HTMLElement | null)?.focus?.();
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault(); // the dialog keeps focus in its one field
    }
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" onKeyDown={onKey}>
      <button aria-label="Close the command menu" tabIndex={-1} className="absolute inset-0 bg-ink/70 backdrop-blur-sm motion-safe:animate-fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search pages and actions"
        className="glass-strong relative w-full max-w-xl overflow-hidden rounded-3xl motion-safe:animate-scale-in"
      >
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-5">
          <Search size={18} className="shrink-0 text-slate-500" aria-hidden />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${ids}-list`}
            aria-activedescendant={results[active] ? `${ids}-${results[active].id}` : undefined}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages and actions…"
            className="h-14 w-full bg-transparent text-[15px] text-white placeholder:text-slate-500 focus:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul ref={list} id={`${ids}-list`} role="listbox" aria-label="Results" className="max-h-[55vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-8 text-center text-sm text-slate-400">Nothing matches “{query}”.</li>}
          {results.map((command, index) => {
            const header = command.group !== lastGroup ? command.group : null;
            lastGroup = command.group;
            const on = index === active;
            return (
              <li key={command.id} role="presentation">
                {header && <p className="px-3 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500" aria-hidden>{header}</p>}
                <div
                  id={`${ids}-${command.id}`}
                  role="option"
                  aria-selected={on}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={() => run(command)}
                  className={`flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 ${on ? "bg-white/[0.07]" : ""}`}
                >
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ring-1 ring-inset ${on ? "bg-violet-500/20 text-violet-100 ring-violet-300/30" : "bg-white/[0.04] text-slate-400 ring-white/[0.08]"}`}>
                    {command.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-100">{command.label}</span>
                    {command.hint && <span className="block truncate text-xs text-slate-500">{command.hint}</span>}
                  </span>
                  {on && (command.group === "Go to" ? <ArrowRight size={15} className="text-slate-400" aria-hidden /> : <CornerDownLeft size={15} className="text-slate-400" aria-hidden />)}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-white/[0.07] px-5 py-2.5 text-[11px] text-slate-500">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
          <span className="ml-auto">Tempo never acts without your yes.</span>
        </div>
      </div>
    </div>
  );
}
