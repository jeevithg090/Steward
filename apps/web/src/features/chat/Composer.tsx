/**
 * Where the person writes to Steward. Enter sends, Shift+Enter adds a line. Typing `/` lists the
 * skills; the arrow keys choose and Enter or Tab picks one. The microphone dictates into the box
 * (nothing is sent until the person sends it). While a reply runs, Stop ends it; while an approval
 * waits, sending waits too, and the composer says why and offers a way to the request.
 */
import { ArrowUp, Mic, MicOff, Square } from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { useSkills } from "@/lib/api.ts";
import { cn } from "@/lib/utils.ts";
import { useDictation } from "../voice/useDictation.ts";
import { matchSkills, slashQuery } from "./skill-match.ts";

export interface ComposerProps {
  onSend: (text: string) => void;
  onStop: () => void;
  running: boolean;
  /** Why sending is not possible right now, shown under the box. */
  blockedReason?: string;
  /** Moves focus to whatever is blocking, such as the approval card. */
  onShowBlocker?: () => void;
  /** A line under the box, such as the scripted model's label. */
  footnote?: string;
  /** The text box, for a caller that moves focus to it. */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  className?: string;
}

const MAX_ROWS_PX = 240;

export function Composer({
  onSend,
  onStop,
  running,
  blockedReason,
  onShowBlocker,
  footnote,
  inputRef,
  className,
}: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState(0);
  const [pickerClosed, setPickerClosed] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const textRef = inputRef ?? ownRef;
  const ids = { input: useId(), list: useId(), note: useId(), status: useId() };
  const skills = useSkills();

  const dictation = useDictation({
    onFinal: (words) =>
      setDraft((current) => (current.trim() ? `${current.replace(/\s+$/, "")} ${words}` : words)),
  });

  const query = slashQuery(draft);
  const matches = query !== undefined && !pickerClosed ? matchSkills(skills.data ?? [], query) : [];
  const pickerOpen = matches.length > 0;
  const blocked = Boolean(blockedReason);
  const canSend = !running && !blocked && draft.trim() !== "";

  // Grow with the text, up to a limit, then scroll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the height follows the draft.
  useEffect(() => {
    const box = textRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, MAX_ROWS_PX)}px`;
  }, [draft]);

  function send() {
    if (!canSend) return;
    if (dictation.listening) dictation.stop();
    onSend(draft.trim());
    setDraft("");
    setPickerClosed(false);
  }

  function pick(name: string) {
    setDraft(`/${name} `);
    setPickerClosed(true);
    setActive(0);
    textRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (pickerOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((current) => (current + step + matches.length) % matches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const choice = matches[Math.min(active, matches.length - 1)];
        if (choice) {
          event.preventDefault();
          pick(choice.name);
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setPickerClosed(true);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  function toggleMic() {
    if (!dictation.supported) {
      setVoiceNote(dictation.error ?? "Voice input isn't available in this browser.");
      return;
    }
    setVoiceNote(null);
    dictation.toggle();
  }

  const activeId = pickerOpen ? `${ids.list}-${Math.min(active, matches.length - 1)}` : undefined;
  const describedBy = [blocked ? ids.note : null, ids.status].filter(Boolean).join(" ");
  const voiceMessage = voiceNote ?? (dictation.supported ? dictation.error : null);

  return (
    <div className={cn("relative", className)}>
      {pickerOpen ? (
        <div className="absolute right-0 bottom-full left-0 z-10 mb-2 overflow-hidden rounded-card border border-hair bg-card shadow-raised">
          <p className="m-0 border-hair-2 border-b px-4 py-2 text-caption text-ink-2">Skills</p>
          <div id={ids.list} role="listbox" aria-label="Skills" className="max-h-72 overflow-auto p-1">
            {matches.map((skill, index) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the arrow keys and Enter in the text box choose an option.
              <div
                key={skill.id}
                id={`${ids.list}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(skill.name)}
                className={cn(
                  "flex min-h-target cursor-pointer flex-col justify-center rounded-tile px-3 py-1.5",
                  index === active ? "bg-accent-soft" : "hover:bg-tile",
                )}
              >
                <span className="font-medium font-mono text-ink text-sub">/{skill.name}</span>
                <span className="line-clamp-1 text-caption text-ink-2">{skill.description}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "flex items-end gap-2 rounded-card border bg-card p-2 shadow-card",
          "focus-within:border-focus focus-within:shadow-[0_0_0_1px_var(--st-focus)]",
          blocked ? "border-needs" : "border-hair",
        )}
      >
        <label htmlFor={ids.input} className="sr-only">
          Message Steward
        </label>
        <textarea
          ref={textRef}
          id={ids.input}
          rows={1}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setActive(0);
            if (!event.target.value.startsWith("/")) setPickerClosed(false);
          }}
          onKeyDown={onKeyDown}
          placeholder={running ? "Steward is working…" : "Ask Steward, or type / for a skill"}
          aria-describedby={describedBy || undefined}
          aria-autocomplete="list"
          aria-controls={pickerOpen ? ids.list : undefined}
          aria-activedescendant={activeId}
          className="max-h-60 min-h-target min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-body text-ink outline-none placeholder:text-ink-3"
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={dictation.listening ? "Stop listening" : "Speak your message"}
          aria-pressed={dictation.listening}
          title={dictation.supported ? "Uses your browser's speech service" : undefined}
          onClick={toggleMic}
          className={cn(dictation.listening && "bg-problem-soft text-problem")}
        >
          {dictation.listening ? <MicOff aria-hidden /> : <Mic aria-hidden />}
        </Button>
        {running ? (
          <Button variant="secondary" size="icon" aria-label="Stop Steward" onClick={onStop}>
            <Square aria-hidden className="fill-current" />
          </Button>
        ) : (
          <Button variant="primary" size="icon" aria-label="Send" disabled={!canSend} onClick={send}>
            <ArrowUp aria-hidden />
          </Button>
        )}
      </div>

      {dictation.listening ? (
        <p className="m-0 mt-1.5 px-2 text-caption text-ink-2">
          <span className="font-medium text-problem">Listening… </span>
          {dictation.interim}
        </p>
      ) : null}
      <p id={ids.status} role="status" className="sr-only">
        {dictation.listening ? "Listening." : ""}
        {pickerOpen
          ? ` ${matches.length} ${matches.length === 1 ? "skill matches" : "skills match"}. Use the up and down arrows to choose.`
          : ""}
      </p>
      {voiceMessage ? (
        <p role="alert" className="m-0 mt-1.5 px-2 text-caption text-needs">
          {voiceMessage}
        </p>
      ) : null}
      {blocked ? (
        <p
          id={ids.note}
          className="m-0 mt-1.5 flex flex-wrap items-center gap-x-2 px-2 text-caption text-needs"
        >
          {blockedReason}
          {onShowBlocker ? (
            <Button variant="link" size="sm" className="text-caption" onClick={onShowBlocker}>
              Go to the request
            </Button>
          ) : null}
        </p>
      ) : null}
      {footnote ? <p className="m-0 mt-1.5 px-2 text-caption text-ink-3">{footnote}</p> : null}
    </div>
  );
}
