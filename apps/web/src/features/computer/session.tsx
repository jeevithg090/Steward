/**
 * One live connection to an agent's computer, shared by everything that shows it.
 *
 * The chat wraps a conversation in a session so its side panel, its mobile sheet and its tool cards
 * ("Take the wheel") all use one socket, and so the secret box can open even while the panel is
 * folded away. `ComputerPanel` and `ComputerPage` open their own session when none is around.
 *
 * Frames never pass through React state: they go straight to whoever draws them, which keeps a
 * screencast from re-rendering the page many times a second.
 */
import type { ActivityItem, ComputerClientMessage, ComputerStatus } from "@steward/shared";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, DEFAULT_AGENT_ID, useComputerActivity, useComputerStatus } from "@/lib/api.ts";
import { DEFAULT_VIEWPORT, type Size } from "./input.ts";
import { SecretBox } from "./SecretBox.tsx";
import { ComputerSocket, type ConnectionState, type Frame, type SocketLike } from "./socket.ts";

/** At most this many activity lines are kept in memory. */
const ACTIVITY_LIMIT = 200;

export interface Computer {
  agentId: string;
  connection: ConnectionState;
  /** Why the screen is not live, once retries are spent. */
  problem: string | null;
  /** The computer's status: live from the socket, else as last fetched. */
  status: ComputerStatus | null;
  /** Newest first. */
  activity: ActivityItem[];
  /** The latest message from the computer meant for the person, such as a refused input. */
  notice: string | null;
  /** The size of the latest frame, which is what input coordinates map to. */
  frameSize: Size;
  /** True once a frame has arrived on this connection. */
  hasFrame: boolean;
  /** True while the person holds the wheel. */
  driving: boolean;
  subscribeFrames: (listener: (frame: Frame) => void) => () => void;
  lastFrame: () => Frame | undefined;
  /** Sends a message. False, sending nothing, when the line is not open. */
  send: (message: ComputerClientMessage) => boolean;
  take: () => boolean;
  release: () => boolean;
  /** Sends a secret to the page. The value is passed straight to the socket and kept nowhere. */
  sendSecret: (requestId: string, value: string) => boolean;
  cancelSecret: (requestId: string) => boolean;
  retry: () => void;
  clearNotice: () => void;
}

const ComputerContext = createContext<Computer | null>(null);

/** The computer of the nearest session, or null outside one. */
export function useOptionalComputer(): Computer | null {
  return useContext(ComputerContext);
}

/** The computer of the nearest session. */
export function useComputer(): Computer {
  const computer = useContext(ComputerContext);
  if (!computer) throw new Error("useComputer must be used inside <ComputerSession>.");
  return computer;
}

function mergeActivity(current: ActivityItem[], incoming: ActivityItem[]): ActivityItem[] {
  const byId = new Map<string, ActivityItem>();
  for (const item of [...current, ...incoming]) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, ACTIVITY_LIMIT);
}

export interface ComputerSessionProps {
  agentId?: string;
  children: ReactNode;
  /** Opens the socket. For tests; defaults to the browser's `WebSocket`. */
  openSocket?: (url: string) => SocketLike;
}

export function ComputerSession({ agentId = DEFAULT_AGENT_ID, children, openSocket }: ComputerSessionProps) {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [problem, setProblem] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<ComputerStatus | null>(null);
  const [liveActivity, setLiveActivity] = useState<ActivityItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState<Size>(DEFAULT_VIEWPORT);
  const [hasFrame, setHasFrame] = useState(false);
  const frameListeners = useRef(new Set<(frame: Frame) => void>());
  const latestFrame = useRef<Frame | undefined>(undefined);
  const socketRef = useRef<ComputerSocket | null>(null);

  // The socket sends status as soon as it opens; until then, and while it is down, the last fetched
  // status and activity stand in.
  const fetchedStatus = useComputerStatus(agentId, { enabled: connection !== "open" || liveStatus === null });
  const fetchedActivity = useComputerActivity(agentId);

  const openRef = useRef(openSocket);
  openRef.current = openSocket;

  useEffect(() => {
    setLiveStatus(null);
    setLiveActivity([]);
    setHasFrame(false);
    latestFrame.current = undefined;
    const socket = new ComputerSocket({
      url: api.computer.wsUrl(agentId),
      open: openRef.current,
      onState: (state, why) => {
        setConnection(state);
        setProblem(why ?? null);
      },
      onStatus: (status) => setLiveStatus(status),
      onActivity: (item) => setLiveActivity((current) => mergeActivity(current, [item])),
      onServerError: (message) => setNotice(message),
      onFrame: (frame) => {
        latestFrame.current = frame;
        setHasFrame(true);
        setFrameSize((current) =>
          current.width === frame.width && current.height === frame.height
            ? current
            : { width: frame.width, height: frame.height },
        );
        for (const listener of frameListeners.current) listener(frame);
      },
    });
    socketRef.current = socket;
    socket.start();
    return () => {
      socket.stop();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [agentId]);

  const send = useCallback((message: ComputerClientMessage) => socketRef.current?.send(message) ?? false, []);
  const subscribeFrames = useCallback((listener: (frame: Frame) => void) => {
    frameListeners.current.add(listener);
    return () => {
      frameListeners.current.delete(listener);
    };
  }, []);
  const lastFrame = useCallback(() => latestFrame.current, []);
  const notConnected = useCallback(() => {
    setNotice("The screen isn't connected yet, so that didn't reach it. Try again in a moment.");
    return false;
  }, []);

  const status = liveStatus ?? fetchedStatus.data ?? null;
  const activity = useMemo(
    () => mergeActivity(fetchedActivity.data ?? [], liveActivity),
    [fetchedActivity.data, liveActivity],
  );

  const value = useMemo<Computer>(
    () => ({
      agentId,
      connection,
      problem,
      status,
      activity,
      notice,
      frameSize,
      hasFrame,
      driving: status?.controller === "person",
      subscribeFrames,
      lastFrame,
      send,
      take: () => send({ type: "take" }) || notConnected(),
      release: () => send({ type: "release" }) || notConnected(),
      sendSecret: (requestId, secret) => send({ type: "secret", requestId, value: secret }),
      cancelSecret: (requestId) => send({ type: "secret.cancel", requestId }),
      retry: () => socketRef.current?.retry(),
      clearNotice: () => setNotice(null),
    }),
    [
      agentId,
      connection,
      problem,
      status,
      activity,
      notice,
      frameSize,
      hasFrame,
      subscribeFrames,
      lastFrame,
      send,
      notConnected,
    ],
  );

  return (
    <ComputerContext.Provider value={value}>
      {children}
      <SecretBox
        request={status?.secret}
        connected={connection === "open"}
        onSend={value.sendSecret}
        onCancel={value.cancelSecret}
      />
    </ComputerContext.Provider>
  );
}
