/**
 * Side-effect module: imported first by `bootstrap.ts`, so blank base URLs are gone and telemetry is
 * off before `@copilotkit/runtime` is evaluated. ES modules evaluate imports in order, and this one
 * imports nothing heavy.
 */
import { normaliseEnv } from "./env.ts";

normaliseEnv(process.env);

/**
 * CopilotKit's BuiltInAgent hands Steward's own system prompt to the AI SDK as a message, and the
 * SDK warns about that on every model call. The prompt is ours, never the person's or a page's
 * (client system messages are dropped), so the warning is noise. Only that exact line is dropped.
 */
const SYSTEM_IN_MESSAGES = "AI SDK Warning: System messages in the prompt or messages fields";
const warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith(SYSTEM_IN_MESSAGES)) return;
  warn(...args);
};
