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
import { ErrorNotice, Loading, Notice } from "@/components/ui/Notice.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import {
  type BotsQueryInput,
  useBotPages,
  useBots,
  useInfo,
  useInstalledBots,
  useRemoveBot,
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
/** Bots per page; "Show more" asks for the next page. */
const PAGE_SIZE = 60;
/** How to build the bundled directory, for a Steward run from its repository. */
const BUILD_COMMAND = "pnpm --filter @steward/bots-gen seed build";

function isSort(value: string | null): value is Sort {
  return value === "match" || value === "new" || value === "used";
}

function isCategory(value: string | null): value is BotCategory {
  return Boolean(value) && Object.hasOwn(BOT_CATEGORIES, value as string);
}

type Need = NonNullable<BotsQueryInput["needs"]>;

/** What a bot reaches, for the filter: the words on the choice and in the results line. */
const NEEDS: { value: Need; label: string; caption: string }[] = [
  { value: "mail", label: "Your mail", caption: "using your mail" },
  { value: "calendar", label: "Your calendar", caption: "using your calendar" },
  { value: "browser", label: "Its browser", caption: "using a browser" },
  { value: "none", label: "Chat only", caption: "for chat only" },
];

function isNeed(value: string | null): value is Need {
  return NEEDS.some((need) => need.value === value);
}

