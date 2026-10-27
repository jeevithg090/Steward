import { type ReactNode, useEffect, useRef } from "react";
import { claimRouteFocus } from "@/lib/focus.ts";
import { cn } from "@/lib/utils.ts";

/** Sets the tab title: "Tasks · Steward". */
export function useDocumentTitle(title: string | undefined, product = "Steward"): void {
  useEffect(() => {
    if (!title) return;
    document.title = title === product ? product : `${title} · ${product}`;
  }, [title, product]);
}

export interface PageHeaderProps {
  /** The page's one h1. */
  title: ReactNode;
  /** Plain text for the browser tab, when `title` is not a string. */
  documentTitle?: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** The page's heading. It sets the tab title and takes focus after a route change. */
export function PageHeader({ title, documentTitle, description, actions, className }: PageHeaderProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  useDocumentTitle(documentTitle ?? (typeof title === "string" ? title : undefined));

  useEffect(() => {
    if (claimRouteFocus()) ref.current?.focus({ preventScroll: false });
  }, []);

  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0 flex-1">
        <h1 ref={ref} id="page-title" tabIndex={-1} className="font-semibold text-display text-ink">
          {title}
        </h1>
        {description ? <div className="measure mt-2 text-ink-2 text-sub">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export interface PageProps extends PageHeaderProps {
  children: ReactNode;
  /** `narrow` for reading (Today, Settings), `wide` for tables (Record, Connections). */
  width?: "narrow" | "wide";
}

/** A page's frame: centred column, consistent gutters, the header and then the content. */
export function Page({ children, width = "narrow", ...header }: PageProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 pt-6 pb-10 sm:px-6 lg:px-10 lg:pt-10",
        width === "narrow" ? "max-w-3xl" : "max-w-5xl",
      )}
    >
      <PageHeader {...header} />
      <div className="mt-6 flex flex-col gap-6 lg:mt-8">{children}</div>
    </div>
  );
}
