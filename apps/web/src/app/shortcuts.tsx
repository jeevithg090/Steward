import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { Dialog } from "@/components/ui/Dialog.tsx";
import { Kbd } from "@/components/ui/Kbd.tsx";
import { isTypingTarget } from "@/lib/utils.ts";
import { useAccessibility } from "./accessibility.tsx";
import { NAV_ITEMS } from "./nav.ts";

/** How long after `g` the second key still counts. */
const SEQUENCE_MS = 1500;

/**
 * Two-key shortcuts in the style of GitHub and Gmail: `g` then a letter goes somewhere, `?` opens
 * the list. They never fire while the person is typing, or with Ctrl, Alt or Cmd held, so they never
 * steal a screen reader's or the browser's own keys. Settings → Accessibility turns them off, for
 * voice control and switch access, which type letters of their own.
 */
export function useShortcuts({ onHelp }: { onHelp: () => void }): void {
  const navigate = useNavigate();
  const { shortcuts: enabled } = useAccessibility();
  const pendingG = useRef(0);
  const onHelpRef = useRef(onHelp);
  onHelpRef.current = onHelp;

  useEffect(() => {
    if (!enabled) return;
    pendingG.current = 0;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector("dialog[open]")) return;

      if (event.key === "?") {
        event.preventDefault();
        onHelpRef.current();
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "g" && !event.shiftKey) {
        pendingG.current = Date.now();
        return;
      }
      if (pendingG.current && Date.now() - pendingG.current < SEQUENCE_MS) {
        pendingG.current = 0;
        const item = NAV_ITEMS.find((n) => n.shortcut === key);
        if (item) {
          event.preventDefault();
          navigate(item.to);
        }
        return;
      }
      pendingG.current = 0;
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, enabled]);
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const items = NAV_ITEMS.filter((n) => n.shortcut);
  const { shortcuts: enabled } = useAccessibility();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      description={
        enabled
          ? "Press g, let go, then the letter. They don't fire while you are typing."
          : "Shortcuts are off on this device, so these keys do nothing."
      }
      size="sm"
    >
      <p className="mb-4 text-ink-2 text-sub">
        {enabled
          ? "Using voice control? You can turn them off in Settings, under Accessibility."
          : "Turn them on in Settings, under Accessibility."}
      </p>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-sub">
        {items.map((item) => (
          <div key={item.to} className="contents">
            <dt className="flex items-center gap-1">
              <Kbd>g</Kbd>
              <span className="sr-only">then</span>
              <Kbd>{item.shortcut}</Kbd>
            </dt>
            <dd>Go to {item.label}</dd>
          </div>
        ))}
        <div className="contents">
          <dt>
            <Kbd>?</Kbd>
          </dt>
          <dd>Show this list</dd>
        </div>
        <div className="contents">
          <dt>
            <Kbd>Esc</Kbd>
          </dt>
          <dd>Close a dialog</dd>
        </div>
      </dl>
    </Dialog>
  );
}
