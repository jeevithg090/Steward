/**
 * How each Steward tool call looks in the conversation.
 *
 * Every call has the same four ways to stand besides done: running, waiting for the person's
 * answer, refused by a rule, or failed. `Gate` draws those the same way for every tool, so a card
 * only has to draw success. Results arrive as strings and are read with `readToolResult`, which
 * undoes double encoding, Steward's governed envelope and the untrusted-content wrapper.
 */
import type { Brief, CalendarEvent, EmailSummary, Task, TriageItem } from "@steward/shared";
import { Brain, Monitor } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AuthorPill } from "@/components/bots/BotCard.tsx";
import { BriefCard } from "@/components/cards/BriefCard.tsx";
import { CalendarDay } from "@/components/cards/CalendarDay.tsx";
import { EmailList } from "@/components/cards/EmailList.tsx";
import { TaskCard } from "@/components/cards/TaskCard.tsx";
import { Button, LinkButton } from "@/components/ui/Button.tsx";
import { Chart } from "@/gallery/Chart.tsx";
import { Choices } from "@/gallery/Choices.tsx";
import { Comparison } from "@/gallery/Comparison.tsx";
import { DataTable } from "@/gallery/DataTable.tsx";
import { CardFrame, Quiet, ToolLine, UntrustedNote } from "@/gallery/kit.tsx";
import { DraftCard, type DraftState, EmailCard } from "@/gallery/MailCards.tsx";
import {
  CommandOutput,
  PageCard,
  RoutineCard,
  SearchResults,
  SourceLine,
  TriageCard,
  takeCareOf,
} from "@/gallery/SmallCards.tsx";
import { useStartTask } from "@/lib/api.ts";
import { toolLabel } from "@/lib/labels.ts";
import { formatBytes, prettyJson } from "@/lib/utils.ts";
import { useOptionalComputer } from "../computer/session.tsx";
import { type ChatActions, useChatActions } from "./chat-context.tsx";
import { lowerFirst, toolName } from "./tool-labels.ts";
import { listFrom, readToolResult, recordFrom, refusalHeadline, type ToolOutcome } from "./tool-result.ts";

/** What every tool renderer receives. */
export interface ToolProps {
  name: string;
  toolCallId: string;
  args: Record<string, unknown>;
  status: "inProgress" | "executing" | "complete";
  /** The result as the runtime delivered it: a string, often JSON. */
  result: string | undefined;
}

interface ToolState {
  chat: ChatActions | null;
  outcome: ToolOutcome;
  /** Parked until the person answers the approval card. */
  waiting: boolean;
}

function useToolState(tool: ToolProps): ToolState {
  const chat = useChatActions();
  const outcome = readToolResult(tool.status === "complete" ? tool.result : undefined);
  const waiting =
    outcome.status === "parked" ||
    (outcome.status === "pending" && (chat?.isAwaitingApproval(tool.toolCallId) ?? false));
  return { chat, outcome, waiting };
}

/** The running, waiting, refused and failed lines. Null once the call succeeded. */
function Gate({ tool, state }: { tool: ToolProps; state: ToolState }): ReactElement | null {
  const { outcome, waiting } = state;
  if (waiting) {
    return (
      <ToolLine
        state="waiting"
        label={toolName(tool.name, tool.args, "running").label}
        note="Waiting for your answer. The request is below the conversation."
      />
    );
  }
  if (outcome.status === "pending") {
    return <ToolLine state="running" label={toolName(tool.name, tool.args, "running").label} />;
  }
  if (outcome.status === "refused") {
    return (
      <ToolLine
        state="refused"
        label={refusalHeadline(outcome)}
        detail={toolLabel(tool.name)}
        note={outcome.message}
      />
    );
  }
  if (outcome.status === "error") {
    return <ToolLine state="failed" label={`Didn't work: ${toolLabel(tool.name)}`} note={outcome.message} />;
  }
  if (outcome.status === "parked") {
    return (
      <ToolLine
        state="waiting"
        label={toolName(tool.name, tool.args, "running").label}
        note={outcome.message}
      />
    );
  }
  return null;
}

