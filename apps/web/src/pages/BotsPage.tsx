import { BOT_CATEGORIES, type BotCategory, type BotListing, type InstalledBot } from "@steward/shared";
import { Bot, RefreshCw, Trash, WandSparkles } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { BotCard } from "@/components/bots/BotCard.tsx";
import { BotActions, BotListingView, useListingPreview } from "@/components/bots/BotListingView.tsx";
import { categoryLabel } from "@/components/bots/bots.ts";
import { MakeBotDialog } from "@/components/bots/MakeBotDialog.tsx";
import { Badge } from "@/components/ui/Badge.tsx";
import { Button, LinkButton } from "@/components/ui/Button.tsx";
import { Card } from "@/components/ui/Card.tsx";
import { Dialog } from "@/components/ui/Dialog.tsx";
import { EmptyState } from "@/components/ui/EmptyState.tsx";
import { ChoiceGroup, Field, Input, Select } from "@/components/ui/Field.tsx";
import { ErrorNotice, Loading } from "@/components/ui/Notice.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import {
  type BotsQueryInput,
  useBots,
  useInfo,
  useInstalledBots,
  useRemoveBot,
  useUpdateBot,
} from "@/lib/api.ts";
import { plural } from "@/lib/utils.ts";

/**
 * `/bots`: the directory. Search and browse by job, see what is already added, and add a bot after
 * reading what it may do. The search, category and sort live in the address, so Back and a shared
 * link bring the same view.
 */

type Sort = "match" | "new" | "used";

const SORTS: { value: Sort; label: string }[] = [
  { value: "match", label: "Best match" },
  { value: "new", label: "Newest" },
  { value: "used", label: "Most used" },
];

/** How long typing settles before the directory is asked. */
const SEARCH_DELAY_MS = 250;
const PAGE_SIZE = 60;

function isSort(value: string | null): value is Sort {
  return value === "match" || value === "new" || value === "used";
}

function isCategory(value: string | null): value is BotCategory {
  return Boolean(value) && Object.hasOwn(BOT_CATEGORIES, value as string);
}

