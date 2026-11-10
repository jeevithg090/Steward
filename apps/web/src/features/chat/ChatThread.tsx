/**
 * One conversation. Keyed by its thread id, so moving to another conversation mounts a fresh one.
 *
 * It binds a private agent to the thread (`useAgent` with a local id, the runtime agent and the
 * thread id), replays the thread's history with `connectAgent`, and draws the transcript, the
 * approvals Steward is waiting on, what it is doing right now, and the composer. Beside it sits
 * Steward's computer: a panel on wide screens (open or closed, remembered), a sheet on small ones.
 * Everything that names the agent names the one this conversation is with: a bot, a coding agent or
 * another Steward, as the person knows it.
 *
 * Patterns follow OpenBot's app/src/components/channels/channel-chat.tsx (MIT, CopilotKit): a
 * thread-scoped agent, failures read from the agent's own events (a run that fails still resolves),
 * and nothing captured across an await.
 *
 * Runs the server starts here (a routine, a task, the resume sweep after an answer) are followed:
 * their `run.started` and `run.finished` live events make the conversation connect again, so their
 * messages and any request for an answer appear without a reload.
 *
 * A connect never rejects: CopilotKit reports a failed one through the agent's `onRunFailed` and its
 * own `onError`, then resolves. So each connect records how it went, and only then does the page say
 * whether the history loaded. Errors replayed from the history are not news: only the newest run's
 * failure is shown, and nothing earlier than that.
 */