/** Brings the computer into view: the chat's panel, or the computer page outside a chat. */
function ScreenLink({ chat }: { chat: ChatActions | null }) {
  if (chat) {
    return (
      <Button
        variant="ghost"
        size="sm"
        icon={<Monitor />}
        className="px-2 text-caption"
        onClick={() => chat.showComputer()}
      >
        See screen
      </Button>
    );
  }
  return (
    <LinkButton to="/computer" variant="ghost" size="sm" icon={<Monitor />} className="px-2 text-caption">
      See screen
    </LinkButton>
  );
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── The computer ────────────────────────────────────────────────────────────────────────────────

export function BrowserLine(tool: ToolProps) {
  const state = useToolState(tool);
  const gate = Gate({ tool, state });
  const page = recordFrom(state.outcome.status === "ok" ? state.outcome.data : undefined);
  const { label } = toolName(tool.name, tool.args, gate ? "running" : "done");
  if (gate && (state.waiting || state.outcome.status !== "pending")) return gate;
  return (
    <ToolLine
      state={gate ? "running" : "done"}
      label={label}
      detail={text(page?.title)}
      action={<ScreenLink chat={state.chat} />}
    />
  );
}

/** `request_help`: Steward is stuck and asks the person to take the wheel. */
export function HelpRequestCard(tool: ToolProps) {
  const state = useToolState(tool);
  const computer = useOptionalComputer();
  const reason = text(tool.args.reason) ?? "Steward needs you to do something on its screen.";
  if (state.outcome.status === "refused" || state.outcome.status === "error") return Gate({ tool, state });
  if (state.outcome.status === "ok") {
    const data = recordFrom(state.outcome.data);
    return (
      <ToolLine
        label={
          data?.released === false ? "Steward stopped waiting for help" : "You helped. Steward carried on."
        }
        detail={reason}
      />
    );
  }
  // A request from an earlier turn that never finished (the run was stopped) is history, not a call to act.
  if (state.chat && !state.chat.isLatestTurn(tool.toolCallId)) {
    return <ToolLine label="Asked you for help" detail={reason} />;
  }
  return (
    <section
      aria-label="Steward needs your help"
      className="my-2 flex max-w-2xl flex-wrap items-center gap-3 rounded-field bg-needs-soft px-4 py-3 text-sub"
    >
      <p className="m-0 min-w-0 flex-1 text-ink">
        <strong className="font-semibold">Steward needs you: </strong>
        {reason}
      </p>
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          computer?.take();
          state.chat?.showComputer();
        }}
      >
        Take the wheel
      </Button>
    </section>
  );
}

/** `request_secret`: the value itself never appears here, only that it was asked for and filled. */
export function SecretRequestLine(tool: ToolProps) {
  const state = useToolState(tool);
  const what = lowerFirst(text(tool.args.label) ?? "a password");
  if (state.outcome.status === "ok") {
    const data = recordFrom(state.outcome.data);
    const length = typeof data?.length === "number" ? data.length : undefined;
    return data?.filled === false ? (
      <ToolLine
        state="failed"
        label={`Didn't fill in ${what}`}
        note="The secret box was closed without sending."
      />
    ) : (
      <ToolLine
        label={`You filled in ${what}`}
        detail={length ? `${length} characters, never shown to Steward` : undefined}
      />
    );
  }
  if (state.outcome.status === "pending" && !state.waiting) {
    return (
      <ToolLine
        state="waiting"
        label={`Waiting for you to type ${what}`}
        note="Type it in the secret box. It goes straight to the page and Steward never sees it."
        action={<ScreenLink chat={state.chat} />}
      />
    );
  }
  return Gate({ tool, state });
}

