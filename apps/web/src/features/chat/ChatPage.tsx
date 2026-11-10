/**
 * `/chat` and `/chat/:threadId`.
 *
 * Without a thread id, a new conversation is created and the address moves to it (keeping what it
 * was handed). With one, the conversation is drawn, keyed by its id, so switching conversations
 * starts clean.
 *
 * A message one of Steward's own pages hands over (`startChat`, in router state) is sent once as
 * the person's first message, then dropped, so a reload never sends it again. `?prompt=` in the
 * address only fills the composer, with a note to read it first: anyone can write that link, so it
 * never sends by itself. `?agent=` picks a different agent for a new thread; when that agent cannot
 * take it (a bot that was removed, say), the page offers the others.
 */
import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ErrorNotice, Loading } from "@/components/ui/Notice.tsx";
import { DEFAULT_AGENT_ID, useCreateThread, useThreads } from "@/lib/api.ts";
import { starterFrom } from "@/lib/onboarding.ts";
import { AgentPicker } from "./AgentPicker.tsx";
import { ChatThread } from "./ChatThread.tsx";

/** A short title for a new conversation, from the words that start it. */
export function titleFromPrompt(prompt: string | undefined): string | undefined {
  const text = prompt?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

export function ChatPage() {
  const { threadId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const starter = starterFrom(location.state);
  const linked = params.get("prompt") || undefined;
  const requestedAgent = params.get("agent") || undefined;
  const threads = useThreads();
  const create = useCreateThread();
  const creating = useRef(false);

  const startThread = useCallback(
    (agentId: string = requestedAgent ?? DEFAULT_AGENT_ID) => {
      if (creating.current) return;
      creating.current = true;
      // Only a message the person's own page handed over names the conversation. A link's words
      // are not theirs until they send them, and then the first message they sent names it.
      create.mutate(
        { agentId, title: titleFromPrompt(starter) },
        {
          onSuccess: (thread) => {
            // `creating` stays set until the address carries the new id (the effect below clears it).
            // Clearing it here let the effect run once more before the navigation landed, which made a
            // second conversation and swapped the composer out from under the person's typing.
            const search = linked ? `?${new URLSearchParams({ prompt: linked }).toString()}` : "";
            navigate(`/chat/${encodeURIComponent(thread.id)}${search}`, {
              replace: true,
              ...(starter ? { state: location.state } : {}),
            });
          },
          onError: () => {
            creating.current = false;
          },
        },
      );
    },
    [create, navigate, linked, starter, location.state, requestedAgent],
  );

  useEffect(() => {
    if (threadId) {
      creating.current = false;
      return;
    }
    if (!create.isError) startThread();
  }, [threadId, create.isError, startThread]);

  // Once taken, the message leaves the address and the router state, so a reload cannot repeat it.
  const dropPrompt = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete("prompt");
    const search = next.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "" },
      { replace: true, state: null },
    );
  }, [navigate, params, location.pathname]);

  /** Another agent was chosen after a failure: the address says so, and the conversation is tried again. */
  function retryWith(agentId: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("agent", agentId);
        return next;
      },
      // Keep what a page handed over, so the message still goes once the conversation starts.
      { replace: true, state: location.state },
    );
    create.reset();
    startThread(agentId);
  }

  if (!threadId) {
    return create.isError ? (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-10">
        <ErrorNotice
          title="Couldn't start a conversation"
          error={create.error}
          onRetry={() => startThread()}
        />
        <AgentPicker value={requestedAgent ?? DEFAULT_AGENT_ID} onChange={retryWith} />
      </div>
    ) : (
      <Loading>Starting a conversation…</Loading>
    );
  }

  const summary = threads.data?.find((thread) => thread.id === threadId);
  const agentId = summary?.agentId ?? requestedAgent ?? DEFAULT_AGENT_ID;
  return (
    <ChatThread
      key={`${agentId}:${threadId}`}
      threadId={threadId}
      runtimeAgentId={agentId}
      title={summary?.title}
      initialPrompt={starter}
      linkedPrompt={starter ? undefined : linked}
      onPromptConsumed={dropPrompt}
    />
  );
}