export function BotsPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const category = isCategory(params.get("category")) ? (params.get("category") as BotCategory) : undefined;
  const sort: Sort = isSort(params.get("sort")) ? (params.get("sort") as Sort) : "match";
  const needs = isNeed(params.get("needs")) ? (params.get("needs") as Need) : undefined;
  const filtering = q !== "" || category !== undefined || needs !== undefined;

  const info = useInfo();
  const installed = useInstalledBots();
  const query: Omit<BotsQueryInput, "offset"> = {
    ...(q ? { q } : {}),
    ...(category ? { category } : {}),
    ...(needs ? { needs } : {}),
    sort,
    limit: PAGE_SIZE,
  };
  const browse = useBotPages(query);
  const first = browse.data?.pages[0];
  // Suggested for you: inbox bots when mail is connected, everyday ones otherwise.
  const suggestedCategory: BotCategory = info.data?.mail.connected ? "productivity" : "misc";
  const suggested = useBots({ category: suggestedCategory, sort: "used", limit: 4 }, { enabled: !filtering });

  const [opened, setOpened] = useState<BotListing | undefined>();
  const [making, setMaking] = useState(false);

  const categories = first?.categories ?? (BOT_CATEGORIES as Record<string, string>);
  const installedById = new Map((installed.data ?? []).map((bot) => [bot.id, bot]));

  const set = useCallback(
    (next: Partial<{ q: string; category: string; sort: Sort; needs: string }>) => {
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
  const results = uniqueById((browse.data?.pages ?? []).flatMap((page) => page.bots));
  const total = Math.max(first?.total ?? 0, results.length);
  const problem = first?.directory?.problem;
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
      <Filters q={q} category={category} sort={sort} needs={needs} categories={categories} onChange={set} />

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
        live
        caption={
          browse.data
            ? resultsCaption(results.length, total, {
                category: category ? categoryLabel(category, categories) : undefined,
                needs: NEEDS.find((need) => need.value === needs)?.caption,
                q,
              })
            : undefined
        }
      >
        {browse.isPending ? (
          <Loading>Loading the directory…</Loading>
        ) : browse.isError && results.length === 0 ? (
          <ErrorNotice
            title="Couldn't load the directory"
            error={browse.error}
            onRetry={() => void browse.refetch()}
          />
        ) : results.length === 0 && problem ? (
          <Notice tone="needs" title={problem}>
            <p className="m-0">
              If you run Steward from its repository, build the directory with{" "}
              <code className="break-all">{BUILD_COMMAND}</code>, then reload this page. You can still make a
              bot of your own.
            </p>
            <div className="mt-2">
              <Button size="sm" icon={<WandSparkles />} onClick={() => setMaking(true)}>
                Make a bot
              </Button>
            </div>
          </Notice>
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
              ? "Try a few plain words about the job, or fewer choices. Or make a bot for this job yourself."
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
        {results.length > 0 && browse.isFetchNextPageError ? (
          <ErrorNotice
            title="Couldn't load more bots"
            error={browse.error}
            onRetry={() => void browse.fetchNextPage()}
          />
        ) : null}
        {results.length > 0 && browse.hasNextPage && !browse.isFetchNextPageError ? (
          <div className="flex justify-center">
            <Button loading={browse.isFetchingNextPage} onClick={() => void browse.fetchNextPage()}>
              Show more bots
            </Button>
          </div>
        ) : null}
      </Section>

      <Dialog
        open={opened !== undefined}
        onOpenChange={(open) => !open && setOpened(undefined)}
        title={opened?.name ?? "Bot"}
        size="lg"
      >
        {opened ? (
          <ListingDialogBody
            key={opened.id}
            packUrl={opened.packUrl}
            name={opened.name}
            listing={opened}
            onDone={() => setOpened(undefined)}
          />
        ) : null}
      </Dialog>

      <MakeBotDialog open={making} onOpenChange={setMaking} />
    </Page>
  );
}

/** "Showing 60 of 1,251 bots", or "12 bots in Money & finance for “rent”" once all are shown. */
function resultsCaption(
  shown: number,
  total: number,
  filter: { category?: string; needs?: string; q?: string } = {},
): string {
  const scope = [
    filter.category ? ` in ${filter.category}` : "",
    filter.needs ? ` ${filter.needs}` : "",
    filter.q ? ` for “${filter.q}”` : "",
  ].join("");
  const all = `${total.toLocaleString()} ${total === 1 ? "bot" : "bots"}`;
  return shown < total ? `Showing ${shown.toLocaleString()} of ${all}${scope}` : `${all}${scope}`;
}

/** The listings once each: a page that shifted under a changing sort can repeat a bot. */
function uniqueById(listings: BotListing[]): BotListing[] {
  const seen = new Set<string>();
  return listings.filter((listing) => !seen.has(listing.id) && Boolean(seen.add(listing.id)));
}

function Section({
  title,
  caption,
  live = false,
  children,
}: {
  title: string;
  caption?: string;
  /** The caption says how many results there are, so a screen reader hears it change. */
  live?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div>
        <h2 id={id} className="m-0 font-semibold text-ink text-title">
          {title}
        </h2>
        {live ? (
          // Always in the page, so the change from loading to a count is announced.
          <p role="status" className="m-0 mt-0.5 text-caption text-ink-2">
            {caption ?? ""}
          </p>
        ) : caption ? (
          <p className="m-0 mt-0.5 text-caption text-ink-2">{caption}</p>
        ) : null}
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
  needs,
  categories,
  onChange,
}: {
  q: string;
  category: BotCategory | undefined;
  sort: Sort;
  needs: Need | undefined;
  categories: Record<string, string>;
  onChange: (next: Partial<{ q: string; category: string; sort: Sort; needs: string }>) => void;
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
      <ChoiceGroup
        legend="What it uses"
        value={needs ?? ""}
        onValueChange={(value) => onChange({ needs: value })}
        choices={[{ value: "", label: "Anything" }, ...NEEDS.map(({ value, label }) => ({ value, label }))]}
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
  const [confirming, setConfirming] = useState(false);
  const [updating, setUpdating] = useState(false);
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
            aria-label={`Update ${bot.name}`}
            onClick={() => setUpdating(true)}
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
      {newer ? (
        <Dialog
          open={updating}
          onOpenChange={setUpdating}
          title={`Update ${bot.name}`}
          description={`Version ${newer.version}. Read what changes before you update.`}
          size="lg"
        >
          {updating ? (
            <ListingDialogBody packUrl={newer.packUrl} name={bot.name} onDone={() => setUpdating(false)} />
          ) : null}
        </Dialog>
      ) : null}
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

/**
 * A listing inside a dialog: the preview is fetched on open, the actions sit at the bottom. The
 * same body serves Add and Update, so an update is read (with what changes) before it applies.
 */
function ListingDialogBody({
  packUrl,
  name,
  listing,
  onDone,
}: {
  packUrl: string;
  name: string;
  listing?: BotListing;
  onDone: () => void;
}) {
  const preview = useListingPreview({ packUrl });
  const pack = preview.data?.pack;
  if (!pack) {
    return preview.isError ? (
      <ErrorNotice
        title="Couldn't load this bot"
        error={preview.error}
        onRetry={() => preview.mutate({ packUrl })}
      />
    ) : (
      <Loading>Loading {name}…</Loading>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <BotListingView pack={pack} listing={listing} preview={preview.data} level={3} />
      <div className="border-hair border-t pt-4">
        <BotActions
          pack={pack}
          source={{ packUrl }}
          installed={preview.data?.alreadyInstalled}
          onUpdated={onDone}
          onCancel={onDone}
        />
      </div>
    </div>
  );
}
