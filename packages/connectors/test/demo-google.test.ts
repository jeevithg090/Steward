import { describe, expect, it } from "vitest";
import { createDemoGoogleApp } from "../src/google/demo-app.ts";
import { DEMO_ACCOUNT, DEMO_LABEL, DEMO_TIME_ZONE } from "../src/google/demo-constants.ts";
import {
  base64UrlDecode,
  base64UrlEncode,
  buildMessage,
  headerValue,
  parseMessage,
} from "../src/google/mime.ts";
import { clock, dateKey } from "../src/google/time.ts";
import { htmlToText } from "../src/web/html-to-text.ts";

/** Tuesday 27 October 2026, 08:30 in London (GMT, after the clocks went back). */
const TUESDAY = new Date("2026-10-27T08:30:00Z");
const GMAIL = "/gmail/v1/users/me";
const CAL = "/calendar/v3/calendars/primary";

type Header = { name: string; value: string };
type Part = { mimeType: string; headers?: Header[]; body: { size: number; data?: string }; parts?: Part[] };
type Message = {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string;
  payload?: Part;
  raw?: string;
};
type GoogleEvent = {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string };
  hangoutLink?: string;
  attendees?: { email: string; responseStatus: string }[];
};

function demo(now: () => Date = () => TUESDAY) {
  const app = createDemoGoogleApp({ now });
  const get = async <T>(path: string) => {
    const res = await app.request(path);
    return { status: res.status, body: (await res.json()) as T };
  };
  const post = async <T>(path: string, body: unknown) => {
    const res = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  const ids = async (q = "", extra = "") =>
    (
      await get<{ messages?: { id: string }[] }>(
        `${GMAIL}/messages?maxResults=500&q=${encodeURIComponent(q)}${extra}`,
      )
    ).body.messages ?? [];
  const full = async (id: string) => (await get<Message>(`${GMAIL}/messages/${id}?format=full`)).body;
  return { app, get, post, ids, full };
}

function bodyText(m: Message): string {
  const find = (p: Part | undefined, type: string): Part | undefined =>
    p?.mimeType === type && p.body.data ? p : p?.parts?.map((c) => find(c, type)).find(Boolean);
  const plain = find(m.payload, "text/plain");
  if (plain?.body.data) return base64UrlDecode(plain.body.data);
  const html = find(m.payload, "text/html");
  return html?.body.data ? htmlToText(base64UrlDecode(html.body.data)).text : "";
}

describe("demo Google: the mailbox", () => {
  it("says it is a demo on its front page", async () => {
    const { get } = demo();
    const { body } = await get<{ demo: boolean; account: string; about: string }>("/");
    expect(body).toMatchObject({ demo: true, account: DEMO_ACCOUNT });
    expect(body.about).toMatch(/Nothing here is real/);
  });

  it("serves about thirty messages, newest first, every one labelled Demo", async () => {
    const { ids, full } = demo();
    const list = await ids();
    expect(list.length).toBeGreaterThanOrEqual(28);
    const messages = await Promise.all(list.map((m) => full(m.id)));
    const dates = messages.map((m) => Number(m.internalDate));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    for (const m of messages) expect(m.labelIds).toContain(DEMO_LABEL.id);
  });

  it("never addresses the person by a name", async () => {
    const { ids, full } = demo();
    const messages = await Promise.all((await ids("in:inbox")).map((m) => full(m.id)));
    const allowedAfterGreeting = new Set(["all", "everyone", "user", "there"]);
    for (const m of messages) {
      expect(headerValue(m.payload?.headers ?? [], "To")).toBe(DEMO_ACCOUNT);
      const first =
        bodyText(m)
          .split("\n")
          .find((l) => l.trim()) ?? "";
      const greeting = /^(?:hi|hello|hey|dear|good (?:morning|afternoon|evening))\b[\s,!]*([A-Za-z]+)?/i.exec(
        first,
      );
      if (greeting?.[1]) expect(allowedAfterGreeting.has(greeting[1].toLowerCase()), `${first}`).toBe(true);
    }
  });

  it("mixes mail that needs the person with mail that can wait", async () => {
    const { ids, full } = demo();
    const subjects = await Promise.all(
      (await ids("in:inbox")).map(async (m) =>
        headerValue((await full(m.id)).payload?.headers ?? [], "Subject"),
      ),
    );
    const all = subjects.join("\n");
    for (const needle of [
      /Boiler/,
      /medication review/,
      /Invoice/,
      /Q4 north figures/,
      /parcel/,
      /New sign-in/,
      /Saturday\?/,
    ]) {
      expect(all).toMatch(needle);
    }
    expect((await ids("category:promotions")).length).toBeGreaterThanOrEqual(2);
    expect((await ids("category:social")).length).toBeGreaterThanOrEqual(2);
  });

  it("dates everything relative to now", async () => {
    const { ids, full } = demo();
    const messages = await Promise.all((await ids()).map((m) => full(m.id)));
    const newest = Number(messages[0]?.internalDate);
    expect(TUESDAY.getTime() - newest).toBeLessThan(60 * 60_000);
    for (const m of messages) {
      const at = Number(m.internalDate);
      expect(at).toBeLessThanOrEqual(TUESDAY.getTime());
      expect(TUESDAY.getTime() - at).toBeLessThan(6 * 86_400_000);
      expect(Date.parse(headerValue(m.payload?.headers ?? [], "Date") ?? "")).toBe(at);
    }
    expect((await ids("newer_than:1d")).length).toBeGreaterThanOrEqual(12);
  });

  it("puts List-Unsubscribe on newsletters and Auto-Submitted on auto-replies", async () => {
    const { ids, full } = demo();
    const promo = await full((await ids("subject:winter coats"))[0]?.id ?? "");
    expect(promo.labelIds).toContain("CATEGORY_PROMOTIONS");
    expect(headerValue(promo.payload?.headers ?? [], "List-Unsubscribe")).toMatch(/^<https:/);
    const auto = await full((await ids('subject:"automatic reply"'))[0]?.id ?? "");
    expect(headerValue(auto.payload?.headers ?? [], "Auto-Submitted")).toBe("auto-replied");
  });
});

describe("demo Google: search", () => {
  it("filters with Gmail operators", async () => {
    const { ids } = demo();
    const all = await ids();
    const unread = await ids("is:unread");
    const read = await ids("-is:unread");
    expect(unread.length + read.length).toBe(all.length);
    expect(unread.length).toBeGreaterThan(10);
    expect((await ids("from:dana.whitfield")).length).toBe(2);
    expect((await ids("subject:invoice")).length).toBe(1);
    expect((await ids("in:sent")).length).toBe(1);
    expect((await ids("label:demo")).length).toBe(all.length);
    expect((await ids("subject:invoice OR subject:saturday")).length).toBe(4);
    expect((await ids('subject:invoice OR subject:"photos from"')).length).toBe(2);
    expect((await ids("Hampstead OR Heath")).length).toBe(1);
    expect((await ids("newer_than:1d")).length).toBeLessThan(all.length);
  });

  it("pages with maxResults and pageToken, and omits messages when nothing matches", async () => {
    const { get } = demo();
    type Page = { messages?: { id: string }[]; nextPageToken?: string; resultSizeEstimate: number };
    const first = (await get<Page>(`${GMAIL}/messages?maxResults=10`)).body;
    expect(first.messages).toHaveLength(10);
    expect(first.nextPageToken).toBe("10");
    const second = (await get<Page>(`${GMAIL}/messages?maxResults=10&pageToken=${first.nextPageToken}`)).body;
    expect(second.messages?.[0]?.id).not.toBe(first.messages?.[0]?.id);
    const none = (await get<Page>(`${GMAIL}/messages?q=${encodeURIComponent("from:nobody.here")}`)).body;
    expect(none).toEqual({ resultSizeEstimate: 0 });
  });

  it("filters by labelIds", async () => {
    const { get } = demo();
    const res = await get<{ resultSizeEstimate: number }>(`${GMAIL}/messages?labelIds=INBOX&labelIds=UNREAD`);
    const unreadInbox = await get<{ resultSizeEstimate: number }>(`${GMAIL}/messages?q=in:inbox%20is:unread`);
    expect(res.body.resultSizeEstimate).toBe(unreadInbox.body.resultSizeEstimate);
  });
});

describe("demo Google: one message", () => {
  it("serves full, metadata, minimal and raw formats", async () => {
    const { ids, get } = demo();
    const id = (await ids("subject:boiler in:inbox"))[0]?.id ?? "";
    const full = (await get<Message>(`${GMAIL}/messages/${id}?format=full`)).body;
    expect(full.payload?.mimeType).toBe("text/plain");
    expect(bodyText(full)).toMatch(/Gas Safe engineer/);
    expect(full.snippet).toMatch(/^Hi, Thanks for reporting this/);

    const meta = (
      await get<Message>(
        `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      )
    ).body;
    expect(meta.payload?.headers?.map((h) => h.name)).toEqual(["Subject", "From"]);
    expect(meta.payload?.body).toBeUndefined();
    expect(meta.snippet).toBe(full.snippet);

    const minimal = (await get<Message>(`${GMAIL}/messages/${id}?format=minimal`)).body;
    expect(minimal.payload).toBeUndefined();

    const raw = (await get<Message>(`${GMAIL}/messages/${id}?format=raw`)).body;
    const parsed = parseMessage(Buffer.from(raw.raw ?? "", "base64url"));
    expect(headerValue(parsed.headers, "Subject")).toMatch(/^Re: Boiler/);
    expect(parsed.text).toMatch(/Gas Safe engineer/);
  });

  it("threads the landlord's reply with the person's own report", async () => {
    const { ids, full } = demo();
    const reply = await full((await ids("subject:boiler in:inbox"))[0]?.id ?? "");
    const report = await full((await ids("subject:boiler in:sent"))[0]?.id ?? "");
    expect(reply.threadId).toBe(report.id);
    expect(headerValue(reply.payload?.headers ?? [], "In-Reply-To")).toBe(
      headerValue(report.payload?.headers ?? [], "Message-ID"),
    );
    expect(report.labelIds).toEqual(["SENT", DEMO_LABEL.id]);
  });

  it("sends newsletters as multipart/alternative and some mail as HTML only", async () => {
    const { ids, full } = demo();
    const news = await full((await ids("from:citywise"))[0]?.id ?? "");
    expect(news.payload?.mimeType).toBe("multipart/alternative");
    expect(news.payload?.parts?.map((p) => p.mimeType)).toEqual(["text/plain", "text/html"]);
    const kitchen = await full((await ids("from:kitchenly"))[0]?.id ?? "");
    expect(kitchen.payload?.mimeType).toBe("text/html");
    expect(bodyText(kitchen)).toMatch(/Cast-iron casserole/);
    expect(kitchen.snippet).not.toMatch(/#/);
  });

  it("answers unknown ids, bad formats and other accounts like Google", async () => {
    const { get } = demo();
    const missing = await get<{ error: { code: number; status: string } }>(
      `${GMAIL}/messages/ffffffffffffffff`,
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatchObject({ code: 404, status: "NOT_FOUND" });
    expect((await get(`${GMAIL}/messages/ffffffffffffffff?format=weird`)).status).toBe(404);
    expect((await get("/gmail/v1/users/someone@else.example/messages")).status).toBe(403);
    expect((await get("/gmail/v1/nope")).status).toBe(404);
  });

  it("lists labels with Demo as a user label", async () => {
    const { get } = demo();
    const { body } = await get<{ labels: { id: string; name: string; type: string }[] }>(`${GMAIL}/labels`);
    expect(body.labels).toContainEqual(
      expect.objectContaining({ id: DEMO_LABEL.id, name: "Demo", type: "user" }),
    );
  });
});

describe("demo Google: sending", () => {
  const send = (raw: string, threadId?: string) => ({
    raw: base64UrlEncode(raw),
    ...(threadId ? { threadId } : {}),
  });

  it("records what was sent, decoded, and files it under Sent", async () => {
    const { post, get, ids } = demo();
    const raw = buildMessage({
      to: [{ name: "Jamie Rivera", email: "jamie.r@example.net" }],
      cc: [{ email: "sam@example.net" }],
      subject: "Re: Saturday? Yes, count me in",
      text: "Hey!\n\nCount me in for Saturday. £12 each is fine.",
    });
    const res = await post<{ id: string; threadId: string; labelIds: string[] }>(
      `${GMAIL}/messages/send`,
      send(raw),
    );
    expect(res.status).toBe(200);
    expect(res.body.labelIds).toEqual(["SENT"]);
    const sent = (
      await get<{ id: string; to: string[]; cc: string[]; subject: string; body: string }[]>("/__demo/sent")
    ).body;
    expect(sent).toEqual([
      expect.objectContaining({
        id: res.body.id,
        to: ["jamie.r@example.net"],
        cc: ["sam@example.net"],
        subject: "Re: Saturday? Yes, count me in",
        body: "Hey!\n\nCount me in for Saturday. £12 each is fine.",
      }),
    ]);
    expect((await ids("in:sent")).map((m) => m.id)).toContain(res.body.id);
  });

  it("joins the thread of the message it replies to", async () => {
    const { post, ids, full } = demo();
    const original = await full((await ids("from:dana.whitfield subject:Q4"))[0]?.id ?? "");
    const messageId = headerValue(original.payload?.headers ?? [], "Message-ID") ?? "";
    const raw = buildMessage({
      to: [{ email: "dana.whitfield@corvid-analytics.example" }],
      subject: "Re: Q4",
      text: "412 still stands.",
      inReplyTo: messageId,
    });
    const res = await post<{ threadId: string }>(`${GMAIL}/messages/send`, send(raw));
    expect(res.body.threadId).toBe(original.threadId);
  });

  it("refuses a send with no raw message or no recipients", async () => {
    const { post } = demo();
    expect((await post(`${GMAIL}/messages/send`, {})).status).toBe(400);
    const noOne = await post<{ error: { message: string } }>(
      `${GMAIL}/messages/send`,
      send("Subject: Hello\r\n\r\nNobody to send to"),
    );
    expect(noOne.status).toBe(400);
    expect(noOne.body.error.message).toBe("Recipient address required");
  });

  it("forgets sent mail on reset, and delivers new mail on request", async () => {
    const { post, get, ids } = demo();
    await post(
      `${GMAIL}/messages/send`,
      send(buildMessage({ to: [{ email: "a@b.example" }], subject: "x", text: "y" })),
    );
    expect((await get<unknown[]>("/__demo/sent")).body).toHaveLength(1);
    expect((await post<{ ok: boolean }>("/__demo/reset", {})).body).toEqual({ ok: true });
    expect((await get<unknown[]>("/__demo/sent")).body).toHaveLength(0);

    const before = (await ids("is:unread")).length;
    const delivered = await post<{ id: string }>("/__demo/deliver", {
      from: "Ravi Desai <ravi@example.org>",
      subject: "Lunch tomorrow?",
      body: "Are you free for lunch tomorrow?",
    });
    expect(delivered.status).toBe(201);
    const unread = await ids("is:unread");
    expect(unread).toHaveLength(before + 1);
    expect(unread[0]?.id).toBe(delivered.body.id);
    expect((await post("/__demo/deliver", { from: "x@y.example" })).status).toBe(400);
  });
});

describe("demo Google: the calendar", () => {
  const today = (now: Date) => {
    const key = dateKey(now, DEMO_TIME_ZONE);
    return { timeMin: `${key}T00:00:00Z`, timeMax: `${key}T23:59:59Z` };
  };
  const events = async (
    d: ReturnType<typeof demo>,
    timeMin: string,
    timeMax: string,
    extra = "&singleEvents=true&orderBy=startTime",
  ) =>
    d.get<{ items: GoogleEvent[]; timeZone: string }>(
      `${CAL}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}${extra}`,
    );

  it("serves today's events in order, in Europe/London, with one in the evening", async () => {
    const d = demo();
    const { timeMin, timeMax } = today(TUESDAY);
    const { status, body } = await events(d, timeMin, timeMax);
    expect(status).toBe(200);
    expect(body.timeZone).toBe("Europe/London");
    const titles = body.items.map((e) => e.summary);
    expect(titles).toEqual([
      "Team stand-up",
      "Lunch with Sophie",
      "Call with Brightline about the templates",
      "Quiz night at The Crown",
    ]);
    const starts = body.items.map((e) => clock(new Date(e.start.dateTime ?? ""), DEMO_TIME_ZONE));
    expect(starts).toEqual(["09:30", "12:30", "15:00", "19:00"]);
    expect(body.items[0]?.start.timeZone).toBe("Europe/London");
    expect(body.items[0]?.hangoutLink).toMatch(/^https:\/\/meet\.example\.com\//);
  });

  it("serves the rest of the week, including an all-day event", async () => {
    const d = demo();
    const { body } = await events(d, "2026-10-27T00:00:00Z", "2026-11-03T00:00:00Z");
    expect(body.items.length).toBeGreaterThanOrEqual(10);
    expect(body.items.find((e) => e.summary === "Recycling collection")?.start).toEqual({
      date: "2026-10-28",
    });
  });

  it("keeps work events off the weekend", async () => {
    const saturday = new Date("2026-10-31T10:00:00Z");
    const d = demo(() => saturday);
    const { timeMin, timeMax } = today(saturday);
    const titles = (await events(d, timeMin, timeMax)).body.items.map((e) => e.summary);
    expect(titles).not.toContain("Team stand-up");
    expect(titles).toContain("Quiz night at The Crown");
  });

  it("writes summer times with the British Summer Time offset", async () => {
    const july = new Date("2026-07-14T07:00:00Z");
    const d = demo(() => july);
    const { body } = await events(d, "2026-07-14T00:00:00Z", "2026-07-15T00:00:00Z");
    const standup = body.items.find((e) => e.summary === "Team stand-up");
    expect(standup?.start.dateTime).toBe("2026-07-14T09:30:00+01:00");
  });

  it("refuses startTime ordering without singleEvents, and bad times, like Google", async () => {
    const d = demo();
    expect(
      (await events(d, "2026-10-27T00:00:00Z", "2026-10-28T00:00:00Z", "&orderBy=startTime")).status,
    ).toBe(400);
    expect((await events(d, "yesterday", "2026-10-28T00:00:00Z")).status).toBe(400);
    expect((await events(d, "2026-10-27T00:00:00", "2026-10-28T00:00:00Z")).status).toBe(400);
  });

  it("inserts events, then lists them", async () => {
    const d = demo();
    const created = await d.post<GoogleEvent>(`${CAL}/events`, {
      summary: "Boiler engineer visit",
      location: "Flat 3, 27 Kestrel Road",
      start: { dateTime: "2026-10-29T08:00:00Z" },
      end: { dateTime: "2026-10-29T10:00:00Z" },
      attendees: [{ email: "helen.marsh@northgate-lettings.test", displayName: "Helen Marsh" }],
    });
    expect(created.status).toBe(200);
    expect(created.body.attendees?.[0]?.responseStatus).toBe("needsAction");
    const { body } = await events(d, "2026-10-29T00:00:00Z", "2026-10-30T00:00:00Z");
    expect(body.items.map((e) => e.summary)).toContain("Boiler engineer visit");
    const allDay = await d.post<GoogleEvent>(`${CAL}/events`, {
      summary: "Leave",
      start: { date: "2026-11-02" },
      end: { date: "2026-11-03" },
    });
    expect(allDay.body.start).toEqual({ date: "2026-11-02" });
  });

  it("refuses events without a start or end, or that end before they start", async () => {
    const d = demo();
    const noEnd = await d.post<{ error: { message: string } }>(`${CAL}/events`, {
      summary: "x",
      start: { dateTime: "2026-10-29T08:00:00Z" },
    });
    expect(noEnd.status).toBe(400);
    expect(noEnd.body.error.message).toBe("Missing end time.");
    const backwards = await d.post(`${CAL}/events`, {
      start: { dateTime: "2026-10-29T10:00:00Z" },
      end: { dateTime: "2026-10-29T08:00:00Z" },
    });
    expect(backwards.status).toBe(400);
  });
});

describe("demo Google: the days move on", () => {
  it("re-dates the mailbox when the London day changes, keeping what was sent", async () => {
    let now = TUESDAY;
    const d = demo(() => now);
    const raw = buildMessage({
      to: [{ email: "a@b.example" }],
      subject: "Kept",
      text: "Still here tomorrow",
    });
    await d.post(`${GMAIL}/messages/send`, { raw: base64UrlEncode(raw) });

    now = new Date("2026-10-28T08:30:00Z");
    const inbox = await d.ids("in:inbox");
    const newest = await d.full(inbox[0]?.id ?? "");
    expect(now.getTime() - Number(newest.internalDate)).toBeLessThan(60 * 60_000);
    expect((await d.get<unknown[]>("/__demo/sent")).body).toHaveLength(1);
    const { body } = await d.get<{ items: GoogleEvent[] }>(
      `${CAL}/events?timeMin=2026-10-28T00:00:00Z&timeMax=2026-10-29T00:00:00Z&singleEvents=true&orderBy=startTime`,
    );
    expect(body.items.map((e) => e.summary)).toContain("Quiz night at The Crown");
  });
});
