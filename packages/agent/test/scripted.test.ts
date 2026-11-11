import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseEvent } from "@ag-ui/client";
import type { ChatCompletionRequest, ChatMessage, FixtureResponse } from "@copilotkit/aimock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createStewardAgent } from "../src/agent.ts";
import { type CreatedModel, createModel } from "../src/model.ts";
import {
  loadScript,
  parseEmail,
  parseRoutine,
  parseSite,
  SCRIPTED_NOTE,
  scriptedReply,
} from "../src/scripted.ts";
import { loadTenant } from "../src/tenant.ts";
import { BUILTIN_TOOLS } from "../src/tools/catalogue.ts";
import { depsFrom, type Fakes, makeFakes, runTurn, user } from "./fakes.ts";

const ALL_TOOLS = BUILTIN_TOOLS.map((t) => ({
  type: "function" as const,
  function: { name: t.name, parameters: t.parameters },
}));
const SYSTEM: ChatMessage = { role: "system", content: "You are Steward, your steward." };

function req(messages: ChatMessage[], tools = ALL_TOOLS): ChatCompletionRequest {
  return { model: "steward-scripted", messages: [SYSTEM, ...messages], tools };
}

function ask(text: string, tools = ALL_TOOLS): FixtureResponse {
  const scripted = loadScript().find((entry) => entry.matches(req([{ role: "user", content: text }], tools)));
  return scripted?.response ?? scriptedReply(req([{ role: "user", content: text }], tools));
}

function toolOf(response: FixtureResponse): { name: string; args: Record<string, unknown> } | undefined {
  const calls = (response as { toolCalls?: { name: string; arguments: string }[] }).toolCalls;
  const first = calls?.[0];
  return first
    ? { name: first.name, args: JSON.parse(first.arguments) as Record<string, unknown> }
    : undefined;
}

function contentOf(response: FixtureResponse): string {
  return (response as { content?: string }).content ?? "";
}

describe("the scripted responder", () => {
  it("greets without a name and says it is the scripted demo model", () => {
    const reply = contentOf(ask("Hello!"));
    expect(reply).toMatch(/^Hi\. I'm Steward, running on the scripted demo model/);
  });

  it("asks for the brief, opens sites and finds the top story", () => {
    expect(toolOf(ask("What needs me today?"))?.name).toBe("brief_today");
    expect(toolOf(ask("give me my brief"))?.name).toBe("brief_today");
    expect(toolOf(ask("Open news.ycombinator.com and tell me the top story."))?.args.url).toBe(
      "https://news.ycombinator.com",
    );
    expect(toolOf(ask("open example.org/about"))?.args.url).toBe("https://example.org/about");
    expect(toolOf(ask("what's the top story today?"))?.args.url).toBe("https://news.ycombinator.com");
  });

  it("sends, remembers, schedules and shows", () => {
    const send = toolOf(ask("Email sam@example.com about Friday: see you at 10"));
    expect(send).toEqual({
      name: "mail_send",
      args: {
        to: ["sam@example.com"],
        subject: "Friday",
        body: "See you at 10",
        intent: "Send the email you asked for",
      },
    });
    expect(contentOf(ask("send an email please"))).toContain("Who should I send it to?");
    expect(toolOf(ask("Remember that I prefer morning meetings."))).toEqual({
      name: "memory_remember",
      args: { text: "I prefer morning meetings", source: "you" },
    });
    expect(toolOf(ask("Every weekday at 8, check my mail"))?.args).toMatchObject({
      schedule: "0 8 * * 1-5",
      prompt: "Check my mail",
    });
    expect(toolOf(ask("show me a table"))?.name).toBe("show_table");
    expect(toolOf(ask("compare the options"))?.name).toBe("show_comparison");
    expect(toolOf(ask("search the web for aimock"))).toEqual({
      name: "web_search",
      args: { query: "aimock", limit: 5 },
    });
  });

  it("never calls a tool it was not offered", () => {
    const reply = ask(
      "What needs me today?",
      ALL_TOOLS.filter((t) => t.function.name !== "brief_today"),
    );
    expect(toolOf(reply)).toBeUndefined();
    expect(contentOf(reply)).toContain("isn't available");
  });

  it("explains itself when it does not understand", () => {
    const reply = contentOf(ask("Draft my quarterly strategy memo"));
    expect(reply).toContain("scripted demo model");
    expect(reply).toContain("OPENROUTER_API_KEY");
  });

  it("answers from a tool result and says it is scripted", () => {
    const page = {
      ok: true,
      data: {
        untrusted: true,
        notice: "n",
        data: {
          url: "https://news.ycombinator.com",
          title: "Hacker News",
          snapshot: '- link "Hacker News"\n- link "Show HN: A small but mighty tool"',
        },
      },
    };
    const reply = contentOf(
      scriptedReply(
        req([
          { role: "user", content: "top story" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "c1", type: "function", function: { name: "browser_navigate", arguments: "{}" } },
            ],
          },
          { role: "tool", tool_call_id: "c1", content: JSON.stringify(page) },
        ]),
      ),
    );
    expect(reply).toContain("“Show HN: A small but mighty tool”");
    expect(reply).toContain(SCRIPTED_NOTE);
  });

  it("says plainly when a call was refused or failed", () => {
    const after = (content: unknown) =>
      contentOf(
        scriptedReply(
          req([
            { role: "user", content: "email sam" },
            {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "c1", type: "function", function: { name: "mail_send", arguments: "{}" } }],
            },
            { role: "tool", tool_call_id: "c1", content: JSON.stringify(content) },
          ]),
        ),
      );
    expect(after({ ok: false, refused: true, message: "x" })).toMatch(/^OK, I didn't do that\./);
    expect(after({ ok: false, refused: true, rule: "No email", message: "x" })).toContain(
      "the rule “No email”",
    );
    expect(after({ ok: false, error: "No mailbox is connected." })).toContain(
      "That didn't work: No mailbox is connected.",
    );
  });

  it("gives no made-up answer when no tools are offered", () => {
    expect(contentOf(scriptedReply(req([{ role: "user", content: "Sort this email" }], [])))).toBe(
      "Scripted demo model: no answer for this.",
    );
  });
});

