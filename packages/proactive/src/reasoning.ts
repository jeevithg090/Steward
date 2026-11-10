/**
 * Reasoning models (qwen3 and deepseek-r1 through Ollama, among others) write their thinking inline,
 * as `<think>…</think>` before the answer. That text is never the answer: it can hold a draft JSON
 * object, the person's mail, or "the user wants a brief". It is removed before anything is read.
 */

const TAG = "think|thinking|reasoning|reflection";
const BLOCK = new RegExp(`<(${TAG})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`, "gi");
const CLOSE = new RegExp(`</(?:${TAG})\\s*>`, "gi");
const OPEN = new RegExp(`<(?:${TAG})\\b[^>]*>`, "i");

/** The model's text without its thinking. */
export function stripReasoning(text: string): string {
  let out = text.replace(BLOCK, " ");
  // A closing tag with no opening one: the chat template opened it, so everything before is thinking.
  let lastClose = -1;
  for (const match of out.matchAll(CLOSE)) lastClose = match.index + match[0].length;
  if (lastClose >= 0) out = out.slice(lastClose);
  // An opening tag never closed: the model ran out of room while thinking, so nothing after it counts.
  const open = OPEN.exec(out);
  if (open) out = out.slice(0, open.index);
  return out.trim();
}
