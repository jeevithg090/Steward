/**
 * One conversation. Keyed by its thread id, so moving to another conversation mounts a fresh one.
 *
 * It binds a private agent to the thread (`useAgent` with a local id, the runtime agent and the
 * thread id), replays the thread's history with `connectAgent`, and draws the transcript, the
 * approvals Steward is waiting on, what it is doing right now, and the composer. Beside it sits
 * Steward's computer: a panel on wide screens (open or closed, remembered), a sheet on small ones.
 *
 * Patterns follow OpenBot's app/src/components/channels/channel-chat.tsx (MIT, CopilotKit): a
 * thread-scoped agent, failures read from the agent's own events (a run that fails still resolves),
 * and nothing captured across an await.
 */
import {
  CopilotChatConfigurationProvider,
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
import { storage } from "@/lib/utils.ts";
import { ComputerPanel } from "../computer/ComputerPanel.tsx";
import { ComputerSession, useOptionalComputer } from "../computer/session.tsx";
import { useSpeak } from "../voice/useSpeak.ts";
import { ApprovalInterrupts, type PendingApproval } from "./ApprovalInterrupts.tsx";
import { Composer } from "./Composer.tsx";
import { type ChatActions, ChatActionsContext } from "./chat-context.tsx";
import { currentStep, latestTurnToolCalls, plainRunError, textOf } from "./messages.ts";
import { claimInlineRunErrors } from "./provider.tsx";
import { RunStatus } from "./RunStatus.tsx";
import { Starters } from "./Starters.tsx";
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
  return (
    <ComputerSession agentId={props.runtimeAgentId}>
      <Conversation {...props} />
    </ComputerSession>
  );
}

function Conversation({ threadId, runtimeAgentId, title, initialPrompt, onPromptConsumed }: ChatThreadProps) {
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
  const [runError, setRunError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [panelOpen, setPanelOpen] = useState(() => storage.get(PANEL_KEY) !== "closed");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pinned, setPinned] = useState(true);
  const approvalsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const spoken = useRef(new Set<string>());
  const readAloudRef = useRef(readAloud);
  readAloudRef.current = readAloud;
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
  // run parked, say. They are answered here all the same, and the server carries the run on.
  const interruptApprovalIds = new Set(pending.map((entry) => entry.approvalId).filter(Boolean));
  const orphans = (pendingList.data ?? []).filter(
    (approval) => approval.threadId === threadId && !interruptApprovalIds.has(approval.id),
  );
  const waitingForAnswer = pending.length > 0 || orphans.length > 0;
  const busy = running || waitingForAnswer;

  // Run failures arrive as events: `runAgent` resolves even when the run fails.
  useEffect(() => {
    if (!isReady) return;
    const subscription = agent.subscribe({
      onRunInitialized: () => setRunError(null),
      onRunFailed: ({ error }) => setRunError(plainRunError(error)),
      onRunErrorEvent: ({ event }) => setRunError(plainRunError(event.message)),
      onRunFinalized: ({ messages: finished }) => {
        const fresh = finished.filter(
          (message) =>
            message.role === "assistant" && !spoken.current.has(message.id) && textOf(message.content).trim(),
        );
        for (const message of finished) spoken.current.add(message.id);
        if (readAloudRef.current && fresh.length > 0)
          speak(fresh.map((message) => textOf(message.content)).join("\n\n"));
      },
    });
    return () => subscription.unsubscribe();
  }, [agent, isReady, speak]);

  // Load the thread's history. History is never read aloud: only replies that arrive while here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `connectAttempt` is the Try again button.
  useEffect(() => {
    if (!isReady) return;
    let current = true;
    setLoad("loading");
    copilotkit
      .connectAgent({ agent })
      .then(() => {
        if (!current) return;
        for (const message of agent.messages) spoken.current.add(message.id);
        setLoad("ready");
      })
      .catch(() => {
        if (current) setLoad("failed");
      });
    return () => {
      current = false;
    };
  }, [agent, isReady, copilotkit, connectAttempt]);

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

  const stop = useCallback(() => copilotkit.stopAgent({ agent }), [agent, copilotkit]);

  const retry = useCallback(() => {
    setRunError(null);
    void copilotkit.runAgent({ agent });
  }, [agent, copilotkit]);

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
  const actions = useMemo<ChatActions>(() => {
    const latestSet = new Set(latestKey ? latestKey.split(",") : []);
    const awaitingSet = new Set(awaitingKey ? awaitingKey.split(",") : []);
    return {
      threadId,
      agentId: runtimeAgentId,
      send: (text) => {
        if (!busyRef.current) sendRef.current(text);
      },
      busy,
      isLatestTurn: (id) => latestSet.has(id),
      isAwaitingApproval: (id) => awaitingSet.has(id),
      showComputer,
    };
  }, [threadId, runtimeAgentId, busy, latestKey, awaitingKey, showComputer]);

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
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="m-0 min-w-0 truncate font-semibold text-ink text-sub"
              >
                {title || "Conversation"}
              </h1>
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
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<RotateCw />}
                        onClick={() => setConnectAttempt((n) => n + 1)}
                      >
                        Try again
                      </Button>
                    }
                  >
                    You can still write to Steward; the conversation carries on from here.
                  </Notice>
                ) : null}

                {empty && load !== "loading" ? <Starters onPick={send} disabled={busy || !isReady} /> : null}
                {empty && load === "loading" ? (
                  <p role="status" className="m-0 py-10 text-center text-ink-2 text-sub">
                    Loading the conversation…
                  </p>
                ) : null}

                <Transcript messages={messages} running={running} />

                <div ref={approvalsRef} tabIndex={-1} className="flex flex-col gap-3 outline-none">
                  {isReady ? <ApprovalInterrupts agentId={localAgentId} onPending={setPending} /> : null}
                  {orphans.map((approval) => (
                    <div
                      key={approval.id}
                      data-approval-id={approval.id}
                      tabIndex={-1}
                      className="outline-none"
                    >
                      <ApprovalCard approvalId={approval.id} initial={approval} headingLevel={3} />
                    </div>
                  ))}
                </div>

                {helpWanted ? (
                  <Notice
                    tone="needs"
                    role="alert"
                    title="Steward needs you on its computer"
                    action={
                      <Button size="sm" variant="primary" onClick={showComputer}>
                        Show the computer
                      </Button>
                    }
                  >
                    {computer?.status?.help?.reason}
                  </Notice>
                ) : null}

                {runError && !running ? (
                  <Notice
                    tone="problem"
                    role="alert"
                    title={runError}
                    action={
                      <Button size="sm" variant="secondary" icon={<RotateCw />} onClick={retry}>
                        Try again
                      </Button>
                    }
                  />
                ) : null}

                <RunStatus
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
              aria-label="Steward's computer"
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
            title="Steward's computer"
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