import {
  CopilotChatConfigurationProvider,
  CopilotKitCoreErrorCode,
  type Message,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import { newId } from "@steward/shared";
import { ArrowDown, Monitor, PanelRightClose, RotateCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAccessibility } from "@/app/accessibility.tsx";
import { ApprovalCard } from "@/components/cards/ApprovalCard.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Dialog } from "@/components/ui/Dialog.tsx";
import { Notice } from "@/components/ui/Notice.tsx";
import { useDocumentTitle } from "@/components/ui/PageHeader.tsx";
import { useApprovals, useInfo } from "@/lib/api.ts";
import { claimRouteFocus } from "@/lib/focus.ts";
import { useLiveEvents } from "@/lib/live.ts";
import { storage } from "@/lib/utils.ts";
import { ComputerPanel } from "../computer/ComputerPanel.tsx";
import { ComputerSession, useOptionalComputer } from "../computer/session.tsx";
import { useSpeak } from "../voice/useSpeak.ts";
import {
  ApprovalInterrupts,
  askedByOf,
  isStewardApproval,
  type PendingApproval,
} from "./ApprovalInterrupts.tsx";
import { Composer } from "./Composer.tsx";
import { type ChatActions, ChatActionsContext } from "./chat-context.tsx";
import { currentStep, latestTurnToolCalls, plainRunError, replayedId, shownIds, textOf } from "./messages.ts";
import { claimInlineRunErrors } from "./provider.tsx";
import { RunStatus } from "./RunStatus.tsx";
import { Starters } from "./Starters.tsx";
import { subRunOf } from "./subruns.tsx";
import { Transcript } from "./Transcript.tsx";
import { useMediaQuery } from "./use-media-query.ts";

/** Whether the computer panel is open on wide screens, remembered in this browser. */
const PANEL_KEY = "steward.chat.computerPanel";
const WIDE = "(min-width: 64rem)";
/** Within this many pixels of the bottom, new messages keep the view pinned to the end. */
const PINNED_SLACK = 96;

export interface ChatThreadProps {
  threadId: string;
  /** The runtime agent the thread talks to, e.g. `steward`. */
  runtimeAgentId: string;
  title?: string;
  /** Sent once as the person's first message, from `?prompt=`. */
  initialPrompt?: string;
  /** Called once the prompt has been taken, so the page can drop it from the address. */
  onPromptConsumed?: () => void;
}

/** How a run ended: it finished (or stopped to ask), the person stopped it, or it failed. */
type RunEnd = "ok" | "stopped" | "failed";

/** One connect: what was on screen before it (a replay skips that), whether to stay quiet, how it went. */
interface Connecting {
  shown: Set<string>;
  quiet: boolean;
  /** Nothing could be read: the server is down, or the conversation's agent is gone. */
  failed: boolean;
  /** How the newest run read so far failed, in words. A run that starts after it clears it. */
  lastError: string | null;
  /** How the newest run read so far ended, once it has. */
  ended: RunEnd | null;
}

/** A failed reply shown under the conversation. `earlier` when it was read from the history. */
interface RunProblem {
  message: string;
  earlier: boolean;
}

/**
 * What read-aloud says when a run stops to ask: "Steward is asking before it acts: Send an email to
 * sam@example.com. The request is below." Undefined when none of the interrupts is an approval.
 */
export function askingAloud(interrupts: readonly unknown[], agentName: string): string | undefined {
  const asks = interrupts.filter(isStewardApproval);
  if (asks.length === 0) return undefined;
  const lines = asks.map((interrupt) => {
    const summary = (interrupt.metadata as { summary?: unknown } | undefined)?.summary;
    const what = typeof summary === "string" && summary.trim() ? summary : (interrupt.message ?? "");
    const words = what.trim().replace(/[.!?]+$/, "") || "something it wants to do";
    return `${askedByOf(interrupt) ?? agentName} is asking before it acts: ${words}.`;
  });
  return [...lines, asks.length === 1 ? "The request is below." : "The requests are below."].join(" ");
}

/** True the first time a prompt is seen for a thread in this tab, so a reload never sends it twice. */
function firstTimeInTab(key: string): boolean {
  try {
    if (globalThis.sessionStorage?.getItem(key)) return false;
    globalThis.sessionStorage?.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}

export function ChatThread(props: ChatThreadProps) {
  const info = useInfo();
  const agentName =
    info.data?.agents.find((agent) => agent.id === props.runtimeAgentId)?.name ??
    info.data?.brand.name ??
    "Steward";
  return (
    <ComputerSession agentId={props.runtimeAgentId} name={agentName}>
      <Conversation {...props} agentName={agentName} />
    </ComputerSession>
  );
}

function Conversation({
  threadId,
  runtimeAgentId,
  agentName,
  title,
  initialPrompt,
  onPromptConsumed,
}: ChatThreadProps & { agentName: string }) {
  const localAgentId = `thread:${threadId}`;
  const { copilotkit } = useCopilotKit();
  const { agent, isReady } = useAgent({ agentId: localAgentId, runtimeAgentId, threadId, throttleMs: 40 });
  const { readAloud } = useAccessibility();
  const speaker = useSpeak();
  const wide = useMediaQuery(WIDE);
  const info = useInfo();
  const pendingList = useApprovals("pending");
  const computer = useOptionalComputer();

  const [load, setLoad] = useState<"loading" | "ready" | "failed">("loading");
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [follow, setFollow] = useState(0);
  const [runError, setRunError] = useState<RunProblem | null>(null);
  /** How the newest run ended, so a step it left open is not shown as running for ever. */
  const [lastRun, setLastRun] = useState<RunEnd | null>(null);
  /** A connect to follow a run failed after the history had loaded. */
  const [followFailed, setFollowFailed] = useState(false);
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [panelOpen, setPanelOpen] = useState(() => storage.get(PANEL_KEY) !== "closed");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pinned, setPinned] = useState(true);
  const approvalsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const spoken = useRef(new Set<string>());
  /** Runs this page already shows: the ones it started, and the ones it has replayed or followed. */
  const shownRuns = useRef(new Set<string>());
  /** The connect in flight, if any. */
  const connecting = useRef<Connecting | null>(null);
  const loaded = useRef(false);
  const readAloudRef = useRef(readAloud);
  readAloudRef.current = readAloud;
  const agentNameRef = useRef(agentName);
  agentNameRef.current = agentName;
  /** What to say about approvals once the run that stopped to ask has ended. */
  const askAloud = useRef<string | undefined>(undefined);
  const speak = speaker.speak;

  useDocumentTitle(title || "Chat");
  useEffect(() => claimInlineRunErrors(), []);

  // Arriving here, the keyboard goes to the composer on wide screens. On small ones it goes to the
  // heading instead, so the on-screen keyboard does not cover the conversation uninvited.
  useEffect(() => {
    if (!claimRouteFocus()) return;
    if (globalThis.matchMedia?.(WIDE).matches) composerRef.current?.focus();
    else headingRef.current?.focus();
  }, []);

  const messages: readonly Message[] = agent.messages;
  const running = agent.isRunning;

  // Approvals for this thread that no open interrupt stands for: the page was reloaded after the
  // run parked, say. They are answered here all the same, and the server carries the run on. Not
  // while a run streams: its approval is listed before the run ends with the interrupt that
  // carries it, and drawing it twice would announce it twice and lose the keyboard between.
  const interruptApprovalIds = new Set(pending.map((entry) => entry.approvalId).filter(Boolean));
  const orphans = running
    ? []
    : (pendingList.data ?? []).filter(
        (approval) => approval.threadId === threadId && !interruptApprovalIds.has(approval.id),
      );
  const waitingForAnswer = pending.length > 0 || orphans.length > 0;
  const busy = running || waitingForAnswer;

  // Run failures arrive as events: `runAgent` and `connectAgent` resolve even when they fail. While
  // connecting they are noted on the connect, and the connect decides what to show once it ends.
  useEffect(() => {
    if (!isReady) return;
    const subscription = agent.subscribe({
      onRunInitialized: ({ input }) => {
        shownRuns.current.add(input.runId);
        setRunError(null);
        if (!connecting.current) setLastRun(null);
      },
      onRunStartedEvent: ({ event }) => {
        shownRuns.current.add(event.runId);
        askAloud.current = undefined;
        if (connecting.current) {
          connecting.current.lastError = null;
          connecting.current.ended = null;
        } else setLastRun(null);
      },
      onRunFinishedEvent: (params) => {
        const { outcome } = params;
        const ended: RunEnd = outcome === "cancelled" ? "stopped" : "ok";
        // The newest run, if it stopped to ask, says so aloud, unless it is history being loaded.
        askAloud.current =
          outcome === "interrupt" && !connecting.current?.quiet
            ? askingAloud(params.interrupts, agentNameRef.current)
            : undefined;
        if (connecting.current) connecting.current.ended = ended;
        else setLastRun(ended);
      },
      onEvent: ({ event }) => {
        const id = connecting.current ? replayedId(event) : undefined;
        if (id && connecting.current?.shown.has(id)) return { stopPropagation: true };
      },
      onRunFailed: ({ error }) => {
        if (connecting.current) connecting.current.failed = true;
        else {
          setRunError({ message: plainRunError(error), earlier: false });
          setLastRun("failed");
        }
      },
      onRunErrorEvent: ({ event }) => {
        if (connecting.current) {
          connecting.current.lastError = plainRunError(event.message);
          connecting.current.ended = "failed";
        } else {
          setRunError({ message: plainRunError(event.message), earlier: false });
          setLastRun("failed");
        }
      },
      onRunFinalized: ({ messages: finished }) => {
        // A connect ends here too. Loading the history is quiet; a run followed live is not.
        const quiet = connecting.current?.quiet ?? false;
        // Only this conversation's agent: a handed-on task's words are folded away on screen, and
        // read out in the same voice they would sound like the conversation's own.
        const fresh = finished.filter(
          (message) =>
            !quiet &&
            message.role === "assistant" &&
            !subRunOf(message) &&
            !spoken.current.has(message.id) &&
            textOf(message.content).trim(),
        );
        for (const message of finished) spoken.current.add(message.id);
        const asking = quiet ? undefined : askAloud.current;
        askAloud.current = undefined;
        const words = [...fresh.map((message) => textOf(message.content)), ...(asking ? [asking] : [])];
        if (readAloudRef.current && words.length > 0) speak(words.join("\n\n"));
      },
    });
    return () => subscription.unsubscribe();
  }, [agent, isReady, speak]);

  // A connect can also fail before it reaches the agent; CopilotKit then reports it only here.
  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onError: ({ code, context }) => {
        if (code !== CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED || !connecting.current) return;
        if (context.agentId === undefined || context.agentId === agent.agentId)
          connecting.current.failed = true;
      },
    });
    return () => subscription.unsubscribe();
  }, [copilotkit, agent]);

  // Load the thread's history, and connect again to follow a run the server starts here. History is
  // never read aloud: only replies that arrive while here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `connectAttempt` is Try again; `follow` a server run.
  useEffect(() => {
    if (!isReady) return;
    let current = true;
    const first = !loaded.current;
    if (first) setLoad("loading");
    // The server replays the whole thread, and what is on screen must not be written twice.
    const attempt: Connecting = {
      shown: shownIds(agent.messages),
      quiet: first,
      failed: false,
      lastError: null,
      ended: null,
    };
    connecting.current = attempt;
    const settle = (failed: boolean) => {
      if (!current) return;
      if (connecting.current === attempt) connecting.current = null;
      if (failed) {
        if (first) setLoad("failed");
        else setFollowFailed(true);
        return;
      }
      for (const message of agent.messages) spoken.current.add(message.id);
      loaded.current = true;
      setLoad("ready");
      setFollowFailed(false);
      // Only the newest run's failure is worth saying; an older one was followed by a run that worked.
      if (attempt.lastError) setRunError({ message: attempt.lastError, earlier: first });
      if (attempt.ended) setLastRun(attempt.ended);
    };
    copilotkit.connectAgent({ agent }).then(
      () => settle(attempt.failed),
      () => settle(true),
    );
    return () => {
      current = false;
    };
  }, [agent, isReady, copilotkit, connectAttempt, follow]);

  // A run this page did not start began or ended in this conversation. Not while this page's own run
  // streams (it shows everything already), and not for a run it already shows, so this cannot loop.
  useLiveEvents((event) => {
    if (event.type !== "run.started" && event.type !== "run.finished") return;
    if (event.threadId !== threadId || shownRuns.current.has(event.runId)) return;
    if (!isReady || agent.isRunning) return;
    setFollow((n) => n + 1);
  });

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || !isReady || agent.isRunning) return;
      setRunError(null);
      setPinned(true);
      agent.addMessage({ id: newId("msg"), role: "user", content });
      void copilotkit.runAgent({ agent });
    },
    [agent, copilotkit, isReady],
  );
  const sendRef = useRef(send);
  sendRef.current = send;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const stop = useCallback(() => {
    // The stream may end without a word once it is cut, so the page notes the stop itself.
    setLastRun("stopped");
    copilotkit.stopAgent({ agent });
  }, [agent, copilotkit]);

  const retry = useCallback(() => {
    setRunError(null);
    void copilotkit.runAgent({ agent });
  }, [agent, copilotkit]);

  /** Reads the conversation again; never a new reply. */
  const reconnect = useCallback(() => {
    setFollowFailed(false);
    setConnectAttempt((n) => n + 1);
  }, []);

  // `?prompt=`: sent once, after the history has loaded.
  const promptTaken = useRef(false);
  useEffect(() => {
    if (!initialPrompt || promptTaken.current || !isReady || load === "loading") return;
    promptTaken.current = true;
    if (firstTimeInTab(`steward.chat.prompt:${threadId}:${initialPrompt}`)) send(initialPrompt);
    onPromptConsumed?.();
  }, [initialPrompt, isReady, load, threadId, send, onPromptConsumed]);

  const showComputer = useCallback(() => {
    if (globalThis.matchMedia?.(WIDE).matches) {
      setPanelOpen(true);
      storage.set(PANEL_KEY, "open");
      // Once it is drawn, take the keyboard there, so "See screen" lands on the screen.
      requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    } else {
      setSheetOpen(true);
    }
  }, []);

  const hidePanel = useCallback(() => {
    setPanelOpen(false);
    storage.set(PANEL_KEY, "closed");
  }, []);

  // What cards in the transcript can do. Rebuilt when the latest turn or the waiting calls change.
  const latest = latestTurnToolCalls(messages);
  const latestKey = [...latest].join(",");
  const awaitingKey = [
    ...pending.map((entry) => entry.toolCallId),
    ...orphans.map((approval) => approval.toolCallId),
  ].join(",");
  const runEnded = !running && (lastRun === "stopped" || lastRun === "failed") ? lastRun : null;
  const actions = useMemo<ChatActions>(() => {
    const latestSet = new Set(latestKey ? latestKey.split(",") : []);
    const awaitingSet = new Set(awaitingKey ? awaitingKey.split(",") : []);
    return {
      threadId,
      agentId: runtimeAgentId,
      agentName,
      send: (text) => {
        if (!busyRef.current) sendRef.current(text);
      },
      busy,
      isLatestTurn: (id) => latestSet.has(id),
      isAwaitingApproval: (id) => awaitingSet.has(id),
      runEnded,
      showComputer,
    };
  }, [threadId, runtimeAgentId, agentName, busy, latestKey, awaitingKey, runEnded, showComputer]);

  // The page itself scrolls (the shell's layout grows with its content). While the person is at the
  // end of the conversation, new messages keep it in view; once they scroll up, it stays put.
  useEffect(() => {
    const onScroll = () => {
      const root = document.documentElement;
      setPinned(root.scrollHeight - (window.scrollY + window.innerHeight) < PINNED_SLACK);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const lastMessage = messages[messages.length - 1];
  const tail = `${messages.length}:${lastMessage ? textOf(lastMessage.content).length : 0}:${pending.length}:${running}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tail` stands for "the end changed".
  useLayoutEffect(() => {
    if (pinned) window.scrollTo?.({ top: document.documentElement.scrollHeight });
  }, [tail, pinned]);

  // An answered card goes at once, so before it does the keyboard moves somewhere that stays: the
  // next request if one is left, else the composer on wide screens, else where the requests were
  // (so a phone's keyboard does not open uninvited). The answer itself is announced by the card.
  const onAnswered = useCallback((approvalId: string) => {
    const next = [...(approvalsRef.current?.querySelectorAll<HTMLElement>("[data-approval-id]") ?? [])].find(
      (element) => element.dataset.approvalId !== approvalId,
    );
    const target =
      next ?? (globalThis.matchMedia?.(WIDE).matches ? composerRef.current : approvalsRef.current);
    target?.focus({ preventScroll: true });
  }, []);

  const focusApprovals = () => {
    const target =
      approvalsRef.current?.querySelector<HTMLElement>("[data-approval-id]") ?? approvalsRef.current;
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
    target?.focus({ preventScroll: true });
  };

  const empty = messages.every((message) => message.role !== "user" && message.role !== "assistant");
  const helpWanted = Boolean(computer?.status?.help) && !(wide && panelOpen);
  const footnote = info.data?.model.scripted
    ? "Replies come from a scripted model for testing, not a real one."
    : info.data?.mail.isDemo
      ? "Mail and calendar are a demo inbox, not your own."
      : undefined;

  return (
    <CopilotChatConfigurationProvider agentId={localAgentId} threadId={threadId} hasExplicitThreadId>
      <ChatActionsContext.Provider value={actions}>
        <div className="flex w-full min-w-0 flex-1 items-start">
          <div className="flex min-h-[calc(100dvh-8rem)] min-w-0 flex-1 flex-col lg:min-h-dvh">
            <header className="flex items-center justify-between gap-2 border-hair-2 border-b px-4 py-2 sm:px-6">
              <div className="min-w-0">
                <h1
                  ref={headingRef}
                  tabIndex={-1}
                  className="m-0 min-w-0 truncate font-semibold text-ink text-sub"
                >
                  {title || "Conversation"}
                </h1>
                {/* Who answers, once there is more than one agent to talk to. */}
                {(info.data?.agents.length ?? 0) > 1 ? (
                  <p className="m-0 truncate text-caption text-ink-2">With {agentName}</p>
                ) : null}
              </div>
              {wide && panelOpen ? null : (
                <Button variant="ghost" size="sm" icon={<Monitor />} onClick={showComputer}>
                  Show computer
                </Button>
              )}
            </header>

            <div className="flex-1 px-4 sm:px-6">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-6">
                {load === "failed" ? (
                  <Notice
                    tone="problem"
                    role="alert"
                    title="Couldn't load the earlier messages"
                    action={
                      <Button size="sm" variant="secondary" icon={<RotateCw />} onClick={reconnect}>
                        Try again
                      </Button>
                    }
                  >
                    You can still write to {agentName}; the conversation carries on from here.
                  </Notice>
                ) : null}

                {/* Only a conversation known to be empty offers starters, and with them a switch of agent. */}
                {empty && load === "ready" ? <Starters onPick={send} disabled={busy || !isReady} /> : null}
                {empty && load === "loading" ? (
                  <p role="status" className="m-0 py-10 text-center text-ink-2 text-sub">
                    Loading the conversation…
                  </p>
                ) : null}

                <Transcript
                  messages={messages}
                  running={running}
                  speaker={agentName}
                  live={load !== "loading"}
                />

                <div ref={approvalsRef} tabIndex={-1} className="flex flex-col gap-3 outline-none">
                  {isReady ? (
                    <ApprovalInterrupts
                      agentId={localAgentId}
                      onPending={setPending}
                      onAnswered={onAnswered}
                    />
                  ) : null}
                  {orphans.map((approval) => (
                    <div
                      key={approval.id}
                      data-approval-id={approval.id}
                      tabIndex={-1}
                      className="outline-none"
                    >
                      <ApprovalCard
                        approvalId={approval.id}
                        initial={approval}
                        headingLevel={3}
                        onDecided={() => onAnswered(approval.id)}
                      />
                    </div>
                  ))}
                </div>

                {helpWanted ? (
                  <Notice
                    tone="needs"
                    role="alert"
                    title={`${agentName} needs you on its computer`}
                    action={
                      <Button size="sm" variant="primary" onClick={showComputer}>
                        Show the computer
                      </Button>
                    }
                  >
                    {computer?.status?.help?.reason}
                  </Notice>
                ) : null}

                {followFailed && !running ? (
                  <Notice
                    tone="problem"
                    role="alert"
                    title={`Couldn't load ${agentName}'s newest messages`}
                    action={
                      <Button size="sm" variant="secondary" icon={<RotateCw />} onClick={reconnect}>
                        Try again
                      </Button>
                    }
                  />
                ) : null}

                {runError && !running ? (
                  <Notice
                    tone="problem"
                    role="alert"
                    title={runError.earlier ? `${agentName}'s last reply didn't finish` : runError.message}
                    action={
                      <Button size="sm" variant="secondary" icon={<RotateCw />} onClick={retry}>
                        Try again
                      </Button>
                    }
                  >
                    {runError.earlier ? runError.message : undefined}
                  </Notice>
                ) : null}

                <RunStatus
                  agentName={agentName}
                  running={running}
                  step={currentStep(messages)}
                  waitingForAnswer={waitingForAnswer && !running}
                  speaking={speaker.speaking}
                  onStopSpeaking={speaker.stop}
                />
              </div>
            </div>

            {/* Above the shell's tab bar on small screens; at the very bottom on wide ones. */}
            <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 bg-surface px-4 pt-2 pb-3 sm:px-6 lg:bottom-0 lg:pb-4">
              {!pinned ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-full flex justify-center pb-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<ArrowDown />}
                    className="pointer-events-auto shadow-float"
                    onClick={() => {
                      setPinned(true);
                      window.scrollTo?.({ top: document.documentElement.scrollHeight, behavior: "smooth" });
                    }}
                  >
                    Jump to the latest
                  </Button>
                </div>
              ) : null}
              <Composer
                agentName={agentName}
                className="mx-auto w-full max-w-3xl"
                onSend={send}
                onStop={stop}
                running={running}
                blockedReason={waitingForAnswer && !running ? "Answer the request above first." : undefined}
                onShowBlocker={focusApprovals}
                footnote={footnote}
                inputRef={composerRef}
              />
            </div>
          </div>

          {wide && panelOpen ? (
            <aside
              ref={panelRef}
              tabIndex={-1}
              aria-label={`${agentName}'s computer`}
              className="sticky top-0 flex h-dvh w-[min(40rem,42%)] min-w-[22rem] shrink-0 flex-col overflow-y-auto border-hair border-l bg-surface p-4"
            >
              <ComputerPanel
                agentId={runtimeAgentId}
                actions={
                  <Button variant="ghost" size="icon" aria-label="Hide the computer" onClick={hidePanel}>
                    <PanelRightClose aria-hidden />
                  </Button>
                }
              />
            </aside>
          ) : null}
        </div>

        {!wide ? (
          <Dialog
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            title={`${agentName}'s computer`}
            size="lg"
            placement="sheet"
          >
            <ComputerPanel agentId={runtimeAgentId} headingLevel={3} showTitle={false} />
          </Dialog>
        ) : null}
      </ChatActionsContext.Provider>
    </CopilotChatConfigurationProvider>
  );
}
