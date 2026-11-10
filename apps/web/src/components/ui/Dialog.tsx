import { X } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { routeFocusPending } from "@/lib/focus.ts";
import { cn } from "@/lib/utils.ts";
import { Button } from "./Button.tsx";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the dialog for screen readers and is drawn as its heading. */
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons along the bottom. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** `sheet` rises from the bottom on small screens, like a phone's own sheets. */
  placement?: "center" | "sheet";
  /** Where focus lands when it opens. Defaults to the first control inside, else the dialog. */
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute("inert") && el.getAttribute("aria-hidden") !== "true",
  );
}

/**
 * Gives focus back to what opened a dialog once the close has settled, unless something else has
 * taken it (another dialog, a control the page focused) or a new page is about to (focus after
 * navigation, `lib/focus.ts`).
 */
function giveFocusBack(opener: HTMLElement | null, dialog: HTMLDialogElement | null): void {
  if (!opener) return;
  queueMicrotask(() => {
    if (routeFocusPending() || !opener.isConnected) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || Boolean(dialog?.contains(active));
    if (lost) opener.focus();
  });
}

/**
 * A modal built on the native `<dialog>`: the page behind it is inert, Escape closes it, Tab stays
 * inside it, it is named by its title, and focus returns to whatever opened it.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  placement = "center",
  initialFocus,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // In the layout phase, so a dialog closed in the same render as a route change has let go of the
  // page before the new page's heading asks for focus.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      const target = initialFocus?.current ?? focusables(dialog).find((el) => !el.dataset.dialogClose);
      (target ?? dialog).focus();
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      giveFocusBack(returnTo.current, dialog);
      returnTo.current = null;
    }
  }, [open, initialFocus]);

  // Closing on unmount too, so the page never stays inert behind a vanished dialog.
  useEffect(
    () => () => {
      const dialog = ref.current;
      if (dialog?.open && typeof dialog.close === "function") dialog.close();
      giveFocusBack(returnTo.current, dialog);
    },
    [],
  );

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      return;
    }
    if (event.key !== "Tab" || !ref.current) return;
    const items = focusables(ref.current);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === ref.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // A click on the backdrop lands on the <dialog> itself, outside the panel.
  function onClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === ref.current) onOpenChange(false);
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-modal="true"
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClose={() => {
        if (open) onOpenChange(false);
      }}
      onKeyDown={onKeyDown}
      onClick={onClick}
      className={cn(
        "m-auto max-h-[min(90dvh,48rem)] w-[calc(100%-2rem)] overflow-visible bg-transparent p-0 text-ink backdrop:bg-black/45",
        size === "sm" && "max-w-sm",
        size === "md" && "max-w-lg",
        size === "lg" && "max-w-2xl",
        placement === "sheet" && "max-sm:mb-0 max-sm:w-full max-sm:max-w-none",
      )}
    >
      {open ? (
        <div
          className={cn(
            "flex max-h-[min(90dvh,48rem)] animate-enter flex-col overflow-hidden rounded-card bg-card shadow-raised",
            placement === "sheet" && "max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)]",
            className,
          )}
        >
          <div className="flex items-start gap-3 px-5 pt-5 pb-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="font-semibold text-title">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-ink-2 text-sub">
                  {description}
                </p>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close"
              data-dialog-close="true"
              onClick={() => onOpenChange(false)}
              className="-mt-2 -mr-2"
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer ? (
            <div className="flex flex-wrap justify-end gap-2 border-hair border-t px-5 py-3">{footer}</div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
