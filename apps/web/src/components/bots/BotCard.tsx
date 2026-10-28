import type { BotAuthor, BotListing, InstalledBot } from "@steward/shared";
import { Bot, Plus, UserRound } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/Badge.tsx";
import { Button, LinkButton } from "@/components/ui/Button.tsx";
import { Card } from "@/components/ui/Card.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import { cn } from "@/lib/utils.ts";
import { categoryLabel, countsLine, needsOf } from "./bots.ts";

/**
 * Who made a bot, as a pill. "AI-made" is drawn on its own neutral tone with the bot icon, so it is
 * never mistaken for a person's handle; a person's bot says "by <handle>".
 */
export function AuthorPill({ author, className }: { author: BotAuthor | undefined; className?: string }) {
  if (!author) return null;
  if (author.kind === "ai") {
    return (
      <Badge tone="neutral" className={cn("gap-1", className)}>
        <Bot aria-hidden="true" className="size-3.5" />
        AI-made
      </Badge>
    );
  }
  return (
    <Badge tone="accent" className={cn("gap-1", className)}>
      <UserRound aria-hidden="true" className="size-3.5" />
      by {author.handle}
    </Badge>
  );
}

/** What a bot reaches, as icons with their words beside them. */
export function NeedsRow({
  needs,
  className,
}: {
  needs: BotListing["needs"] | undefined;
  className?: string;
}) {
  const items = needsOf(needs);
  return (
    <ul className={cn("m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-caption text-ink-2", className)}>
      {items.map((need) => {
        const Icon = need.icon;
        return (
          <li key={need.key} className="inline-flex items-center gap-1">
            <Icon aria-hidden="true" className="size-3.5 shrink-0" />
            {need.label}
          </li>
        );
      })}
    </ul>
  );
}

export interface BotCardProps {
  listing: BotListing;
  categories?: Record<string, string>;
  /** Set when this bot is already in this Steward. */
  installed?: InstalledBot;
  /** Opens the listing with "Add to Steward". */
  onAdd: (listing: BotListing) => void;
}

/** One bot in the directory: enough to decide whether to open it. */
export function BotCard({ listing, categories, installed, onAdd }: BotCardProps) {
  const href = `/bots/${encodeURIComponent(listing.id)}`;
  return (
    <Card as="article" aria-label={listing.name} className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="m-0 min-w-0 font-semibold text-body text-ink">
          <Link to={href} className="no-underline hover:underline">
            {listing.name}
          </Link>
        </h3>
        <Badge>{categoryLabel(listing.category, categories)}</Badge>
      </div>
      <p className="m-0 flex-1 text-ink text-sub">{listing.pitch}</p>
      <div className="flex flex-wrap items-center gap-2 text-caption text-ink-2">
        <AuthorPill author={listing.author} />
        <span>{countsLine(listing)}</span>
      </div>
      <NeedsRow needs={listing.needs} />
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {installed ? (
          <>
            <Pill tone="done">Added</Pill>
            <LinkButton to={`/chat?agent=${encodeURIComponent(installed.agentId)}`} size="sm">
              Talk to it
            </LinkButton>
          </>
        ) : (
          <Button
            variant="primary"
            size="sm"
            icon={<Plus />}
            onClick={() => onAdd(listing)}
            aria-label={`Add ${listing.name}`}
          >
            Add
          </Button>
        )}
        <LinkButton to={href} variant="ghost" size="sm" aria-label={`View ${listing.name}`}>
          View
        </LinkButton>
      </div>
    </Card>
  );
}
