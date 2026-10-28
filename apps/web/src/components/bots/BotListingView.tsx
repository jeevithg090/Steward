import type { BotListing, BotPack, BotPreview, InstalledBot } from "@steward/shared";
import { Check, Plus, RefreshCw, RotateCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.tsx";
import { Button, LinkButton } from "@/components/ui/Button.tsx";
import { Notice } from "@/components/ui/Notice.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import { Markdown } from "@/features/chat/Markdown.tsx";
import {
  type BotPreviewInput,
  useBotPreview,
  useInstallBot,
  useInstalledBots,
  useUpdateBot,
} from "@/lib/api.ts";
import { checkCron } from "@/lib/cron.ts";
import { EFFECT_LABELS } from "@/lib/labels.ts";
import { cn, plural } from "@/lib/utils.ts";
import { AuthorPill, NeedsRow } from "./BotCard.tsx";
import { connectorLabel, countsLine, toolWords, versionLine } from "./bots.ts";

/**
 * A bot's listing: what it does, what it needs, what it may do without asking, what it brings and
 * who made it. The same view draws on `/bots/:id`, inside the Add dialog on `/bots` and on
 * `/bots/add`; the container draws the name and the actions, since those differ.
 *
 * Everything in a pack is text from outside this Steward. The README renders through the chat's
 * sanitised Markdown; instructions and skill bodies are shown as plain text, never run.
 */

/** Asks the server what a pack would mean here, once per address or pack. Re-asked when it changes. */
export function useListingPreview(body: BotPreviewInput | undefined) {
  const preview = useBotPreview();
  const key = body ? JSON.stringify(body) : "";
  const previewRef = useRef(preview);
  previewRef.current = preview;
  // The ref, not the mutation, is read inside: the effect runs once per key, never per render.
  useEffect(() => {
    if (!key) {
      previewRef.current.reset();
      return;
    }
    previewRef.current.mutate(JSON.parse(key) as BotPreviewInput);
  }, [key]);
  return preview;
}

type Level = 2 | 3 | 4;

interface PackProblem {
  path: string;
  message: string;
  severity: "error" | "warn";
}

/**
 * The server's preview carries the validator's findings beside the contract's fields (`problems`,
 * not yet in `BotPreview`). Read loosely: a missing or odd list is simply nothing to show.
 */
function problemsOf(preview: BotPreview | undefined): PackProblem[] {
  const raw = (preview as { problems?: unknown } | undefined)?.problems;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is PackProblem =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as PackProblem).message === "string" &&
      typeof (entry as PackProblem).path === "string",
  );
}

/**
 * The README without an opening heading that only repeats the bot's name, which the page already
 * shows as its title.
 */
export function readmeBody(readme: string | undefined, name: string): string {
  const text = readme?.trim() ?? "";
  const first = /^#{1,6}\s+(.+?)\s*#*\s*(?:\n|$)/.exec(text);
  if (first && first[1]!.trim().toLowerCase() === name.trim().toLowerCase()) {
    return text.slice(first[0].length).trim();
  }
  return text;
}

