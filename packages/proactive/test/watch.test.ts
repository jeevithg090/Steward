import { describe, expect, it } from "vitest";
import type { TriageEmail } from "../src/triage.ts";
import { WATCH_MAIL_LIMIT, WATCH_NOTES, WATCH_QUERY } from "../src/watch.ts";
import { email, fakeMail, fakeModel, setup, subjectModel } from "./helpers.ts";

const TODAY = "2026-10-22";

/** A proactive on a mailbox that can get new mail, with the subject model ("!" needs you). */
function watching(opts: { isDemo?: boolean; model?: boolean; failEmails?: boolean } = {}) {
  const inbox: TriageEmail[] = [email({ subject: "Morning invoice!" }), email({ subject: "Newsletter" })];
  const model = subjectModel();
  const mail = fakeMail({
    emails: inbox,
    isDemo: opts.isDemo ?? false,
    ...(opts.failEmails ? { failEmails: true } : {}),
  });
  const p = setup({
    at: "2026-10-22T11:00:00Z",
    mail: () => mail,
    model: () => (opts.model === false ? undefined : model),
  });
  return { ...p, inbox, model, mail };
}

describe("the inbox watch", () => {
  it("is off until switched on, and does nothing while off", async () => {
    const { watch, mail, model } = watching();
    expect(watch.status()).toEqual({ enabled: false });
    expect(await watch.check()).toEqual({ enabled: false });
    expect(mail.emailQueries).toEqual([]);
    expect(model.calls).toEqual([]);
    expect(watch.setEnabled(true)).toEqual({ enabled: true });
    expect(watch.status().enabled).toBe(true);
  });

  it("says why it could not look, and never claims it checked", async () => {
    const noModel = watching({ model: false });
    noModel.watch.setEnabled(true);
    const said = await noModel.watch.check();
    expect(said).toMatchObject({
      enabled: true,
      note: WATCH_NOTES.noModel,
      noteAt: "2026-10-22T11:00:00.000Z",
    });
    expect(said.checkedAt).toBeUndefined();
    expect(noModel.mail.emailQueries).toEqual([]);

    const noMail = setup({ mail: () => undefined, model: () => subjectModel() });
    noMail.watch.setEnabled(true);
    expect((await noMail.watch.check()).note).toBe(WATCH_NOTES.noMail);

    const noBrief = watching();
    noBrief.watch.setEnabled(true);
    expect((await noBrief.watch.check()).note).toBe(WATCH_NOTES.noBrief);
    expect(noBrief.model.calls).toEqual([]);
  });

  it("suggests new mail that needs you, once, and tells the person once", async () => {
    const { watch, brief, inbox, model, mail, tasks, notifications, clock } = watching();
    await brief.generate({ date: TODAY });
    const suggestedByBrief = tasks.list({ state: ["suggested"] }).length;
    watch.setEnabled(true);
    model.calls.length = 0;

    // Two new emails after the brief: one needs you, one can wait.
    inbox.unshift(
      email({
        subject: "Friday ship date!",
        from: { name: "Ana Pereira", email: "ana@hearthandco.example" },
      }),
      email({ subject: "Weekly digest" }),
    );
    clock.set("2026-10-22T11:30:00Z");
    const looked = await watch.check();
    expect(mail.emailQueries.at(-1)).toEqual({ query: WATCH_QUERY, limit: WATCH_MAIL_LIMIT });
    // Only the two new emails went to the model; the brief's were already sorted.
    expect(model.calls.map((c) => /Subject: (.*)/.exec(c.prompt)?.[1])).toEqual([
      "Friday ship date!",
      "Weekly digest",
    ]);
    expect(looked).toEqual({
      enabled: true,
      checkedAt: "2026-10-22T11:30:00.000Z",
      note: "Read 2 new emails; suggested 1 task.",
      noteAt: "2026-10-22T11:30:00.000Z",
    });
    const suggested = tasks.list({ state: ["suggested"] });
    expect(suggested).toHaveLength(suggestedByBrief + 1);
    expect(suggested.map((t) => t.title)).toContain("Reply to Ana Pereira about Friday ship date!");
    expect(notifications.list()[0]).toMatchObject({
      title: "New mail needs you",
      body: "Ana Pereira: Friday ship date!",
      href: "/tasks?view=suggested",
      level: "needs_you",
    });

    // The next look finds nothing new: no model calls, no second suggestion or notification.
    const before = notifications.list().length;
    model.calls.length = 0;
    clock.set("2026-10-22T12:00:00Z");
    const again = await watch.check();
    expect(model.calls).toEqual([]);
    expect(again).toMatchObject({
      checkedAt: "2026-10-22T12:00:00.000Z",
      note: "Nothing new since the brief or the last look.",
    });
    expect(tasks.list({ state: ["suggested"] })).toHaveLength(suggestedByBrief + 1);
    expect(notifications.list()).toHaveLength(before);
  });

  it("suggests at most two per look, in one notification, labelled when it is the demo inbox", async () => {
    const { watch, brief, inbox, notifications, tasks } = watching({ isDemo: true });
    await brief.generate({ date: TODAY });
    watch.setEnabled(true);
    const before = tasks.list({ state: ["suggested"] }).length;
    const notesBefore = notifications.list().length;
    inbox.unshift(
      email({ subject: "One!", from: { name: "Ana Pereira", email: "ana@hearthandco.example" } }),
      email({ subject: "Two!", from: { name: "Ben Ode", email: "ben@example.org" } }),
      email({ subject: "Three!", from: { name: "Cy Lim", email: "cy@example.org" } }),
    );
    expect((await watch.check()).note).toBe("Read 3 new emails; suggested 2 tasks.");
    expect(tasks.list({ state: ["suggested"] })).toHaveLength(before + 2);
    expect(notifications.list()).toHaveLength(notesBefore + 1);
    expect(notifications.list()[0]?.body).toBe("From the demo inbox: Ana Pereira: One! and 1 more");
    // The third is not lost to the cap: the next look comes back to it.
    expect((await watch.check()).note).toBe("Read 1 new email; suggested 1 task.");
    expect(tasks.list({ state: ["suggested"] })).toHaveLength(before + 3);
    expect(notifications.list()[0]?.body).toBe("From the demo inbox: Cy Lim: Three!");
  });

  it("tries mail the model could not sort again on the next look, and says so", async () => {
    let flaky = true;
    const inbox: TriageEmail[] = [];
    const model = fakeModel(({ prompt }) => {
      const subject = /Subject: (.*)/.exec(prompt)?.[1] ?? "";
      if (subject === "Flaky!" && flaky) throw new Error("model is down, key=sk-123");
      return subject.includes("!")
        ? '{"verdict":"needs_you","reason":"Asks you to answer today."}'
        : '{"verdict":"can_wait","reason":"Nothing to do here."}';
    });
    const mail = fakeMail({ emails: inbox });
    const { watch, brief, tasks } = setup({
      at: "2026-10-22T11:00:00Z",
      mail: () => mail,
      model: () => model,
    });
    await brief.generate({ date: TODAY });
    watch.setEnabled(true);
    inbox.unshift(email({ subject: "Flaky!" }), email({ subject: "Fine" }));
    const first = await watch.check();
    expect(first.note).toBe(
      "Read 2 new emails; nothing new needs you, and 1 couldn't be sorted. It will try them again.",
    );
    expect(first.note).not.toMatch(/sk-123/);
    flaky = false;
    expect((await watch.check()).note).toBe("Read 1 new email; suggested 1 task.");
    expect(tasks.list({ state: ["suggested"] }).map((t) => t.title)).toContain(
      "Reply to Ana Pereira about Flaky!",
    );
  });

  it("reads a mailbox that does not understand the query, keeping only the last day", async () => {
    const inbox: TriageEmail[] = [];
    const mail = fakeMail({ emails: inbox, ignoresQuery: true });
    const model = subjectModel();
    const { watch, brief, tasks } = setup({
      at: "2026-10-22T11:00:00Z",
      mail: () => mail,
      model: () => model,
    });
    await brief.generate({ date: TODAY });
    watch.setEnabled(true);
    inbox.unshift(
      email({ subject: "Contract today!", from: { name: "Ana Pereira", email: "ana@hearthandco.example" } }),
      email({ subject: "Old news!", receivedAt: "2026-10-19T09:00:00Z" }),
    );
    const looked = await watch.check();
    expect(mail.emailQueries.slice(-2)).toEqual([
      { query: WATCH_QUERY, limit: WATCH_MAIL_LIMIT },
      { limit: WATCH_MAIL_LIMIT },
    ]);
    expect(looked.note).toBe("Read 1 new email; suggested 1 task.");
    const titles = tasks.list({ state: ["suggested"] }).map((t) => t.title);
    expect(titles).toContain("Reply to Ana Pereira about Contract today!");
    expect(titles.some((t) => t.includes("Old news"))).toBe(false);
  });

  it("keeps the last real look when the inbox can't be read, and stores no provider text", async () => {
    const { watch, brief } = watching({ failEmails: true });
    await brief.generate({ date: TODAY });
    watch.setEnabled(true);
    const said = await watch.check();
    expect(said.note).toBe(WATCH_NOTES.readFailed);
    expect(said.checkedAt).toBeUndefined();
    expect(JSON.stringify(said)).not.toMatch(/token|abc123/);
  });

  it("never sends, replies or changes mail", async () => {
    const { watch, brief, inbox, mail } = watching();
    await brief.generate({ date: TODAY });
    watch.setEnabled(true);
    inbox.unshift(email({ subject: "Please reply now!" }));
    let acted = false;
    mail.sendEmail = async () => {
      acted = true;
      return { id: "x" };
    };
    mail.createEvent = async () => {
      acted = true;
      throw new Error("no");
    };
    await watch.check();
    expect(acted).toBe(false);
  });
});
