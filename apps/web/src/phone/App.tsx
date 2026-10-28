import { parsePairingFragment } from "@steward/remote";
import type { DeviceApprovalItem } from "@steward/shared";
import { Bell, ListChecks, MessageSquare, Sunrise } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Card, CardHeader } from "@/components/ui/Card.tsx";
import { Field, Input, Textarea } from "@/components/ui/Field.tsx";
import { Notice } from "@/components/ui/Notice.tsx";
import { cn } from "@/lib/utils.ts";
import {
  enablePush,
  forgetDevice,
  loadDevice,
  RemoteClient,
  type Status,
  type StoredDevice,
  startPairing,
} from "./client.ts";

/**
 * Steward on the phone (docs/plans/phone-and-shortcuts.md §5.1): Today, Needs you, Chat and Tasks,
 * over the relay, sealed end to end. The same UI kit and accessibility rules as the web app: one
 * h1, labelled controls, 44px targets, status announced politely.
 */

type Tab = "today" | "needs" | "chat" | "tasks";

const TABS: { id: Tab; label: string; icon: typeof Sunrise }[] = [
  { id: "today", label: "Today", icon: Sunrise },
  { id: "needs", label: "Needs you", icon: Bell },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "tasks", label: "Tasks", icon: ListChecks },
];

interface Snapshot {
  say: string;
  items: string[];
  approvals: DeviceApprovalItem[];
  tasks: { id: string; title: string; state: string; detail: string }[];
}