describe("the app's own prompts", () => {
  const TENANTS = fileURLToPath(new URL("../../../tenants/", import.meta.url));
  const tenants = readdirSync(TENANTS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadTenant(join(TENANTS, entry.name)));
  /** What each shipped starter should do on the scripted model. A new starter needs a line here. */
  const EXPECTED: Record<string, string> = {
    "What needs me today?": "brief_today",
    "Open news.ycombinator.com and tell me the top story.": "browser_navigate",
    "Draft a reply to my landlord about the repair visit.": "mail_list",
    "Every weekday at 8, send me my brief.": "routine_create",
    "Compare three ways to back up my photos in a table.": "show_table",
    'Is the "mailbox 98% full" email a scam?': "mail_list",
    "Which bills and subscriptions came in recently, and what do they cost me a year?": "mail_list",
    "Do any of my train tickets qualify for Delay Repay?": "mail_list",
    "Every Monday at 9, check my mail for renewals and price rises.": "routine_create",
  };

  it("finds the tenants", () => {
    expect(tenants.map((tenant) => tenant.id).sort()).toEqual(expect.arrayContaining(["steward", "tempo"]));
  });

  for (const starter of [...new Set(tenants.flatMap((tenant) => tenant.starters))]) {
    it(`does what the starter “${starter}” asks`, () => {
      const reply = ask(starter);
      expect(contentOf(reply)).not.toContain("Who should I send it to?");
      expect(toolOf(reply)?.name).toBe(EXPECTED[starter]);
    });
  }

  it("makes a routine of the brief, not today's brief", () => {
    expect(toolOf(ask("Every weekday at 8, send me my brief."))?.args).toMatchObject({
      schedule: "0 8 * * 1-5",
      prompt: "Send me my brief.",
    });
  });

  it("looks up the email a Start button names, whatever its subject says", () => {
    expect(
      toolOf(ask("Take care of Helen Marsh's email: Re: Boiler not heating water: Flat 3, 27 Kestrel Road")),
    ).toEqual({
      name: "mail_list",
      args: { query: 'subject:"Re: Boiler not heating water: Flat 3, 27 Kestrel Road"', limit: 10 },
    });
    // Subjects are someone else's words: these would otherwise read as a routine, the brief, a send.
    for (const subject of ["30% off every day this week", "Your brief for my day", "Please send the forms"]) {
      expect(toolOf(ask(`Take care of Pulse Fitness's email: ${subject}`))?.args.query).toBe(
        `subject:"${subject}"`,
      );
    }
    expect(toolOf(ask("Take care of sam@example.com's email."))?.args.query).toBe('from:"sam@example.com"');
  });

  it("writes to an address only when asked to write, not when asked about its mail", () => {
    for (const asked of [
      "Is the email from sam@example.com a scam?",
      "Did sam@example.com reply?",
      "What did sam@example.com send me?",
      "Check my mail from sam@example.com",
      "Read the email from sam@example.com",
      "Find the email sam@example.com sent about the lease",
    ]) {
      const reply = ask(asked);
      expect(toolOf(reply), asked).toEqual({
        name: "mail_list",
        args: { query: 'from:"sam@example.com"', limit: 10 },
      });
    }
    // Asked to write, as a question or not, and whatever the message itself says.
    for (const asked of [
      "Can you email sam@example.com about Friday?",
      "Reply to sam@example.com: thanks, see you then",
      "Email sam@example.com: read the report and check the figures",
      "Tell sam@example.com I'm running late",
    ]) {
      expect(toolOf(ask(asked))?.name, asked).toBe("mail_send");
    }
  });

  it("searches the mail for a quoted email, and for the things a question names", () => {
    expect(toolOf(ask('Is the "mailbox 98% full" email a scam?'))?.args.query).toBe("mailbox 98% full");
    expect(toolOf(ask("Which bills and subscriptions came in recently?"))?.args.query).toBe(
      "bill OR subscription",
    );
    expect(toolOf(ask("Check my mail"))?.args).toEqual({ limit: 10 });
    expect(toolOf(ask("Draft a reply to my landlord"))?.args).toEqual({ limit: 10, unreadOnly: true });
  });

  it("says after the search what it can't do with the mail", () => {
    const after = (asked: string, emails: unknown[]) =>
      contentOf(
        scriptedReply(
          req([
            { role: "user", content: asked },
            {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "c1", type: "function", function: { name: "mail_list", arguments: "{}" } }],
            },
            {
              role: "tool",
              tool_call_id: "c1",
              content: JSON.stringify({ ok: true, data: { untrusted: true, notice: "n", data: emails } }),
            },
          ]),
        ),
      );
    const phishing = {
      id: "m1",
      from: { name: "Mail Administrator", email: "admin@mailbox-verify-secure.test" },
      subject: "Action required: your mailbox is 98% full",
    };
    const scam = after('Is the "mailbox 98% full" email a scam?', [phishing]);
    expect(scam).toContain(
      "I found 1 email. The first: “Action required: your mailbox is 98% full” from Mail Administrator.",
    );
    expect(scam).toContain("I can't tell whether an email is a scam");
    expect(after("Take care of Mail Administrator's email.", [phishing])).toContain(
      "I can't write the reply",
    );
    // Asked whether someone replied, not for a reply.
    const replied = after("Did admin@mailbox-verify-secure.test reply?", [phishing]);
    expect(replied).not.toContain("I can't write the reply");
    expect(replied).toContain("I can't read them and work that out");
    expect(after("Do any of my train tickets qualify for Delay Repay?", [])).toContain(
      "I found no email that matches.",
    );
    expect(after("Check my mail", [phishing, phishing])).toMatch(/^There are 2 recent emails\./);
  });

  it("calls a fixed table an example, not an answer", () => {
    const reply = contentOf(
      scriptedReply(
        req([
          { role: "user", content: "Compare three ways to back up my photos in a table." },
          {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "c1", type: "function", function: { name: "show_table", arguments: "{}" } }],
          },
          { role: "tool", tool_call_id: "c1", content: JSON.stringify({ ok: true, data: { shown: true } }) },
        ]),
      ),
    );
    expect(reply).toContain("It's a fixed example");
  });

  it("reads a routine's firing for what the routine asks, not its frame", () => {
    const fired = `${"One of your routines is firing right now, on its schedule, and this is that firing. Carry out the instruction below in this turn: do the work now, then say what happened. Do not create, list or change any routine unless the instruction itself asks you to."}\n\nSend me my brief`;
    expect(toolOf(ask(fired))?.name).toBe("brief_today");
  });

  it("calls itself by its whole name, and ends the brief's first line once", () => {
    const named = scriptedReply({
      model: "steward-scripted",
      messages: [
        { role: "system", content: "You are Focus time guard, a bot that keeps your mornings clear." },
        { role: "user", content: "hello" },
      ],
      tools: ALL_TOOLS,
    });
    expect(contentOf(named)).toMatch(/^Hi\. I'm Focus time guard, running on the scripted demo model/);
    const brief = contentOf(
      scriptedReply(
        req([
          { role: "user", content: "What needs me today?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "c1", type: "function", function: { name: "brief_today", arguments: "{}" } }],
          },
          {
            role: "tool",
            tool_call_id: "c1",
            content: JSON.stringify({
              ok: true,
              data: {
                needsYou: [{ subject: "Q4 north figures before Tuesday's review?", reason: "Dana asks." }],
              },
            }),
          },
        ]),
      ),
    );
    expect(brief).toContain("The first: Q4 north figures before Tuesday's review. Dana asks.");
  });
});

