import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils.ts";

type CardElement = "div" | "section" | "article" | "li" | "aside";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: CardElement;
  /** A stronger shadow for something that sits above the page, such as an approval. */
  raised?: boolean;
  /** No inner padding, for cards that hold their own rows. */
  flush?: boolean;
}

/** The rounded surface everything sits on. */
export function Card({ as: Tag = "div", raised, flush, className, ...props }: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-card bg-card text-ink",
        raised ? "shadow-raised" : "shadow-card",
        flush ? "" : "p-4 sm:p-5",
        className,
      )}
      {...props}
    />
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** The heading level in the page outline. Defaults to 2: cards sit under the page's h1. */
  level?: 2 | 3 | 4;
  id?: string;
  className?: string;
}

export function CardHeader({ title, description, actions, level = 2, id, className }: CardHeaderProps) {
  const Heading = `h${level}` as const;
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0 flex-1">
        <Heading id={id} className="font-semibold text-title text-ink">
          {title}
        </Heading>
        {description ? <p className="mt-1 text-ink-2 text-sub">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A hairline between rows or sections of a card. */
export function Rule({ className }: { className?: string }) {
  return <hr className={cn("my-0 border-0 border-hair border-t", className)} />;
}