export function PhoneApp() {
  const [device, setDevice] = useState<StoredDevice | null | undefined>(undefined);
  const pairing = parsePairingFragment(location.hash);

  useEffect(() => {
    loadDevice()
      .then((d) => setDevice(d ?? null))
      .catch(() => setDevice(null));
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col bg-surface text-ink">
      {device === undefined ? (
        <main className="p-4">
          <h1 className="font-semibold text-display">Steward</h1>
          <p role="status" className="mt-2 text-ink-2">
            Opening…
          </p>
        </main>
      ) : pairing && !device ? (
        <Pairing pairingId={pairing.pairingId} oneTimeKey={pairing.key} onPaired={setDevice} />
      ) : device ? (
        <Paired device={device} onForget={() => setDevice(null)} />
      ) : (
        <main className="p-4">
          <h1 className="font-semibold text-display">Steward</h1>
          <Notice className="mt-4" title="Pair this phone first">
            In Steward on your Mac, open Settings → Phone → Add phone (app), and scan the code with this
            phone's camera.
          </Notice>
        </main>
      )}
    </div>
  );
}

function Pairing({
  pairingId,
  oneTimeKey,
  onPaired,
}: {
  pairingId: string;
  oneTimeKey: string;
  onPaired: (d: StoredDevice) => void;
}) {
  const [name, setName] = useState("iPhone");
  const [code, setCode] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function pair(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const started = await startPairing(pairingId, oneTimeKey, name.trim() || "Phone");
      setCode(started.code);
      const device = await started.done;
      history.replaceState(null, "", "/");
      onPaired(device);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="font-semibold text-display">Pair with Steward</h1>
      <div role="status" aria-live="polite">
        {code ? (
          <Notice tone="accent" title={`Check your Mac shows ${code}`}>
            If the codes match, confirm on the Mac. If they don't, cancel there: something is between this
            phone and your Steward.
          </Notice>
        ) : null}
        {error ? (
          <Notice tone="problem" title="Pairing didn't work">
            {error}
          </Notice>
        ) : null}
      </div>
      {!code ? (
        <form onSubmit={pair} className="flex flex-col gap-4">
          <Field
            label="This phone's name"
            description="Steward on your Mac shows this name, and the record uses it."
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" />
          </Field>
          <p className="text-ink-2 text-sub">
            Pairing makes keys that never leave this phone. If your phone offers Face ID here, allow it:
            Steward asks for it before you say yes to anything risky.
          </p>
          <Button type="submit" variant="primary" loading={busy}>
            Pair
          </Button>
        </form>
      ) : null}
    </main>
  );
}

function Paired({ device, onForget }: { device: StoredDevice; onForget: () => void }) {
  const [tab, setTab] = useState<Tab>(location.hash.startsWith("#approval") ? "needs" : "today");
  const [status, setStatus] = useState<Status>("connecting");
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [chat, setChat] = useState<{ threadId?: string; lines: { who: "you" | "steward"; text: string }[] }>({
    lines: [],
  });
  const client = useRef<RemoteClient | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await client.current!.call<Snapshot>("brief.get"));
      setProblem(undefined);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    const c = new RemoteClient(device, {
      status: (s) => {
        setStatus(s);
        if (s === "online") void refresh();
      },
      envelope: (topic, value) => {
        if (topic === "approvals" || topic === "today" || topic === "notifications") void refresh();
        if (topic.startsWith("thread:")) {
          const e = value as { type: string; delta?: string };
          if ((e.type === "TEXT_MESSAGE_CONTENT" || e.type === "TEXT_MESSAGE_CHUNK") && e.delta) {
            setChat((prev) => {
              const lines = [...prev.lines];
              const last = lines.at(-1);
              if (last?.who === "steward")
                lines[lines.length - 1] = { who: "steward", text: last.text + e.delta };
              else lines.push({ who: "steward", text: e.delta ?? "" });
              return { ...prev, lines };
            });
          }
        }
      },
    });
    client.current = c;
    c.connect();
    return () => c.close();
  }, [device, refresh]);

  if (status === "revoked") {
    return (
      <main className="p-4">
        <h1 className="font-semibold text-display">Steward</h1>
        <Notice className="mt-4" tone="needs" title="This phone was removed">
          It can no longer reach your Steward. To use it again, pair it from Settings → Phone on your Mac.
        </Notice>
      </main>
    );
  }

  const needs = snapshot?.approvals.length ?? 0;
  return (
    <>
      <header className="flex items-center justify-between gap-2 px-4 pt-4">
        <h1 className="font-semibold text-display">{TABS.find((t) => t.id === tab)?.label}</h1>
        <span role="status" className="text-caption text-ink-2">
          {status === "online" ? "Connected" : status === "offline" ? "Offline, retrying" : "Connecting…"}
        </span>
      </header>
      <main className="flex flex-1 flex-col gap-4 p-4 pb-28">
        {problem ? (
          <Notice tone="problem" role="alert" title="Couldn't reach Steward">
            {problem}
          </Notice>
        ) : null}
        {tab === "today" ? <Today snapshot={snapshot} device={device} onForget={onForget} /> : null}
        {tab === "needs" ? (
          <NeedsYou items={snapshot?.approvals ?? []} client={client.current} onDone={refresh} />
        ) : null}
        {tab === "chat" ? (
          <Chat
            state={chat}
            onSend={async (text) => {
              setChat((prev) => ({ ...prev, lines: [...prev.lines, { who: "you", text }] }));
              const sent = await client.current!.call<{ threadId: string }>("chat.send", {
                text,
                ...(chat.threadId ? { threadId: chat.threadId } : {}),
              });
              setChat((prev) => ({ ...prev, threadId: sent.threadId }));
            }}
          />
        ) : null}
        {tab === "tasks" ? (
          <Tasks tasks={snapshot?.tasks ?? []} client={client.current} onDone={refresh} />
        ) : null}
      </main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 border-hair border-t bg-card">
        <ul className="mx-auto flex max-w-xl">
          {TABS.map(({ id, label, icon: Icon }) => (
            <li key={id} className="flex-1">
              <button
                type="button"
                aria-current={tab === id ? "page" : undefined}
                onClick={() => setTab(id)}
                className={cn(
                  "flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-caption",
                  tab === id ? "font-semibold text-accent" : "text-ink-2",
                )}
              >
                <Icon aria-hidden="true" className="size-5" />
                {label}
                {id === "needs" && needs > 0 ? <span className="sr-only">, {needs} waiting</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function Today({
  snapshot,
  device,
  onForget,
}: {
  snapshot?: Snapshot;
  device: StoredDevice;
  onForget: () => void;
}) {
  const [push, setPush] = useState<string | undefined>();
  return (
    <>
      <Card as="section" aria-labelledby="phone-brief">
        <CardHeader id="phone-brief" title="Your brief" />
        <p className="mt-2 text-body">{snapshot ? snapshot.say : "Loading…"}</p>
        {snapshot?.items.length ? (
          <ul className="mt-3 list-disc pl-5 text-ink-2 text-sub">
            {snapshot.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
      </Card>
      <Card as="section" aria-labelledby="phone-this">
        <CardHeader id="phone-this" title="This phone" description={`Paired as ${device.name}.`} />
        <div className="mt-3 flex flex-col gap-2">
          <Button
            onClick={async () => {
              const result = await enablePush(device).catch(() => "unsupported" as const);
              setPush(
                result === "on"
                  ? "Notifications are on. Their words are sealed: only this phone can read them."
                  : result === "denied"
                    ? "Notifications are blocked for Steward in this phone's settings."
                    : "This browser can't show notifications. On an iPhone, add Steward to the Home Screen first.",
              );
            }}
          >
            Turn on notifications
          </Button>
          <p role="status" className="text-caption text-ink-2">
            {push}
          </p>
          <Button
            variant="ghost"
            onClick={async () => {
              await forgetDevice();
              onForget();
            }}
          >
            Forget this pairing on this phone
          </Button>
        </div>
      </Card>
    </>
  );
}

function NeedsYou({
  items,
  client,
  onDone,
}: {
  items: DeviceApprovalItem[];
  client?: RemoteClient;
  onDone: () => void;
}) {
  const [said, setSaid] = useState<string | undefined>();
  if (items.length === 0) return <p className="text-ink-2">Nothing needs your answer right now.</p>;
  const answer = async (item: DeviceApprovalItem, a: "once" | "refuse", faceId = false) => {
    try {
      const reply = await client!.answer(item.id, a, faceId);
      setSaid(reply.say);
      onDone();
    } catch (err) {
      setSaid(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <>
      <p role="status" aria-live="polite" className="text-ink-2 text-sub">
        {said}
      </p>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <ApprovalRow key={item.id} item={item} faceId={client?.canFaceId ?? false} onAnswer={answer} />
        ))}
      </ul>
    </>
  );
}

function ApprovalRow({
  item,
  faceId,
  onAnswer,
}: {
  item: DeviceApprovalItem;
  faceId: boolean;
  onAnswer: (item: DeviceApprovalItem, a: "once" | "refuse", faceId?: boolean) => Promise<void>;
}) {
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const run = async (a: "once" | "refuse", withFace = false) => {
    setBusy(true);
    await onAnswer(item, a, withFace);
    setBusy(false);
  };
  return (
    <Card as="li" raised aria-labelledby={headingId}>
      <h2 id={headingId} className="font-semibold text-body">
        Steward asks
      </h2>
      <p className="mt-1 text-body">{item.summary}</p>
      {item.reason && !(item.withFaceId && faceId) ? (
        <p className="mt-2 text-ink-2 text-sub">{item.reason}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => run("refuse")}>
          Refuse
        </Button>
        {item.canDecideHere ? (
          <Button variant="primary" disabled={busy} onClick={() => run("once")}>
            Allow once
          </Button>
        ) : item.withFaceId && faceId ? (
          <Button variant="primary" disabled={busy} onClick={() => run("once", true)}>
            Allow once with Face ID
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function Chat({
  state,
  onSend,
}: {
  state: { lines: { who: "you" | "steward"; text: string }[] };
  onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  return (
    <>
      <ol role="log" aria-label="Conversation" aria-live="polite" className="flex flex-col gap-2">
        {state.lines.map((line, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: lines only ever grow at the end
            key={i}
            className={cn(
              "max-w-[85%] rounded-card px-3 py-2 text-body",
              line.who === "you" ? "self-end bg-accent-soft" : "self-start bg-card",
            )}
          >
            <span className="sr-only">{line.who === "you" ? "You said: " : "Steward: "}</span>
            {line.text}
          </li>
        ))}
      </ol>
      <form
        className="flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const words = text.trim();
          if (!words) return;
          setText("");
          setError(undefined);
          await onSend(words).catch((err: unknown) =>
            setError(err instanceof Error ? err.message : String(err)),
          );
        }}
      >
        <Field label="Message Steward" error={error}>
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary">
          Send
        </Button>
      </form>
    </>
  );
}

function Tasks({
  tasks,
  client,
  onDone,
}: {
  tasks: Snapshot["tasks"];
  client?: RemoteClient;
  onDone: () => void;
}) {
  const [said, setSaid] = useState<string | undefined>();
  if (tasks.length === 0) return <p className="text-ink-2">No tasks right now.</p>;
  return (
    <>
      <p role="status" className="text-ink-2 text-sub">
        {said}
      </p>
      <ul className="flex flex-col gap-3">
        {tasks.map((t) => (
          <Card as="li" key={t.id}>
            <h2 className="font-semibold text-body">{t.title}</h2>
            <p className="mt-1 text-ink-2 text-sub">{t.detail}</p>
            {t.state === "suggested" || t.state === "needs_you" ? (
              <div className="mt-3 flex gap-2">
                <Button
                  variant="primary"
                  onClick={async () => {
                    await client!.call("task.start", { taskId: t.id }).then(
                      () => setSaid(`Started ${t.title}.`),
                      (err: Error) => setSaid(err.message),
                    );
                    onDone();
                  }}
                >
                  Start
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await client!.call("task.hide", { taskId: t.id }).catch(() => {});
                    onDone();
                  }}
                >
                  Hide
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-caption text-ink-2">{t.state.replace(/_/g, " ")}</p>
            )}
          </Card>
        ))}
      </ul>
    </>
  );
}
