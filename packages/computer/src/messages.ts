import type { ComputerClientMessage } from "@steward/shared";

/**
 * Validates a message from the person's screen. It arrives over a WebSocket, so nothing about its
 * shape is trusted: every field is checked and bounded, and anything else is dropped.
 */
export function parseClientMessage(raw: unknown): ComputerClientMessage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const m = raw as Record<string, unknown>;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const str = (v: unknown, max: number) => typeof v === "string" && v.length <= max;

  switch (m.type) {
    case "take":
    case "release":
      return { type: m.type };
    case "mouse": {
      if (!["move", "down", "up", "click"].includes(m.action as string) || !num(m.x) || !num(m.y))
        return undefined;
      if (m.button !== undefined && !["left", "right", "middle"].includes(m.button as string))
        return undefined;
      return {
        type: "mouse",
        action: m.action as "move" | "down" | "up" | "click",
        x: m.x as number,
        y: m.y as number,
        ...(m.button ? { button: m.button as "left" | "right" | "middle" } : {}),
      };
    }
    case "wheel":
      if (!num(m.x) || !num(m.y) || !num(m.deltaX) || !num(m.deltaY)) return undefined;
      return {
        type: "wheel",
        x: m.x as number,
        y: m.y as number,
        deltaX: m.deltaX as number,
        deltaY: m.deltaY as number,
      };
    case "key": {
      if (!["down", "up", "press"].includes(m.action as string)) return undefined;
      if (!str(m.key, 40) || (m.key as string).length === 0) return undefined;
      if (m.text !== undefined && !str(m.text, 8)) return undefined;
      return {
        type: "key",
        action: m.action as "down" | "up" | "press",
        key: m.key as string,
        ...(m.text !== undefined ? { text: m.text as string } : {}),
      };
    }
    case "text":
      if (!str(m.text, 10_000) || (m.text as string).length === 0) return undefined;
      return { type: "text", text: m.text as string };
    case "navigate":
      if (!str(m.url, 8192)) return undefined;
      return { type: "navigate", url: m.url as string };
    case "secret":
      if (!str(m.requestId, 100) || typeof m.value !== "string") return undefined;
      return { type: "secret", requestId: m.requestId as string, value: m.value };
    case "secret.cancel":
      if (!str(m.requestId, 100)) return undefined;
      return { type: "secret.cancel", requestId: m.requestId as string };
    default:
      return undefined;
  }
}
