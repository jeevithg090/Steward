/**
 * `/chat` and `/chat/:threadId`.
 *
 * Without a thread id, a new conversation is created and the address moves to it (keeping any
 * `?prompt=`, and naming its agent in `?agent=`). With one, the conversation is drawn, keyed by its
 * id, so switching conversations starts clean. `?prompt=` is sent once as the person's first message
 * and then dropped from the address, so a reload never sends it again. `?agent=` picks a different
 * agent for a new thread; when that agent cannot take it (a bot that was removed, say), the page
 * offers the others.
 *
 * A conversation always opens with its own agent: from the list, from `?agent=`, or, for one the
 * list does not have, from the server. Until then the page waits rather than guess, because a
 * guess would send a starter or `?prompt=` to the wrong agent.
 */
import { useCallback, useEffect, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Button } from "@/components/ui/Button.tsx";
import { ErrorNotice, Loading, Notice } from "@/components/ui/Notice.tsx";
import { DEFAULT_AGENT_ID, useCreateThread, useThread, useThreads } from "@/lib/api.ts";
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
  const prompt = params.get("prompt") ?? undefined;
  const requestedAgent = params.get("agent") || undefined;
  const threads = useThreads();
  const listed = threadId ? threads.data?.find((thread) => thread.id === threadId) : undefined;
  // Asked for only when the list cannot say which agent the conversation is with.
  const single = useThread(threadId ?? "", { enabled: Boolean(threadId) && !listed && !requestedAgent });
  const create = useCreateThread();
  const creating = useRef(false);

  const startThread = useCallback(
    (agentId: string = requestedAgent ?? DEFAULT_AGENT_ID) => {
      if (creating.current) return;
      creating.current = true;
      create.mutate(
        { agentId, title: titleFromPrompt(prompt) },
        {
          onSuccess: (thread) => {
            // `creating` stays set until the address carries the new id (the effect below clears it).
            // Clearing it here let the effect run once more before the navigation landed, which made a
            // second conversation and swapped the composer out from under the person's typing.
            const search = new URLSearchParams({ agent: thread.agentId, ...(prompt ? { prompt } : {}) });
            navigate(`/chat/${encodeURIComponent(thread.id)}?${search.toString()}`, { replace: true });
          },
          onError: () => {
            creating.current = false;
          },
        },
      );
    },
    [create, navigate, prompt, requestedAgent],
  );

  useEffect(() => {
    if (threadId) {
      creating.current = false;
      return;
    }
    if (!create.isError) startThread();
  }, [threadId, create.isError, startThread]);

  const dropPrompt = useCallback(() => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("prompt");
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  /** Another agent was chosen after a failure: the address says so, and the conversation is tried again. */
  function retryWith(agentId: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("agent", agentId);
        return next;
      },
      { replace: true },
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

  const summary = listed ?? single.data;
  const agentId = summary?.agentId ?? requestedAgent;
  if (!agentId) {
    if (single.error?.status === 404) {
      return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-10">
          <Notice
            tone="neutral"
            role="alert"
            title="This conversation was deleted or never existed"
            action={
              <Button size="sm" variant="secondary" onClick={() => navigate("/chat", { replace: true })}>
                Start a new one
              </Button>
            }
          />
        </div>
      );
    }
    if (single.isError) {
      return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-10">
          <ErrorNotice
            title="Couldn't open this conversation"
            error={single.error}
            onRetry={() => void single.refetch()}
          />
        </div>
      );
    }
    return <Loading>Opening the conversation…</Loading>;
  }
  return (
    <ChatThread
      key={`${agentId}:${threadId}`}
      threadId={threadId}
      runtimeAgentId={agentId}
      title={summary?.title}
      initialPrompt={prompt}
      onPromptConsumed={dropPrompt}
    />
  );
}
