#!/usr/bin/env node
// A fake ACP agent for Steward's tests: a real process speaking the Agent Client Protocol over
// stdio, the way Gemini CLI or Zed's adapters do. What it does depends on the prompt:
//
//   hello  → says hi.
//   think  → thinks, then answers.
//   work   → asks to change /srv/project/README.md (a rule may allow it), then to run `npm test`
//            (a command: it always asks the person).
//   list   → asks to run `ls`.
//   slow   → starts, then waits until it is cancelled.
//   edit   → asks to change a file outside its workspace.
//
// It prints a banner that is not JSON before anything else, and writes what it was answered to
// the file named by FAKE_ACP_LOG, one JSON object per line.
import { appendFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { agent, methods, ndJsonStream } from "@agentclientprotocol/sdk";

const LOG = process.env.FAKE_ACP_LOG;
function log(entry) {
  if (LOG) appendFileSync(LOG, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
}

process.stdout.write("fake-acp-agent 1.0: starting up (this line is not JSON)\n");
log({
  event: "start",
  cwd: process.cwd(),
  home: process.env.HOME ?? null,
  secret: process.env.OPENROUTER_API_KEY ?? null,
});

const OPTIONS = [
  { optionId: "yes", name: "Allow", kind: "allow_once" },
  { optionId: "always", name: "Always allow", kind: "allow_always" },
  { optionId: "no", name: "Reject", kind: "reject_once" },
];

let counter = 0;
const cancelled = new Map();

function say(client, sessionId, text) {
  return client.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
  });
}

async function ask(client, sessionId, toolCall) {
  await client.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: "tool_call", status: "pending", ...toolCall },
  });
  const response = await client.request(methods.client.session.requestPermission, {
    sessionId,
    toolCall: {
      toolCallId: toolCall.toolCallId,
      kind: toolCall.kind,
      rawInput: toolCall.rawInput,
      locations: toolCall.locations,
      title: toolCall.title,
    },
    options: OPTIONS,
  });
  log({ event: "permission", toolCallId: toolCall.toolCallId, outcome: response.outcome });
  return response.outcome.outcome === "selected" ? response.outcome.optionId : "cancelled";
}

async function finish(client, sessionId, toolCallId, ok, text) {
  await client.notify(methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: ok ? "completed" : "failed",
      content: [{ type: "content", content: { type: "text", text } }],
    },
  });
}

const app = agent({ name: "fake-acp-agent" })
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion: 1,
    agentCapabilities: { loadSession: true },
    agentInfo: { name: "fake-acp-agent", version: "1.0.0" },
  }))
  .onRequest(methods.agent.session.new, () => {
    counter += 1;
    const sessionId = `sess_${process.pid}_${counter}`;
    log({ event: "new", sessionId });
    return { sessionId };
  })
  .onRequest(methods.agent.session.load, async ({ params, client }) => {
    log({ event: "load", sessionId: params.sessionId });
    if (!params.sessionId.startsWith("sess_")) throw new Error("No such session");
    // Replays the old conversation, as ACP agents do; the client must not show it again.
    await say(client, params.sessionId, "(replayed history)");
    return {};
  })
  .onNotification(methods.agent.session.cancel, ({ params }) => {
    log({ event: "cancel", sessionId: params.sessionId });
    const wake = cancelled.get(params.sessionId);
    cancelled.set(params.sessionId, true);
    if (typeof wake === "function") wake();
  })
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    const { sessionId } = params;
    cancelled.delete(sessionId);
    const text = params.prompt
      .map((block) => (block.type === "text" ? block.text : ""))
      .join(" ")
      .trim();
    log({ event: "prompt", sessionId, text });

    if (text === "hello") {
      await say(client, sessionId, "Hi from ");
      await say(client, sessionId, "the fake agent.");
      return { stopReason: "end_turn" };
    }
    if (text === "think") {
      await client.notify(methods.client.session.update, {
        sessionId,
        update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Weighing it up." } },
      });
      await say(client, sessionId, "Thought it through.");
      return { stopReason: "end_turn" };
    }
    if (text === "list") {
      const answer = await ask(client, sessionId, {
        toolCallId: "call_ls",
        kind: "execute",
        title: "List",
        rawInput: { command: "ls" },
      });
      if (answer === "cancelled") return { stopReason: "cancelled" };
      await finish(
        client,
        sessionId,
        "call_ls",
        answer !== "no",
        answer === "no" ? "Not allowed." : "notes.txt",
      );
      return { stopReason: "end_turn" };
    }
    if (text === "work") {
      const first = await ask(client, sessionId, {
        toolCallId: "call_readme",
        kind: "edit",
        title: "Delete everything (a title that lies)",
        rawInput: { file_path: "/srv/project/README.md", new_string: "# Project" },
        locations: [{ path: "/srv/project/README.md" }],
      });
      if (first === "cancelled") return { stopReason: "cancelled" };
      await finish(
        client,
        sessionId,
        "call_readme",
        first !== "no",
        first === "no" ? "Not allowed." : "Edited.",
      );
      const second = await ask(client, sessionId, {
        toolCallId: "call_test",
        kind: "execute",
        title: "Run the tests",
        rawInput: { command: ["npm", "test"] },
      });
      if (second === "cancelled") return { stopReason: "cancelled" };
      if (second === "no") {
        await finish(client, sessionId, "call_test", false, "Not allowed.");
        await say(client, sessionId, "I did not run the tests.");
      } else {
        await finish(client, sessionId, "call_test", true, "12 tests passed");
        await say(client, sessionId, "All tests pass.");
      }
      return { stopReason: "end_turn" };
    }
    if (text === "edit") {
      const answer = await ask(client, sessionId, {
        toolCallId: "call_edit",
        kind: "edit",
        title: "Edit a note",
        rawInput: { file_path: "/etc/hosts" },
        locations: [{ path: "/etc/hosts" }],
      });
      if (answer === "cancelled") return { stopReason: "cancelled" };
      await finish(
        client,
        sessionId,
        "call_edit",
        answer !== "no",
        answer === "no" ? "Not allowed." : "Edited.",
      );
      return { stopReason: "end_turn" };
    }
    if (text === "slow") {
      await say(client, sessionId, "Working on it.");
      await new Promise((resolve) => {
        if (cancelled.get(sessionId) === true) return resolve();
        cancelled.set(sessionId, resolve);
        setTimeout(resolve, 30_000).unref();
      });
      return { stopReason: cancelled.get(sessionId) === true ? "cancelled" : "end_turn" };
    }
    await say(client, sessionId, `I do not know how to "${text}".`);
    return { stopReason: "end_turn" };
  });

const connection = app.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
connection.closed.then(() => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
