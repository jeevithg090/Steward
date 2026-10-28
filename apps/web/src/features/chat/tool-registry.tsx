/**
 * Which card draws which tool, and the boundary each card is drawn in. Kept apart from the
 * CopilotKit registration (`tools.tsx`) so the table can be used and tested on its own.
 *
 * `RENDERERS` is typed against the tool catalogue, so a tool added to `@steward/shared` without a
 * card here fails to compile.
 */
import type { BuiltinToolName } from "@steward/shared";
import { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { ToolLine } from "@/gallery/kit.tsx";
import { DelegationCard } from "./DelegationCard.tsx";
import {
  BriefToolCard,
  BrowserLine,
  CalendarCard,
  CalendarCreateLine,
  ChartToolCard,
  ChoicesToolCard,
  ComparisonToolCard,
  DirectoryFindCard,
  FileLine,
  HelpRequestCard,
  MailListCard,
  MailReadCard,
  MailSendCard,
  MemoryLine,
  PageToolCard,
  RoutineToolCard,
  SecretRequestLine,
  ShellLine,
  TableToolCard,
  TaskToolCard,
  type ToolProps,
  TriageToolCard,
  WebFetchLine,
  WebSearchCard,
} from "./tool-cards.tsx";
import { toolName } from "./tool-labels.ts";

export const RENDERERS: Record<BuiltinToolName, ComponentType<ToolProps>> = {
  browser_navigate: BrowserLine,
  browser_snapshot: BrowserLine,
  browser_click: BrowserLine,
  browser_type: BrowserLine,
  browser_press: BrowserLine,
  browser_scroll: BrowserLine,
  browser_back: BrowserLine,
  request_help: HelpRequestCard,
  request_secret: SecretRequestLine,
  file_list: FileLine,
  file_read: FileLine,
  file_write: FileLine,
  shell_run: ShellLine,
  mail_list: MailListCard,
  mail_read: MailReadCard,
  mail_send: MailSendCard,
  calendar_list: CalendarCard,
  calendar_create: CalendarCreateLine,
  web_fetch: WebFetchLine,
  web_search: WebSearchCard,
  memory_remember: MemoryLine,
  task_create: TaskToolCard,
  task_update: TaskToolCard,
  routine_create: RoutineToolCard,
  brief_today: BriefToolCard,
  triage_inbox: TriageToolCard,
  show_table: TableToolCard,
  show_chart: ChartToolCard,
  show_comparison: ComparisonToolCard,
  show_choices: ChoicesToolCard,
  make_page: PageToolCard,
  directory_find: DirectoryFindCard,
  delegate_task: DelegationCard,
};

export interface RawRenderProps {
  name: string;
  toolCallId: string;
  parameters: unknown;
  status: "inProgress" | "executing" | "complete";
  result: string | undefined;
}

function toolProps(raw: RawRenderProps): ToolProps {
  const args =
    raw.parameters && typeof raw.parameters === "object" && !Array.isArray(raw.parameters)
      ? raw.parameters
      : {};
  return {
    name: raw.name,
    toolCallId: raw.toolCallId,
    args: args as Record<string, unknown>,
    status: raw.status,
    result: raw.result,
  };
}

/** One card that throws must not take the conversation with it. */
export class ToolBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`The card for ${this.props.name} failed to draw`, error, info.componentStack);
  }

  override render() {
    if (this.state.failed) {
      return (
        <ToolLine state="failed" label={`Couldn't show this step: ${toolName(this.props.name).label}`} />
      );
    }
    return this.props.children;
  }
}

/** Draws one call with its renderer, inside a boundary. */
export function renderWith(Renderer: ComponentType<ToolProps>, raw: RawRenderProps) {
  const props = toolProps(raw);
  return (
    <ToolBoundary name={props.name}>
      <Renderer {...props} />
    </ToolBoundary>
  );
}
