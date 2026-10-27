import type { ComputerClientMessage, ComputerManager, ComputerServerMessage } from "@steward/shared";
import { z } from "zod";

/** Validates what the person's screen sends. Anything else is dropped with an error message back. */
export const ComputerClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("take") }),
  z.object({ type: z.literal("release") }),
  z.object({
    type: z.literal("mouse"),
    action: z.enum(["move", "down", "up", "click"]),
    x: z.number().finite(),
    y: z.number().finite(),
    button: z.enum(["left", "right", "middle"]).optional(),
  }),
  z.object({
    type: z.literal("wheel"),
    x: z.number().finite(),
    y: z.number().finite(),
    deltaX: z.number().finite(),
    deltaY: z.number().finite(),
  }),
  z.object({
    type: z.literal("key"),
    action: z.enum(["down", "up", "press"]),
    key: z.string().min(1).max(64),
    text: z.string().max(32).optional(),
  }),
  z.object({ type: z.literal("text"), text: z.string().max(8000) }),
  z.object({ type: z.literal("navigate"), url: z.string().min(1).max(4096) }),
  z.object({ type: z.literal("secret"), requestId: z.string().min(1).max(128), value: z.string().max(4096) }),
  z.object({ type: z.literal("secret.cancel"), requestId: z.string().min(1).max(128) }),
]);

// Compile-time check that the schema and the contract agree.
const _schemaMatchesContract: (m: z.infer<typeof ComputerClientMessageSchema>) => ComputerClientMessage = (
  m,
) => m;
void _schemaMatchesContract;

/** Largest frame accepted from a browser. Input messages are tiny; this only stops abuse. */
export const MAX_CLIENT_FRAME = 64 * 1024;

export type ParsedClientMessage = { ok: true; message: ComputerClientMessage } | { ok: false; error: string };

export function parseClientMessage(raw: string): ParsedClientMessage {
  if (raw.length > MAX_CLIENT_FRAME) return { ok: false, error: "That message is too large." };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "That message could not be read." };
  }
  const parsed = ComputerClientMessageSchema.safeParse(data);
  return parsed.success
    ? { ok: true, message: parsed.data }
    : { ok: false, error: "That message could not be read." };
}

interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/**
 * One open screen: forwards the computer's frames, status and activity to the browser and passes
 * the person's input to `ComputerManager.handle`, which ignores it unless they hold control.
 * Error messages never repeat what was typed, so a secret cannot echo back.
 */
export function computerSocket(computers: ComputerManager, agentId: string, open: Set<SocketLike>) {
  let unsubscribe: (() => void) | undefined;
  let socket: SocketLike | undefined;
  const send = (msg: ComputerServerMessage) => {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(msg));
  };
  const cleanup = () => {
    unsubscribe?.();
    unsubscribe = undefined;
    if (socket) open.delete(socket);
  };
  return {
    onOpen(ws: SocketLike) {
      socket = ws;
      open.add(ws);
      try {
        send({ type: "status", status: computers.status(agentId) });
        unsubscribe = computers.subscribe(agentId, send);
      } catch (err) {
        console.error("[steward] computer stream failed:", err instanceof Error ? err.message : err);
        send({ type: "error", message: "Couldn't show the computer's screen." });
      }
    },
    onMessage(raw: string) {
      const parsed = parseClientMessage(raw);
      if (!parsed.ok) {
        send({ type: "error", message: parsed.error });
        return;
      }
      const msg = parsed.message;
      computers.handle(agentId, msg).catch((err: unknown) => {
        // Log the kind of input only: a secret's value or typed text must never reach a log.
        console.error(
          `[steward] computer input "${msg.type}" failed:`,
          err instanceof Error ? err.name : "error",
        );
        send({
          type: "error",
          message:
            msg.type === "secret"
              ? "Couldn't fill that field. Try again."
              : "That didn't work on the computer.",
        });
      });
    },
    onClose: cleanup,
    onError: cleanup,
  };
}