export function BotsPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const category = isCategory(params.get("category")) ? (params.get("category") as BotCategory) : undefined;
  const sort: Sort = isSort(params.get("sort")) ? (params.get("sort") as Sort) : "match";
  const filtering = q !== "" || category !== undefined;

  const info = useInfo();
  const installed = useInstalledBots();
  const query: BotsQueryInput = {
    ...(q ? { q } : {}),
    ...(category ? { category } : {}),
    sort,
    limit: PAGE_SIZE,
  };
  const browse = useBots(query);
  // Suggested for you: inbox bots when mail is connected, everyday ones otherwise.
  const suggestedCategory: BotCategory = info.data?.mail.connected ? "productivity" : "misc";
  const suggested = useBots({ category: suggestedCategory, sort: "used", limit: 4 }, { enabled: !filtering });

  const [opened, setOpened] = useState<BotListing | undefined>();
  const [making, setMaking] = useState(false);

  const categories = browse.data?.categories ?? (BOT_CATEGORIES as Record<string, string>);
  const installedById = new Map((installed.data ?? []).map((bot) => [bot.id, bot]));

  const set = useCallback(
    (next: Partial<{ q: string; category: string; sort: Sort }>) => {
      setParams(
        (current) => {
          const out = new URLSearchParams(current);
          for (const [key, value] of Object.entries(next)) {
            if (value) out.set(key, value);
            else out.delete(key);
          }
          return out;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const suggestions = (suggested.data?.bots ?? []).filter((bot) => !installedById.has(bot.id)).slice(0, 4);
  const results = browse.data?.bots ?? [];
  const makeCard = (
    <Card
      as="article"
      aria-label="Make a bot"
      className="flex h-full flex-col gap-2 border border-hair border-dashed shadow-none"
    >
      <h3 className="m-0 font-semibold text-body text-ink">Make a bot</h3>
      <p className="m-0 flex-1 text-ink text-sub">
        Say what it should do. Steward writes the pack and shows it to you before anything is added.
      </p>
      <div>
        <Button variant="primary" size="sm" icon={<WandSparkles />} onClick={() => setMaking(true)}>
          Make a bot
        </Button>
      </div>
    </Card>
  );

  return (
    <Page
      title="Bots"
      width="wide"
      description={
        <p>
          Ready-made helpers, one job each. Add one and it becomes someone you can pick in a new conversation.
          Every bot works through your rules: it can ask or refuse more than you do, never less.
        </p>
      }
      actions={
        <Button variant="primary" icon={<WandSparkles />} onClick={() => setMaking(true)}>
          Make a bot
        </Button>
      }
    >
      <Filters q={q} category={category} sort={sort} categories={categories} onChange={set} />

      {!filtering && installed.data && installed.data.length > 0 ? (
        <InstalledSection bots={installed.data} />
      ) : null}

      {!filtering && suggestions.length > 0 ? (
        <Section
          title="Suggested for you"
          caption={
            info.data?.mail.connected ? "Because your mail is connected." : "Everyday jobs to start with."
          }
        >
          <Grid>
            {suggestions.map((bot) => (
              <li key={bot.id}>
                <BotCard listing={bot} categories={categories} onAdd={setOpened} />
              </li>
            ))}
          </Grid>
        </Section>
      ) : null}

      <Section
        title={filtering ? "Results" : "Browse"}
        caption={
          browse.data
            ? `${plural(browse.data.total ?? results.length, "bot")}${category ? ` in ${categoryLabel(category, categories)}` : ""}${q ? ` for “${q}”` : ""}`
            : undefined
        }
      >
        {browse.isPending ? (
          <Loading>Loading the directory…</Loading>
        ) : browse.isError ? (
          <ErrorNotice
            title="Couldn't load the directory"
            error={browse.error}
            onRetry={() => void browse.refetch()}
          />
        ) : results.length === 0 ? (
          <EmptyState
            icon={Bot}
            level={3}
            title={filtering ? "No bots match" : "The directory is empty"}
            action={
              <Button variant="primary" icon={<WandSparkles />} onClick={() => setMaking(true)}>
                Make a bot
              </Button>
            }
          >
            {filtering
              ? "Try other words, or make a bot for this job yourself."
              : "Make the first one: say what it should do and Steward writes it."}
          </EmptyState>
        ) : (
          <Grid>
            {results.map((bot) => (
              <li key={bot.id}>
                <BotCard
                  listing={bot}
                  categories={categories}
                  installed={installedById.get(bot.id)}
                  onAdd={setOpened}
                />
              </li>
            ))}
            <li>{makeCard}</li>
          </Grid>
        )}
      </Section>

      <Dialog
        open={opened !== undefined}
        onOpenChange={(open) => !open && setOpened(undefined)}
        title={opened?.name ?? "Bot"}
        size="lg"
      >
        {opened ? (
          <ListingDialogBody key={opened.id} listing={opened} onDone={() => setOpened(undefined)} />
        ) : null}
      </Dialog>

      <MakeBotDialog open={making} onOpenChange={setMaking} />
    </Page>
  );
}

function Section({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div>
        <h2 id={id} className="m-0 font-semibold text-ink text-title">
          {title}
        </h2>
        {caption ? <p className="m-0 mt-0.5 text-caption text-ink-2">{caption}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">{children}</ul>
  );
}

function Filters({
  q,
  category,
  sort,
  categories,
  onChange,
}: {
  q: string;
  category: BotCategory | undefined;
  sort: Sort;
  categories: Record<string, string>;
  onChange: (next: Partial<{ q: string; category: string; sort: Sort }>) => void;
}) {
  const [text, setText] = useState(q);
  // Typing settles before the address (and the directory) hear about it.
  useEffect(() => {
    if (text === q) return;
    const timer = setTimeout(() => onChange({ q: text.trim() }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, q, onChange]);
  // The address changed from outside (Back): follow it.
  useEffect(() => {
    setText(q);
  }, [q]);

  const choices = [
    { value: "", label: "All" },
    ...Object.entries(categories).map(([value, label]) => ({ value, label })),
  ];

  return (
    <search aria-label="Find a bot" className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="What do you need a bot for?">
          <Input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Find me a flat, chase an invoice, plan the week's dinners…"
            autoComplete="off"
          />
        </Field>
        <Field label="Sort by" className="sm:w-44">
          <Select value={sort} onChange={(event) => onChange({ sort: event.target.value as Sort })}>
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ChoiceGroup
        legend="Category"
        value={category ?? ""}
        onValueChange={(value) => onChange({ category: value })}
        choices={choices}
      />
    </search>
  );
}

/** What the person has added: version, an update when the directory has one, and Remove. */
function InstalledSection({ bots }: { bots: InstalledBot[] }) {
  const list = [...bots].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Section title="Installed" caption={`${plural(list.length, "bot")} in this Steward.`}>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {list.map((bot) => (
          <li key={bot.id}>
            <InstalledRow bot={bot} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function InstalledRow({ bot }: { bot: InstalledBot }) {
  const remove = useRemoveBot();
  const update = useUpdateBot();
  const [confirming, setConfirming] = useState(false);
  const newer = bot.updateAvailable;
  return (
    <Card
      as="article"
      aria-label={bot.name}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 sm:py-3"
    >
      <div className="min-w-0 flex-1">
        <h3 className="m-0 flex flex-wrap items-center gap-2 font-semibold text-body text-ink">
          <LinkButton
            to={`/bots/${encodeURIComponent(bot.id)}`}
            variant="link"
            size="sm"
            className="text-body"
          >
            {bot.name}
          </LinkButton>
          <Badge>Version {bot.version}</Badge>
          {newer ? <Pill tone="needs">Version {newer.version} available</Pill> : null}
        </h3>
        <p className="m-0 text-caption text-ink-2">
          {plural(bot.skillIds.length, "skill")} · {plural(bot.ruleIds.length, "rule")} ·{" "}
          {bot.source === "local" ? "made here" : `from ${sourceHost(bot.source)}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <LinkButton to={`/chat?agent=${encodeURIComponent(bot.agentId)}`} size="sm">
          Talk to it
        </LinkButton>
        {newer ? (
          <Button
            variant="primary"
            size="sm"
            icon={<RefreshCw />}
            loading={update.isPending}
            aria-label={`Update ${bot.name}`}
            onClick={() =>
              update.mutate(bot.id, {
                onSuccess: (row) =>
                  toast.success("Bot updated", { description: `${row.name} is now version ${row.version}.` }),
                onError: (error) => toast.error("Couldn't update it", { description: error.message }),
              })
            }
          >
            Update
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash />}
          aria-label={`Remove ${bot.name}`}
          onClick={() => setConfirming(true)}
        >
          Remove
        </Button>
      </div>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        size="sm"
        title={`Remove ${bot.name}?`}
        description="Its skills, rules and routines go with it. Conversations you had with it stay."
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Keep it</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(bot.id, {
                  onSuccess: () => {
                    setConfirming(false);
                    toast.success("Bot removed", { description: bot.name });
                  },
                  onError: (error) => toast.error("Couldn't remove it", { description: error.message }),
                })
              }
            >
              Remove
            </Button>
          </>
        }
      />
    </Card>
  );
}

/** "bots.steward.dev" from an index address; the address itself when it is a path. */
/** Where an installed bot came from, in words: a web directory's host, or this computer's folder. */
function sourceHost(source: string): string {
  try {
    const host = new URL(source).host;
    if (host) return host;
  } catch {
    // Not a web address: a path to the directory on this machine.
  }
  return "the directory on this computer";
}

/** The listing inside the Add dialog: preview fetched on open, Add at the bottom. */
function ListingDialogBody({ listing, onDone }: { listing: BotListing; onDone: () => void }) {
  const preview = useListingPreview({ packUrl: listing.packUrl });
  const pack = preview.data?.pack;
  if (!pack) {
    return preview.isError ? (
      <ErrorNotice
        title="Couldn't load this bot"
        error={preview.error}
        onRetry={() => preview.mutate({ packUrl: listing.packUrl })}
      />
    ) : (
      <Loading>Loading {listing.name}…</Loading>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <BotListingView pack={pack} listing={listing} preview={preview.data} level={3} />
      <div className="border-hair border-t pt-4">
        <BotActions
          pack={pack}
          source={{ packUrl: listing.packUrl }}
          installed={preview.data?.alreadyInstalled}
          onCancel={onDone}
        />
      </div>
    </div>
  );
}
