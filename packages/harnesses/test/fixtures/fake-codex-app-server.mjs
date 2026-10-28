#!/usr/bin/env node
// Replays codex-app-server.transcript.json as if it were `codex app-server --listen stdio://`:
// newline-delimited JSON-RPC on stdio. It answers initialize, thread/start and thread/resume from
// the transcript, plays the turn whose text matches each turn/start, waits for Steward's answer to
// every approval request, and writes every message it receives to FAKE_CODEX_LOG.
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const transcript = JSON.parse(
  readFileSync(new URL("./codex-app-server.transcript.json", import.meta.url), "utf8"),
);
const LOG = process.env.FAKE_CODEX_LOG;
const log = (entry) => LOG && appendFileSync(LOG, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);

const cwd = process.cwd();
let thread = "019a7c3e-codex-thread-1";
let turns = 0;
let nextId = 9000;
const waiting = new Map(); // our request id → resolve(result)
const waitingFor = new Map(); // client method → resolve(request)

function fill(value, turn) {
  if (typeof value === "string")
    return value.replaceAll("$thread", thread).replaceAll("$turn", turn).replaceAll("$cwd", cwd);
  if (Array.isArray(value)) return value.map((v) => fill(v, turn));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, turn)]));
  return value;
}

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

async function play(steps, turn, branches) {
  for (const step of steps) {
    if (step.notify) send({ method: step.notify, params: fill(step.params, turn) });
    else if (step.hang) return;
    else if (step.waitFor) {
      const request = await new Promise((resolve) => waitingFor.set(step.waitFor, resolve));
      send({ id: request.id, result: step.result ?? {} });
    } else if (step.request) {
      const id = nextId++;
      const answered = new Promise((resolve) => waiting.set(id, resolve));
      send({ id, method: step.request, params: fill(step.params, turn) });
      const reply = await answered;
      const choice = reply.result?.decision ?? reply.result?.action ?? (reply.error ? "error" : "none");
      let branch = step.on?.[choice] ?? step.on?.["*"] ?? [];
      if (typeof branch === "string") branch = step.on[branch];
      return play(branch, turn, branches);
    }
    // Let Steward read each message on its own, as a real server's would arrive.
    await new Promise((resolve) => setImmediate(resolve));
  }
}

process.stdout.write("codex app-server: listening on stdio (not JSON)\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  log({ received: message });
  if (message.id !== undefined && !message.method) {
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
    return;
  }
  if (!message.method) return;
  const hook = waitingFor.get(message.method);
  if (hook && message.id !== undefined) {
    waitingFor.delete(message.method);
    hook(message);
    return;
  }
  if (message.method === "thread/resume") thread = message.params?.threadId ?? thread;
  const canned = transcript.responses[message.method];
  if (canned && message.id !== undefined) {
    send({ id: message.id, result: fill(canned, "") });
    return;
  }
  if (message.method === "turn/start" && message.id !== undefined) {
    turns += 1;
    const turn = `turn_${turns}`;
    send({ id: message.id, result: { turn: { id: turn, status: "inProgress" } } });
    const text = message.params?.input?.[0]?.text ?? "";
    const steps = transcript.turns[text] ?? [
      {
        notify: "item/completed",
        params: {
          threadId: "$thread",
          turnId: "$turn",
          item: { type: "agentMessage", id: "msg_x", text: `No transcript for "${text}".` },
        },
      },
      {
        notify: "turn/completed",
        params: { threadId: "$thread", turn: { id: "$turn", status: "completed" } },
      },
    ];
    void play(steps, turn);
    return;
  }
  if (message.method === "turn/interrupt" && message.id !== undefined) {
    // Nothing waits for an interrupt: the turn is wedged and the interrupt is never answered.
    return;
  }
  if (message.id !== undefined)
    send({ id: message.id, error: { code: -32601, message: `Not in the transcript: ${message.method}` } });
});
process.on("SIGTERM", () => process.exit(0));