export function FileLine(tool: ToolProps) {
  const state = useToolState(tool);
  const gate = Gate({ tool, state });
  if (gate) return gate;
  const data = state.outcome.status === "ok" ? state.outcome.data : undefined;
  const { label } = toolName(tool.name, tool.args, "done");

  if (tool.name === "file_list") {
    const files = listFrom<Record<string, unknown>>(data, ["files", "entries"]) ?? [];
    return (
      <ToolLine label={label} detail={`${files.length} ${files.length === 1 ? "item" : "items"}`}>
        {files.length > 0 ? (
          <ul className="m-0 list-none p-0 font-mono">
            {files.slice(0, 50).map((file, index) => (
              <li key={text(file.path) ?? index}>
                {text(file.path)}
                {file.isDirectory ? "/" : ""}
              </li>
            ))}
          </ul>
        ) : (
          <Quiet>The folder is empty.</Quiet>
        )}
      </ToolLine>
    );
  }
  if (tool.name === "file_read") {
    const content = typeof data === "string" ? data : (text(recordFrom(data)?.content) ?? "");
    return (
      <ToolLine label={label} detail={content ? `${content.length.toLocaleString()} characters` : undefined}>
        {content ? (
          <pre className="m-0 whitespace-pre-wrap break-words font-mono text-ink">
            {content.length > 1500 ? `${content.slice(0, 1500)}…` : content}
          </pre>
        ) : null}
      </ToolLine>
    );
  }
  const file = recordFrom(data);
  const path = text(file?.path) ?? text(tool.args.path);
  const size = typeof file?.size === "number" ? formatBytes(file.size) : undefined;
  return (
    <ToolLine
      label={label}
      detail={size}
      action={
        path ? (
          <LinkButton
            to={`/computer?file=${encodeURIComponent(path)}`}
            variant="ghost"
            size="sm"
            className="px-2 text-caption"
          >
            Open in files
          </LinkButton>
        ) : undefined
      }
    />
  );
}

export function ShellLine(tool: ToolProps) {
  const state = useToolState(tool);
  const gate = Gate({ tool, state });
  if (gate) return gate;
  const result = recordFrom(state.outcome.status === "ok" ? state.outcome.data : undefined);
  const exit = typeof result?.exitCode === "number" ? result.exitCode : null;
  const ok = exit === 0 || exit === null;
  return (
    <ToolLine
      state={ok && result?.timedOut !== true ? "done" : "failed"}
      label={toolName(tool.name, tool.args, "done").label}
    >
      <CommandOutput result={result} />
    </ToolLine>
  );
}

// ── Mail and calendar ───────────────────────────────────────────────────────────────────────────

function isEmailSummary(value: unknown): value is EmailSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.subject === "string" &&
    isRecord(value.from)
  );
}

export function MailListCard(tool: ToolProps) {
  const state = useToolState(tool);
  const gate = Gate({ tool, state });
  if (gate) return gate;
  const data = state.outcome.status === "ok" ? state.outcome.data : undefined;
  const emails = (listFrom(data, ["emails", "messages", "items"]) ?? []).filter(isEmailSummary);
  return (
    <CardFrame title="Your mail" caption={`${emails.length} ${emails.length === 1 ? "email" : "emails"}`}>
      <EmailList emails={emails} emptyText="No mail matched." />
      {state.outcome.status === "ok" && state.outcome.untrusted ? (
        <UntrustedNote notice={state.outcome.untrusted.notice} />
      ) : null}
    </CardFrame>
  );
}

export function MailReadCard(tool: ToolProps) {
  const state = useToolState(tool);
  const gate = Gate({ tool, state });
  if (gate && (state.waiting || state.outcome.status !== "pending")) return gate;
  const ok = state.outcome.status === "ok" ? state.outcome : undefined;
  return (
    <EmailCard
      email={ok ? recordFrom(ok.data, ["email", "message"]) : undefined}
      untrusted={Boolean(ok?.untrusted)}
      untrustedNotice={ok?.untrusted?.notice}
    />
  );
}

/** `mail_send`: the whole draft, always, with where it stands. */
export function MailSendCard(tool: ToolProps) {
  const state = useToolState(tool);
  const { outcome, waiting } = state;
  const draftState: DraftState = waiting
    ? "waiting"
    : outcome.status === "pending"
      ? "writing"
      : outcome.status === "ok"
        ? "sent"
        : outcome.status === "refused"
          ? "refused"
          : "failed";
  const note =
    outcome.status === "refused"
      ? `${refusalHeadline(outcome)}. ${outcome.message}`
      : outcome.status === "error"
        ? outcome.message
        : waiting
          ? "Steward is waiting for your answer before this leaves."
          : undefined;
  return <DraftCard draft={tool.args} state={draftState} note={note} />;
}

function isCalendarEvent(value: unknown): value is CalendarEvent {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.start === "string"
  );
}

