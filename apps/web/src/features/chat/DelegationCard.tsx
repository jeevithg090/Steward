/**
 * A task handed to another agent: "Codex is working on: run the tests", then "Codex worked on: …".
 * Opening it shows what that agent said and did, as a list of its own. Its questions appear as
 * approval cards in this conversation, saying which agent asks.
 *
 * That agent works on a computer of its own. While the task runs here, the card holds a connection
 * to it, so "See screen", "Take the wheel" and the secret box inside the task reach that agent's
 * computer, not this conversation's, and the card says when that agent needs the person there. A
 * finished task in the history opens no connection; its "See screen" opens one only when asked.
 * Words sent from inside the task would go to this conversation's agent, so its quick replies are
 * shown but not offered.
 */
import { Monitor } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Dialog } from "@/components/ui/Dialog.tsx";
import { Notice } from "@/components/ui/Notice.tsx";
import { useInfo } from "@/lib/api.ts";
import { ComputerPanel } from "../computer/ComputerPanel.tsx";
import { ComputerSession, useOptionalComputer } from "../computer/session.tsx";
import { ComputerNotice } from "./ComputerNotice.tsx";
import { type ChatActions, ChatActionsContext, type ComputerView, useChatActions } from "./chat-context.tsx";
import { SubRunsContext, useSubRun } from "./subruns.tsx";
import { Transcript } from "./Transcript.tsx";
import type { ToolProps } from "./tool-cards.tsx";
import { readToolResult } from "./tool-result.ts";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function DelegationCard(tool: ToolProps) {
  const info = useInfo();
  const parent = useChatActions();
  const shared = useOptionalComputer();
  const childId = text(tool.args.agentId);
  const agentId = childId ?? "another agent";
  const name = info.data?.agents.find((a) => a.id === agentId)?.name ?? agentId;
  const done = tool.status === "complete" && tool.result !== undefined;
  // No answer came and none will: the run that handed it on was stopped or failed, or it is history.
  const stopped =
    !done && parent !== null && (Boolean(parent.runEnded) || !parent.isLatestTurn(tool.toolCallId));
  // Another agent's computer, unless the task went to the agent this conversation is with.
  const ownComputer = childId !== undefined && childId !== (shared?.agentId ?? parent?.agentId);
  // Connected while the task runs here, and kept until the page leaves so nothing remounts when it
  // ends. A task that was already over when the page opened stays unconnected.
  const [live] = useState(() => !done && !stopped);

  const card = (
    <DelegationBody
      tool={tool}
      name={name}
      childId={childId}
      done={done}
      stopped={stopped}
      ownComputer={ownComputer}
    />
  );
  return ownComputer && live && childId ? (
    <ComputerSession agentId={childId} name={name}>
      {card}
    </ComputerSession>
  ) : (
    card
  );
}

function DelegationBody({
  tool,
  name,
  childId,
  done,
  stopped,
  ownComputer,
}: {
  tool: ToolProps;
  name: string;
  childId: string | undefined;
  done: boolean;
  stopped: boolean;
  ownComputer: boolean;
}) {
  const id = useId();
  const parent = useChatActions();
  const computer = useOptionalComputer();
  const messages = useSubRun(tool.toolCallId);
  const [showing, setShowing] = useState(false);
  const [view, setView] = useState<ComputerView>({});
  const task = text(tool.args.task) ?? "a task";
  const outcome = done ? readToolResult(tool.result) : undefined;
  // A task that ended without an answer says so in its result: "… stopped without answering."
  const failed =
    outcome !== undefined && (outcome.status !== "ok" || /stopped without answering/.test(tool.result ?? ""));
  const heading = done
    ? failed
      ? `${name} could not finish: ${task}`
      : `${name} worked on: ${task}`
    : stopped
      ? `${name} stopped before it finished: ${task}`
      : `${name} is working on: ${task}`;
  const working = !done && !stopped;
  // The child's own computer, when this card holds a connection to it.
  const childComputer = ownComputer && computer?.agentId === childId ? computer : null;
  const help = working ? childComputer?.status?.help : undefined;

  const nested = useMemo<ChatActions | null>(
    () =>
      parent
        ? {
            ...parent,
            agentId: childId ?? parent.agentId,
            agentName: name,
            send: () => {},
            busy: true,
            isLatestTurn: (callId) => working && parent.isLatestTurn(callId),
            showComputer: ownComputer
              ? (asked?: ComputerView) => {
                  setView(asked ?? {});
                  setShowing(true);
                }
              : parent.showComputer,
          }
        : null,
    [parent, childId, name, working, ownComputer],
  );

  return (
    <div className="flex flex-col gap-2">
      <details
        className="group rounded-card border border-hair-2 bg-card px-4 py-2 text-sub"
        aria-describedby={`${id}-state`}
      >
        <summary className="flex min-h-target cursor-pointer list-none items-center gap-2 text-ink">
          <span aria-hidden="true" className="text-ink-3 transition-transform group-open:rotate-90">
            ▸
          </span>
          <span className="min-w-0 flex-1 break-words font-medium">{heading}</span>
        </summary>
        <p id={`${id}-state`} className="sr-only">
          {working ? "Still working." : stopped ? "Stopped." : "Finished."}{" "}
          {messages.length > 0 ? "Open to see what it did." : ""}
        </p>
        <div className="mt-2 border-hair-2 border-l-2 pl-3">
          {messages.length > 0 ? (
            <SubRunsContext.Provider value={new Map()}>
              <ChatActionsContext.Provider value={nested}>
                <Transcript
                  messages={messages}
                  running={working}
                  nested
                  label={`What ${name} did`}
                  speaker={name}
                />
              </ChatActionsContext.Provider>
            </SubRunsContext.Provider>
          ) : (
            <p className="m-0 text-ink-2">{working ? "Starting…" : "It said nothing on the way."}</p>
          )}
        </div>
      </details>

      {help ? (
        <Notice
          tone="needs"
          role="alert"
          title={`${name} needs you on its computer`}
          action={
            <Button
              size="sm"
              variant="primary"
              icon={<Monitor />}
              onClick={() => {
                setView({ tab: "screen" });
                setShowing(true);
              }}
            >
              Show its computer
            </Button>
          }
        >
          {help.reason}
        </Notice>
      ) : null}

      <ComputerNotice computer={childComputer} hidden={!showing} />

      {ownComputer && childId ? (
        <Dialog
          open={showing}
          onOpenChange={setShowing}
          title={`${name}'s computer`}
          size="lg"
          placement="sheet"
        >
          {showing ? (
            <ComputerPanel
              agentId={childId}
              name={name}
              initialTab={view.tab}
              highlightFile={view.file}
              headingLevel={3}
              showTitle={false}
            />
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}
