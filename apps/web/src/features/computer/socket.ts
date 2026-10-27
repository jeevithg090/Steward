/**
 * The live connection to an agent's computer: `WS /ws/computer/:agentId`, speaking the
 * `ComputerServerMessage` / `ComputerClientMessage` protocol from `@steward/shared`.
 *
 * Framework-free so it can be tested with a fake socket. It reconnects with backoff when the line
 * drops; any message from the server proves the line is good again and resets the backoff. Once
 * the retries are spent it says so and waits for `retry()`.
 *
 * Reconnect behaviour adapted from OpenBot's app/src/lib/computers/screen-connection.ts (MIT,
 * CopilotKit).
 */
import type { ActivityItem, ComputerClientMessage, ComputerStatus } from "@steward/shared";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";

export interface Frame {
  /** Base64 JPEG. */
  data: string;
  width: number;
  height: number;
}

/** The parts of `WebSocket` used here, so tests can pass a fake. */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface ComputerSocketHandlers {
  onStatus?: (status: ComputerStatus) => void;
  onActivity?: (item: ActivityItem) => void;
  onFrame?: (frame: Frame) => void;
  /** A message from the server meant for the person, such as "Take control before driving". */
  onServerError?: (message: string) => void;
  onState?: (state: ConnectionState, problem?: string) => void;
}

export interface ComputerSocketOptions extends ComputerSocketHandlers {
  url: string;
  /** Opens a socket. Defaults to the browser's `WebSocket`. */
  open?: (url: string) => SocketLike;
  /** Schedules a retry. Defaults to `setTimeout`. */
  schedule?: (run: () => void, delayMs: number) => () => void;
  /** Delays between retries, in milliseconds. */
  backoff?: readonly number[];
}

const OPEN = 1;
export const DEFAULT_BACKOFF = [500, 1_000, 2_000, 4_000, 8_000, 15_000] as const;
export const DISCONNECTED = "The live screen is disconnected. Retry to reconnect.";
/** Frames outside these bounds are dropped as corrupt. */
const MAX_FRAME_SIDE = 8192;
const MAX_FRAME_CHARS = 20_000_000;

type Parsed =
  | { type: "frame"; frame: Frame }
  | { type: "status"; status: ComputerStatus }
  | { type: "activity"; item: ActivityItem }
  | { type: "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads one server message, or undefined when it is malformed. Never throws. */
export function parseServerMessage(raw: unknown): Parsed | undefined {
  let message: unknown = raw;
  if (typeof raw === "string") {
    try {
      message = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!isRecord(message) || typeof message.type !== "string") return undefined;
  switch (message.type) {
    case "frame": {
      const { data, width, height } = message;
      if (typeof data !== "string" || data.length === 0 || data.length > MAX_FRAME_CHARS) return undefined;
      if (typeof width !== "number" || typeof height !== "number") return undefined;
      if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
      if (width <= 0 || height <= 0 || width > MAX_FRAME_SIDE || height > MAX_FRAME_SIDE) return undefined;
      return { type: "frame", frame: { data, width, height } };
    }
    case "status": {
      const status = message.status;
      if (!isRecord(status) || typeof status.agentId !== "string") return undefined;
      return { type: "status", status: status as unknown as ComputerStatus };
    }
    case "activity": {
      const item = message.item;
      if (!isRecord(item) || typeof item.id !== "string" || typeof item.text !== "string") return undefined;
      return { type: "activity", item: item as unknown as ActivityItem };
    }
    case "error": {
      const text =
        typeof message.message === "string"
          ? message.message
          : typeof message.error === "string"
            ? message.error
            : "";
      return text ? { type: "error", message: text } : undefined;
    }
    default:
      return undefined;
  }
}

export class ComputerSocket {
  private socket: SocketLike | undefined;
  private attempts = 0;
  private stopped = true;
  private cancelRetry: (() => void) | undefined;
  private handlers: ComputerSocketHandlers;
  private readonly options: ComputerSocketOptions;
  state: ConnectionState = "closed";

  constructor(options: ComputerSocketOptions) {
    this.options = options;
    this.handlers = options;
  }

  /** Replaces the handlers, so a React owner can pass fresh closures without reconnecting. */
  setHandlers(handlers: ComputerSocketHandlers): void {
    this.handlers = handlers;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempts = 0;
    this.connect("connecting");
  }

  stop(): void {
    this.stopped = true;
    this.cancelRetry?.();
    this.cancelRetry = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = null;
      socket.onmessage = null;
      socket.close(1000, "closed by the page");
    }
    this.setState("closed");
  }

  /** Starts again after the retries ran out, or right away while waiting for the next retry. */
  retry(): void {
    this.stop();
    this.start();
  }

  /** Sends a message when the line is open. Returns false, sending nothing, when it is not. */
  send(message: ComputerClientMessage): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  get open(): boolean {
    return this.socket?.readyState === OPEN;
  }

  private setState(state: ConnectionState, problem?: string): void {
    this.state = state;
    this.handlers.onState?.(state, problem);
  }

  private connect(state: ConnectionState): void {
    if (this.stopped) return;
    this.setState(state);
    let socket: SocketLike;
    try {
      socket = (this.options.open ?? ((url) => new WebSocket(url) as unknown as SocketLike))(
        this.options.url,
      );
    } catch {
      this.dropped(undefined);
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.setState("open");
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      const parsed = parseServerMessage(event.data);
      if (!parsed) return;
      // The line works; the next drop starts the backoff over.
      this.attempts = 0;
      if (parsed.type === "frame") this.handlers.onFrame?.(parsed.frame);
      else if (parsed.type === "status") this.handlers.onStatus?.(parsed.status);
      else if (parsed.type === "activity") this.handlers.onActivity?.(parsed.item);
      else this.handlers.onServerError?.(parsed.message);
    };
    socket.onerror = () => {
      if (this.socket !== socket) return;
      socket.close();
      this.dropped(socket);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.dropped(socket);
    };
  }

  private dropped(socket: SocketLike | undefined): void {
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = null;
      socket.onmessage = null;
    }
    this.socket = undefined;
    if (this.stopped) return;
    const backoff = this.options.backoff ?? DEFAULT_BACKOFF;
    const delay = backoff[this.attempts++];
    if (delay === undefined) {
      this.stopped = true;
      this.setState("closed", DISCONNECTED);
      return;
    }
    this.setState("reconnecting");
    const schedule =
      this.options.schedule ??
      ((run: () => void, ms: number) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      });
    this.cancelRetry = schedule(() => {
      this.cancelRetry = undefined;
      this.connect("reconnecting");
    }, delay);
  }
}