function Heading({
  level,
  id,
  children,
  className,
}: {
  level: Level;
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  const Tag = `h${level}` as const;
  return (
    <Tag id={id} className={cn("m-0 font-semibold text-body text-ink", className)}>
      {children}
    </Tag>
  );
}

function Section({
  level,
  title,
  children,
  className,
}: {
  level: Level;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-2", className)}>
      <Heading level={level} id={id}>
        {title}
      </Heading>
      {children}
    </section>
  );
}

function PlainList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="m-0 text-ink-2 text-sub">{empty}</p>;
  return (
    <ul className="m-0 list-disc pl-5 text-ink text-sub">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export interface BotListingViewProps {
  pack: BotPack;
  /** The directory row, when there is one: counts and when it last changed. */
  listing?: BotListing;
  /** What the server says the pack means here. Undefined while it is being worked out. */
  preview?: BotPreview;
  previewPending?: boolean;
  previewError?: string;
  onRetryPreview?: () => void;
  /** Heading level of the sections. 2 on a page, 3 inside a dialog. */
  level?: Level;
  /** A line above everything, such as where the pack comes from. */
  lead?: ReactNode;
  className?: string;
}

export function BotListingView({
  pack,
  listing,
  preview,
  previewPending = false,
  previewError,
  onRetryPreview,
  level = 2,
  lead,
  className,
}: BotListingViewProps) {
  const connectors = pack.needs?.connectors ?? [];
  const missing = new Set(preview?.needsMissing ?? []);
  const tools = toolWords(pack.needs?.tools);
  const toolsMissing = preview?.toolsMissing ?? [];
  const counts = countsLine(listing);
  const problems = problemsOf(preview);

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {lead}

      {problems.length > 0 ? (
        <Notice tone="needs" role="note" title="The check of this pack noted">
          <ul className="m-0 list-disc pl-5">
            {problems.map((problem) => (
              <li key={`${problem.path}:${problem.message}`}>
                {problem.message}
                {problem.path ? <span className="text-ink-3"> ({problem.path})</span> : null}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div className="flex flex-col gap-2">
        <p className="m-0 text-body text-ink">{pack.pitch}</p>
        <div className="flex flex-wrap items-center gap-2 text-caption text-ink-2">
          <AuthorPill author={pack.author} />
          {pack.author?.kind === "person" && pack.author.basedOnAi ? (
            <Badge>Based on an AI-made draft</Badge>
          ) : null}
          <span>{versionLine(pack.version, listing?.updatedAt)}</span>
          {counts ? <span>· {counts}</span> : null}
        </div>
        <NeedsRow needs={pack.needs} />
      </div>

      <Section level={level} title="What it does">
        {readmeBody(pack.readme, pack.name) ? (
          <Markdown headingsFrom={(level + 1) as 3 | 4 | 5}>{readmeBody(pack.readme, pack.name)}</Markdown>
        ) : (
          <p className="m-0 text-ink-2 text-sub">The listing has no description beyond its pitch.</p>
        )}
        <details className="mt-1">
          <summary className="inline-flex min-h-target cursor-pointer items-center text-accent text-sub underline underline-offset-4">
            Read its full instructions
          </summary>
          <pre className="m-0 mt-1 whitespace-pre-wrap break-words rounded-field bg-tile p-3 font-sans text-ink text-sub">
            {pack.instructions}
          </pre>
        </details>
      </Section>

      <Section level={level} title="What it needs">
        {connectors.length === 0 && tools.length === 0 ? (
          <p className="m-0 text-ink-2 text-sub">
            Nothing beyond the conversation. It reads and writes no data of yours.
          </p>
        ) : null}
        {connectors.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-ink text-sub">
            {connectors.map((connector) => {
              const isMissing = missing.has(connector);
              return (
                <li key={connector} className="flex flex-wrap items-center gap-2">
                  <span>{connectorLabel(connector)}</span>
                  {preview ? (
                    isMissing ? (
                      <Pill tone="needs" icon={TriangleAlert}>
                        Not connected
                      </Pill>
                    ) : (
                      <Pill tone="done" icon={Check}>
                        Connected
                      </Pill>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {tools.length > 0 ? (
          <p className="m-0 text-ink text-sub">
            <span className="text-ink-2">Steward's tools to </span>
            {tools.join(", ")}.
          </p>
        ) : null}
        {toolsMissing.length > 0 ? (
          <Notice tone="needs" role="note">
            This Steward does not have {toolsMissing.join(", ")}. The bot may not manage everything it
            promises.
          </Notice>
        ) : null}
        {pack.needs?.model && pack.needs.model !== "any" ? (
          <p className="m-0 text-ink-2 text-sub">Model: {pack.needs.model}.</p>
        ) : null}
      </Section>

      <Section level={level} title="What it may do without asking">
        {previewPending ? (
          <p role="status" className="m-0 text-ink-2 text-sub">
            Working out what it may do under your rules…
          </p>
        ) : previewError ? (
          <Notice
            tone="problem"
            role="alert"
            title="Couldn't work out what it may do"
            action={
              onRetryPreview ? (
                <Button size="sm" icon={<RotateCw />} onClick={onRetryPreview}>
                  Try again
                </Button>
              ) : undefined
            }
          >
            {previewError}
          </Notice>
        ) : (
          <PlainList
            items={preview?.mayDoWithoutAsking ?? []}
            empty="Nothing. Every action it takes will be put to you first."
          />
        )}
        <p className="m-0 text-caption text-ink-2">
          Worked out from its tools and your rules today, not from the listing.
        </p>
      </Section>

      <Section level={level} title="What it asks before">
        {previewPending ? (
          <p className="m-0 text-ink-2 text-sub">…</p>
        ) : (
          <PlainList
            items={preview?.asksBefore ?? ["sending anything", "paying", "signing", "deleting"]}
            empty="Sending, paying, signing and deleting always ask."
          />
        )}
      </Section>

      <Section level={level} title="Rules it brings">
        {pack.rules.length === 0 ? (
          <p className="m-0 text-ink-2 text-sub">None. Your own rules apply as they are.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {pack.rules.map((rule) => {
              const effect = EFFECT_LABELS[rule.effect];
              return (
                <li key={rule.name} className="flex flex-col gap-1 rounded-field bg-tile px-3 py-2 text-sub">
                  <span className="flex flex-wrap items-center gap-2">
                    <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
                    <span className="font-medium text-ink">{rule.name}</span>
                    <Pill tone={effect.tone}>{effect.verb}</Pill>
                  </span>
                  {rule.description ? <span className="text-ink-2">{rule.description}</span> : null}
                  <code className="text-caption text-ink-2">{rule.when}</code>
                </li>
              );
            })}
          </ul>
        )}
        <p className="m-0 text-caption text-ink-2">
          A bot's rules can only ask or refuse more than yours do, never less.
        </p>
      </Section>

      <Section level={level} title="Skills it brings">
        {pack.skills.length === 0 ? (
          <p className="m-0 text-ink-2 text-sub">None.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {pack.skills.map((skill) => (
              <li key={skill.name}>
                <details className="rounded-field bg-tile px-3 py-1">
                  <summary className="flex min-h-target cursor-pointer flex-wrap items-center gap-x-2 text-sub">
                    <span className="font-mono font-semibold text-ink">/{skill.name}</span>
                    <span className="text-ink-2">{skill.description}</span>
                  </summary>
                  <pre className="m-0 mt-1 mb-2 whitespace-pre-wrap break-words font-sans text-ink text-sub">
                    {skill.body}
                  </pre>
                  {skill.allowedTools?.length ? (
                    <p className="m-0 mb-2 text-caption text-ink-2">
                      Uses only: {toolWords(skill.allowedTools).join(", ")}.
                    </p>
                  ) : null}
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {pack.routines.length > 0 ? (
        <Section level={level} title="Routines it brings">
          <ul className="m-0 list-disc pl-5 text-ink text-sub">
            {pack.routines.map((routine) => (
              <li key={routine.title}>
                {routine.title}
                <span className="text-ink-2"> · {checkCron(routine.schedule).text || routine.schedule}</span>
              </li>
            ))}
          </ul>
          <p className="m-0 text-caption text-ink-2">Added switched off. Turn one on from Routines.</p>
        </Section>
      ) : null}

      {pack.starters.length > 0 ? (
        <Section level={level} title="Things to ask it">
          <PlainList items={pack.starters} empty="" />
        </Section>
      ) : null}

      {pack.examples.length > 0 ? (
        <Section level={level} title="Examples">
          <dl className="m-0 flex flex-col gap-2 text-sub">
            {pack.examples.map((example) => (
              <div key={example.ask} className="rounded-field bg-tile px-3 py-2">
                <dt className="font-medium text-ink">“{example.ask}”</dt>
                <dd className="m-0 text-ink-2">{example.does}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      <Section level={level} title="Who made it">
        <p className="m-0 text-ink text-sub">
          {pack.author?.kind === "ai" ? (
            `Made by a model (${pack.author.model}) on ${pack.author.generated}. Checked by Steward's rules, not by a person.`
          ) : pack.author?.kind === "person" ? (
            pack.author.url ? (
              <>
                By{" "}
                <a
                  href={pack.author.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline underline-offset-2"
                >
                  {pack.author.handle}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                .
              </>
            ) : (
              `By ${pack.author.handle}.`
            )
          ) : (
            "Unknown."
          )}
          {pack.licence ? ` Licence: ${pack.licence}.` : ""}
        </p>
        {pack.hash ? (
          <p className="m-0 break-all font-mono text-caption text-ink-3">
            Pack hash {pack.hash.slice(0, 16)}…
          </p>
        ) : null}
      </Section>
    </div>
  );
}

// ── Actions ──────────────────────────────────────────────────────────────────────────────────────

export interface BotActionsProps {
  pack: BotPack;
  /** Install by address (a directory bot) or by the pack itself (Make a bot). */
  source: { packUrl: string } | { pack: BotPack };
  /** The installed row the preview reported, if any. The installed list is read too. */
  installed?: InstalledBot;
  /** Disabled until the preview has come back, so nothing is added unseen. */
  ready?: boolean;
  onInstalled?: (installed: InstalledBot) => void;
  onCancel?: () => void;
  className?: string;
}

/** Add to Steward, or Installed with Update when the directory has a newer version. */
export function BotActions({
  pack,
  source,
  installed,
  ready = true,
  onInstalled,
  onCancel,
  className,
}: BotActionsProps) {
  const installedList = useInstalledBots();
  const install = useInstallBot();
  const update = useUpdateBot();
  const mine = installedList.data?.find((bot) => bot.id === pack.id) ?? installed;
  const newer = mine ? (mine.updateAvailable?.version ?? pack.version) > mine.version : false;
  const error = install.error ?? update.error;
  const waitId = useId();

  function add() {
    install.mutate(source, {
      onSuccess: (row) => {
        toast.success("Bot added", { description: `${row.name} is ready to pick in a new conversation.` });
        onInstalled?.(row);
      },
    });
  }

  function apply() {
    if (!mine) return;
    update.mutate(mine.id, {
      onSuccess: (row) =>
        toast.success("Bot updated", { description: `${row.name} is now version ${row.version}.` }),
    });
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {mine ? (
          <>
            <Pill tone="done" icon={Check}>
              Installed
            </Pill>
            {newer ? (
              <Button variant="primary" icon={<RefreshCw />} loading={update.isPending} onClick={apply}>
                Update
              </Button>
            ) : null}
            <LinkButton
              to={`/chat?agent=${encodeURIComponent(mine.agentId)}`}
              variant={newer ? "secondary" : "primary"}
            >
              Talk to it
            </LinkButton>
          </>
        ) : (
          <Button
            variant="primary"
            icon={<Plus />}
            loading={install.isPending}
            disabled={!ready}
            onClick={add}
            aria-describedby={ready ? undefined : waitId}
          >
            Add to Steward
          </Button>
        )}
        {onCancel ? <Button onClick={onCancel}>Cancel</Button> : null}
      </div>
      {!mine && !ready ? (
        <p id={waitId} className="m-0 text-caption text-ink-2">
          Add is ready once what it may do has been worked out.
        </p>
      ) : null}
      {mine ? (
        <p className="m-0 text-caption text-ink-2">
          {plural(mine.skillIds.length, "skill")} and {plural(mine.ruleIds.length, "rule")} came with it.
          Remove it from Bots to take them away again.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 font-medium text-problem text-sub">
          {error.message}
        </p>
      ) : null}
    </div>
  );
}
