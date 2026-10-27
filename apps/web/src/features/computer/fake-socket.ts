/**
 * A WebSocket stand-in for tests: the test opens it, feeds it server messages and reads what the
 * page sent.
 */
import type { ComputerClientMessage, ComputerServerMessage } from "@steward/shared";
import type { SocketLike } from "./socket.ts";

export class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly sent: ComputerClientMessage[] = [];
  closed = false;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ComputerClientMessage);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  /** The server accepts the connection. */
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  /** A message from the server. */
  receive(message: ComputerServerMessage | Record<string, unknown> | string): void {
    this.onmessage?.({ data: typeof message === "string" ? message : JSON.stringify(message) });
  }

  /** The server goes away. */
  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
}

/** Opens fake sockets and remembers them, newest last. */
export function fakeSockets() {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    open: (url: string) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    get latest(): FakeSocket {
      const socket = sockets[sockets.length - 1];
      if (!socket) throw new Error("No socket was opened.");
      return socket;
    },
  };
}