export function CalendarCard(tool: ToolProps) {
  const state = useToolState(tool);
  const gate = Gate({ tool, state });
  if (gate) return gate;
  const data = state.outcome.status === "ok" ? state.outcome.data : undefined;
  const events = (listFrom(data, ["events", "items"]) ?? []).filter(isCalendarEvent);
  return (
    <CardFrame title="Your calendar" caption={`${events.length} ${events.length === 1 ? "event" : "events"}`}>
      <CalendarDay events={events} emptyText="Nothing on your calendar for then." />
    </CardFrame>
  );
}

export function CalendarCreateLine(tool: ToolProps) {
  const state = useToolState(tool);
  const gate = Gate({ tool, state });
  if (gate) return gate;
  const event = recordFrom(state.outcome.status === "ok" ? state.outcome.data : undefined);
  const start = text(event?.start) ?? text(tool.args.start);
  const when = start ? new Date(start) : undefined;
  return (
    <ToolLine
      label={
        toolName(tool.name, { ...tool.args, title: text(event?.title) ?? tool.args.title }, "done").label
      }
      detail={
        when && !Number.isNaN(when.getTime())
          ? when.toLocaleString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })
          : undefined
      }
    />
  );
}

// ── The web ─────────────────────────────────────────────────────────────────────────────────────

export function WebFetchLine(tool: ToolProps) {
  const state = useToolState(tool);
  const gate = Gate({ tool, state });
  if (gate) return gate;
  return (
    <SourceLine
      page={recordFrom(state.outcome.status === "ok" ? state.outcome.data : undefined)}
      fallbackUrl={text(tool.args.url)}
    />
  );
}

export function WebSearchCard(tool: ToolProps) {
  const state = useToolState(tool);
  const gate = Gate({ tool, state });
  if (gate) return gate;
  const ok = state.outcome.status === "ok" ? state.outcome : undefined;
  return (
    <SearchResults
      query={text(tool.args.query)}
      results={listFrom(ok?.data, ["results", "items"]) ?? []}
      untrusted={Boolean(ok?.untrusted)}
    />
  );
}

// ── Steward's own state ─────────────────────────────────────────────────────────────────────────

export function MemoryLine(tool: ToolProps) {
  const state = useToolState(tool);
  const gate = Gate({ tool, state });
  if (gate) return gate;
  const fact = recordFrom(state.outcome.status === "ok" ? state.outcome.data : undefined);
  return (
    <ToolLine
      icon={<Brain aria-hidden className="size-4 shrink-0" />}
      label="Saved to memory"
      detail={text(fact?.text) ?? text(tool.args.text) ?? text(tool.args.fact)}
      action={
        <LinkButton to="/memory" variant="ghost" size="sm" className="px-2 text-caption">
          See memory
        </LinkButton>
      }
    />
  );
}

const TASK_STATES = new Set([
  "needs_you",
  "suggested",
  "working",
  "ready_for_review",
  "needs_input",
  "resolved",
  "failed",
  "hidden",
]);

function isTask(value: unknown): value is Task {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.state === "string" &&
    TASK_STATES.has(value.state) &&
    typeof value.updatedAt === "string"
  );
}

export function TaskToolCard(tool: ToolProps) {
  const state = useToolState(tool);
  const gate = Gate({ tool, state });
  if (gate) return gate;
  const task = recordFrom(state.outcome.status === "ok" ? state.outcome.data : undefined, ["task"]);
  if (!isTask(task))
    return <ToolLine label={toolName(tool.name, tool.args, "done").label} detail={text(tool.args.title)} />;
  return (
    <TaskCard
      task={task}
      className="my-2 max-w-2xl"
      actions={
        <LinkButton to="/tasks" variant="ghost" size="sm">
          See tasks
        </LinkButton>
      }
    />
  );
}

export function RoutineToolCard(tool: ToolProps) {
  const state = useToolState(tool);
  const { outcome, waiting } = state;
  if (outcome.status === "pending" && !waiting)
    return <ToolLine state="running" label={toolName(tool.name, tool.args, "running").label} />;
  if (outcome.status === "error") return Gate({ tool, state });
  const saved = outcome.status === "ok" ? recordFrom(outcome.data, ["routine"]) : undefined;
  return (
    <RoutineCard
      routine={saved && typeof saved.id === "string" ? saved : tool.args}
      statusWord={
        waiting
          ? { tone: "needs", word: "Waiting for your answer" }
          : outcome.status === "refused"
            ? { tone: "problem", word: refusalHeadline(outcome) }
            : undefined
      }
    />
  );
}