describe("parsers", () => {
  it("reads schedules", () => {
    expect(parseRoutine("Every day at 6pm, summarise the news")?.schedule).toBe("0 18 * * *");
    expect(parseRoutine("every monday at 9:30 send me a plan")?.schedule).toBe("30 9 * * 1");
    expect(parseRoutine("every weekday morning check my calendar")).toMatchObject({
      schedule: "0 8 * * 1-5",
      prompt: "Check my calendar",
      title: "Check my calendar",
    });
    expect(parseRoutine("every friday evening, tidy my workspace")?.schedule).toBe("0 18 * * 5");
    expect(parseRoutine("check my mail")).toBeUndefined();
  });

  it("reads email requests", () => {
    expect(parseEmail("send a note to a@example.com and b@example.com saying the room moved")).toEqual({
      to: ["a@example.com", "b@example.com"],
      subject: "A quick note",
      body: "The room moved",
    });
    expect(parseEmail("email the team")).toBeUndefined();
  });

  it("reads sites", () => {
    expect(parseSite("go to https://example.com/x.")).toBe("https://example.com/x");
    expect(parseSite("open the pod bay doors")).toBeUndefined();
  });
});

describe("the scripted model behind the real agent", () => {
  let created: CreatedModel;
  let fakes: Fakes;

  beforeAll(async () => {
    created = await createModel({ provider: "scripted", model: "steward-scripted" }, {});
  });

  afterAll(async () => {
    await created.close();
  });

  beforeEach(() => {
    fakes = makeFakes();
  });

  const say = (events: BaseEvent[]) =>
    events
      .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
      .map((e) => (e as unknown as { delta: string }).delta)
      .join("");

  it("answers a greeting without any network beyond loopback", async () => {
    const turn = await runTurn(createStewardAgent(depsFrom(fakes, created.model)), [user("hi")]);
    expect(turn.error).toBeUndefined();
    expect(say(turn.events)).toMatch(/^Hi\. I'm Steward, running on the scripted demo model/);
  });

  it("builds the brief through the gateway and summarises it, labelling the demo inbox", async () => {
    const turn = await runTurn(createStewardAgent(depsFrom(fakes, created.model)), [
      user("What needs me today?"),
    ]);
    expect(fakes.governance.callsFor("brief_today")).toHaveLength(1);
    expect(fakes.brief.generated).toBe(1);
    const reply = say(turn.events);
    expect(reply).toContain("1 thing needs you today. The first: Confirm Thursday delivery.");
    expect(reply).toContain("This is the demo inbox");
    expect(reply).toContain(SCRIPTED_NOTE);
  });

  it("reads the top story from the page it opened", async () => {
    const turn = await runTurn(createStewardAgent(depsFrom(fakes, created.model)), [
      user("Open news.ycombinator.com and tell me the top story."),
    ]);
    expect(fakes.computers.computer("steward").actions).toEqual(["navigate https://news.ycombinator.com/"]);
    expect(say(turn.events)).toContain("“A tiny SQLite trick that saves an hour a day”");
  });

  it("takes Start on an email from Today to that email, and never asks who to send it to", async () => {
    const turn = await runTurn(createStewardAgent(depsFrom(fakes, created.model)), [
      user("Take care of ops@example.com's email: Confirm Thursday delivery"),
    ]);
    expect(turn.error).toBeUndefined();
    expect(fakes.governance.callsFor("mail_list")).toHaveLength(1);
    expect(fakes.governance.callsFor("mail_send")).toHaveLength(0);
    const reply = say(turn.events);
    expect(reply).toContain("The first: “Confirm Thursday delivery” from ops@example.com.");
    expect(reply).toContain("I can't write the reply");
    expect(reply).not.toContain("Who should I send it to?");
  });

  it("parks an email for approval, then sends it on resume", async () => {
    fakes.governance.decide = (c) => (c.tool.kind === "send" ? "ask" : "allow");
    const agent = createStewardAgent(depsFrom(fakes, created.model));
    const parked = await runTurn(agent, [user("Email sam@example.com about Friday: see you at 10")]);
    const finished = parked.events.at(-1) as unknown as {
      outcome?: { type: string; interrupts: { id: string }[] };
    };
    expect(finished.outcome?.type).toBe("interrupt");
    const id = finished.outcome?.interrupts[0]?.id ?? "";
    fakes.governance.answers.set(id, "once");
    const resumed = await runTurn(agent, parked.messages, {
      resume: [{ interruptId: id, status: "resolved" }],
    });
    expect(fakes.mail.sent).toEqual([
      { to: [{ email: "sam@example.com" }], subject: "Friday", body: "See you at 10" },
    ]);
    expect(say(resumed.events)).toContain("Sent to sam@example.com.");
  });
});