function isBrief(value: unknown): value is Brief {
  return (
    isRecord(value) &&
    typeof value.date === "string" &&
    Array.isArray(value.needsYou) &&
    Array.isArray(value.canWait) &&
    Array.isArray(value.calendar) &&
    Array.isArray(value.couldNotCheck)
  );
}

/** `brief_today`: the brief, with Start on each email that needs you. */
export function BriefToolCard(tool: ToolProps) {
  const state = useToolState(tool);
  const navigate = useNavigate();
  const start = useStartTask();
  const [problem, setProblem] = useState<string | null>(null);
  const gate = Gate({ tool, state });
  if (gate) return gate;
  const brief = recordFrom(state.outcome.status === "ok" ? state.outcome.data : undefined, ["brief"]);
  if (!isBrief(brief)) return <ToolLine state="failed" label="Couldn't make the brief" />;

  const onStart = (item: TriageItem) => {
    setProblem(null);
    // A task already made for this email is started through the API, in its own conversation.
    const task = brief.tasks?.find((candidate) => candidate.emailId === item.emailId);
    if (task) {
      start.mutate(
        { id: task.id },
        {
          onSuccess: ({ threadId }) => navigate(`/chat/${threadId}`),
          onError: (error) => setProblem(error.message),
        },
      );
      return;
    }
    // Otherwise Steward takes it on here, in this conversation.
    state.chat?.send(takeCareOf(item.from.name || item.from.email, item.subject));
  };

  return (
    <div className="my-2 max-w-2xl">
      <BriefCard brief={brief} headingLevel={3} onStart={state.chat ? onStart : undefined} />
      {problem ? (
        <p role="alert" className="m-0 mt-2 text-problem text-sub">
          Couldn't start that task. {problem}
        </p>
      ) : null}
    </div>
  );
}

export function TriageToolCard(tool: ToolProps) {
  const state = useToolState(tool);
  const gate = Gate({ tool, state });
  if (gate) return gate;
  const ok = state.outcome.status === "ok" ? state.outcome : undefined;
  const chat = state.chat;
  return (
    <TriageCard
      items={listFrom(ok?.data, ["items", "triage", "results"]) ?? []}
      onAsk={chat ? (message) => chat.send(message) : undefined}
      untrusted={Boolean(ok?.untrusted)}
    />
  );
}

// ── Generative UI ───────────────────────────────────────────────────────────────────────────────

/** Display tools draw from their arguments as they stream; a refusal or failure still shows as a line. */
function DisplayTool({ tool, children }: { tool: ToolProps; children: ReactElement }) {
  const state = useToolState(tool);
  if (state.outcome.status === "refused" || state.outcome.status === "error") return Gate({ tool, state });
  return children;
}

export function TableToolCard(tool: ToolProps) {
  return (
    <DisplayTool tool={tool}>
      <DataTable args={tool.args} />
    </DisplayTool>
  );
}

export function ChartToolCard(tool: ToolProps) {
  return (
    <DisplayTool tool={tool}>
      <Chart args={tool.args} />
    </DisplayTool>
  );
}

export function ComparisonToolCard(tool: ToolProps) {
  return (
    <DisplayTool tool={tool}>
      <Comparison args={tool.args} />
    </DisplayTool>
  );
}

export function ChoicesToolCard(tool: ToolProps) {
  const chat = useChatActions();
  return (
    <DisplayTool tool={tool}>
      <Choices
        args={tool.args}
        onChoose={chat ? (message) => chat.send(message) : undefined}
        disabled={!chat || chat.busy || !chat.isLatestTurn(tool.toolCallId)}
      />
    </DisplayTool>
  );
}

export function PageToolCard(tool: ToolProps) {
  const state = useToolState(tool);
  const gate = Gate({ tool, state });
  if (gate && (state.waiting || state.outcome.status !== "pending")) return gate;
  const saved = state.outcome.status === "ok" ? recordFrom(state.outcome.data, ["page", "file"]) : undefined;
  return <PageCard page={{ ...tool.args, ...saved }} />;
}

// ── The bot directory ───────────────────────────────────────────────────────────────────────────

interface FoundBot {
  id: string;
  name: string;
  pitch?: string;
  author?: { kind: "ai" | "person"; model?: string; generated?: string; handle?: string };
  packUrl?: string;
}

function isFoundBot(value: unknown): value is FoundBot {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}

function authorOf(bot: FoundBot) {
  const author = bot.author;
  if (!author) return undefined;
  if (author.kind === "ai")
    return { kind: "ai" as const, model: author.model ?? "a model", generated: author.generated ?? "" };
  if (author.kind === "person" && author.handle) return { kind: "person" as const, handle: author.handle };
  return undefined;
}

/** Where a found bot's pack is: the row's own address, else the index layout (`packs/<id>.json`). */
function addHref(bot: FoundBot): string {
  const packUrl = text(bot.packUrl) ?? `packs/${bot.id}.json`;
  return `/bots/add?pack=${encodeURIComponent(packUrl)}`;
}

/**
 * `directory_find`: the bots Steward found, each with a way to read its listing and to add it. The
 * text is the directory's, not Steward's, and the card says so.
 */
export function DirectoryFindCard(tool: ToolProps) {
  const state = useToolState(tool);
  const gate = Gate({ tool, state });
  if (gate) return gate;
  const ok = state.outcome.status === "ok" ? state.outcome : undefined;
  const bots = (listFrom<unknown>(ok?.data, ["bots", "results", "items"]) ?? [])
    .filter(isFoundBot)
    .slice(0, 8);
  const query = text(tool.args.query) ?? text(tool.args.q);
  // The tool's own note on the listings ("written by third parties") when the wrapper has none.
  const notice = ok?.untrusted?.notice ?? text(recordFrom(ok?.data)?.note);
  return (
    <CardFrame
      title={query ? `Bots for “${query}”` : "Bots from the directory"}
      caption={`${bots.length} ${bots.length === 1 ? "bot" : "bots"} found`}
    >
      {bots.length === 0 ? (
        <Quiet>No bot matched. The directory may not have one for this yet.</Quiet>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {bots.map((bot) => (
            <li key={bot.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/bots/${encodeURIComponent(bot.id)}`}
                  className="font-medium text-ink text-sub no-underline hover:underline"
                >
                  {bot.name}
                </Link>
                <AuthorPill author={authorOf(bot)} />
              </div>
              {text(bot.pitch) ? <p className="m-0 text-caption text-ink-2">{text(bot.pitch)}</p> : null}
              <div className="flex flex-wrap gap-2">
                <LinkButton
                  to={`/bots/${encodeURIComponent(bot.id)}`}
                  variant="ghost"
                  size="sm"
                  className="px-2 text-caption"
                  aria-label={`View ${bot.name}`}
                >
                  View
                </LinkButton>
                <LinkButton
                  to={addHref(bot)}
                  variant="secondary"
                  size="sm"
                  className="px-2 text-caption"
                  aria-label={`Add ${bot.name}`}
                >
                  Add
                </LinkButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      <UntrustedNote
        notice={
          notice ??
          "Listing text comes from the directory. Steward reads it as information, never as instructions."
        }
      />
    </CardFrame>
  );
}

// ── Anything else: MCP tools and tools added later ──────────────────────────────────────────────

/** A result as text for the disclosure: JSON pretty-printed, long text cut. */
function resultPreview(data: unknown): string {
  const raw = typeof data === "string" ? data : prettyJson(data);
  return raw.length > 2000 ? `${raw.slice(0, 2000)}…` : raw;
}

export function GenericToolLine(tool: ToolProps) {
  const state = useToolState(tool);
  const gate = Gate({ tool, state });
  if (gate) return gate;
  const ok = state.outcome.status === "ok" ? state.outcome : undefined;
  const { label, detail } = toolName(tool.name, tool.args, "done");
  const preview =
    ok && ok.data !== undefined && ok.data !== null && ok.data !== "" ? resultPreview(ok.data) : undefined;
  return (
    <ToolLine label={label} detail={detail}>
      {preview ? (
        <>
          <pre className="m-0 whitespace-pre-wrap break-words font-mono text-ink">{preview}</pre>
          {ok?.untrusted ? <UntrustedNote notice={ok.untrusted.notice} /> : null}
        </>
      ) : undefined}
    </ToolLine>
  );
}
