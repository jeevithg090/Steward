import { describe, expect, it, vi } from "vitest";
import {
  createGoogleMailCalendar,
  type GmailEmail,
  type GmailEmailSummary,
  GoogleApiError,
} from "../src/google/client.ts";
import { createDemoGoogleApp } from "../src/google/demo-app.ts";
import { base64UrlEncode } from "../src/google/mime.ts";
import type { FetchLike } from "../src/net/guarded-fetch.ts";

const TUESDAY = new Date("2026-10-27T08:30:00Z");

/** The client wired to the demo app in-process: the same requests, no sockets. */
function setup(opts: { accessToken?: string } = {}) {
  const app = createDemoGoogleApp({ now: () => TUESDAY });
  const fetch = vi.fn<FetchLike>((input, init) => Promise.resolve(app.fetch(new Request(input, init))));
  const mail = createGoogleMailCalendar({
    baseUrl: "http://demo.test/",
    label: "Demo inbox",
    isDemo: true,
    fetch,
    ...opts,
  });
  const sent = async () =>
    (await (await app.request("/__demo/sent")).json()) as {
      id: string;
      threadId: string;
      to: string[];
      cc: string[];
      subject: string;
      body: string;
      inReplyTo?: string;
    }[];
  return { app, mail, fetch, sent };
}

describe("MailCalendar over the demo server: mail", () => {
  it("labels itself as the demo", () => {
    const { mail } = setup();
    expect(mail).toMatchObject({ id: "demo-google", label: "Demo inbox", isDemo: true });
  });

  it("lists the inbox newest first, with senders, snippets and labels decoded", async () => {
    const { mail } = setup();
    const list = (await mail.listEmails({ limit: 50 })) as GmailEmailSummary[];
    expect(list.length).toBeGreaterThanOrEqual(28);
    expect(list.every((e) => e.labels.includes("INBOX") && e.labels.includes("Demo"))).toBe(true);
    const times = list.map((e) => e.receivedAt);
    expect(times).toEqual([...times].sort().reverse());

    const landlord = list.find((e) => e.subject.startsWith("Re: Boiler"));
    expect(landlord).toMatchObject({
      from: { name: "Helen Marsh", email: "helen.marsh@northgate-lettings.test" },
      to: [{ email: "you@demo.steward.local" }],
      unread: true,
    });
    const friend = list.find((e) => e.subject === "Saturday?");
    expect(friend?.snippet).toMatch(/^Hey! Are you still up for/);
    expect(list.some((e) => e.snippet.includes("&#39;") || e.snippet.includes("&amp;"))).toBe(false);
  });

  it("carries the headers triage needs", async () => {
    const { mail } = setup();
    const list = (await mail.listEmails({ limit: 50 })) as GmailEmailSummary[];
    const promo = list.find((e) => e.from.email.startsWith("offers@"));
    expect(promo?.headers["List-Unsubscribe"]).toMatch(/^<https:/);
    expect(promo?.labels).toContain("CATEGORY_PROMOTIONS");
    const auto = list.find((e) => e.subject.startsWith("Automatic reply"));
    expect(auto?.headers["Auto-Submitted"]).toBe("auto-replied");
    expect(list.find((e) => e.subject === "Saturday?")?.headers).toEqual({});
  });

  it("filters by unread, by query and by limit", async () => {
    const { mail } = setup();
    const unread = await mail.listEmails({ unreadOnly: true, limit: 100 });
    expect(unread.length).toBeGreaterThan(10);
    expect(unread.every((e) => e.unread)).toBe(true);
    const dana = await mail.listEmails({ query: "from:dana.whitfield" });
    expect(dana).toHaveLength(2);
    expect(await mail.listEmails({ limit: 3 })).toHaveLength(3);
    expect(await mail.listEmails({ query: "from:nobody.at.all" })).toEqual([]);
  });

  it("reads a whole email, preferring the plain-text part", async () => {
    const { mail } = setup();
    const id = (await mail.listEmails({ query: "from:citywise" }))[0]?.id ?? "";
    const email = (await mail.getEmail(id)) as GmailEmail;
    expect(email.body).toMatch(/^This weekend in London\n\n1\. Night market/);
    expect(email.cc).toEqual([]);
    expect(email.messageId).toMatch(/^<newsletter-citywise\./);
  });

  it("falls back to the HTML part as readable text", async () => {
    const { mail } = setup();
    const id = (await mail.listEmails({ query: "from:kitchenly" }))[0]?.id ?? "";
    const email = await mail.getEmail(id);
    expect(email?.body).toContain("Cast-iron casserole, 24 cm, sage | £64.00");
    expect(email?.body).toContain("[Track your order](https://kitchenly.example/orders/KL-20417)");
    expect(email?.body).not.toMatch(/<td|font-family/);
  });

  it("reads an HTML-only email only as far as the body it keeps", async () => {
    const message = (html: string) => ({
      id: "m1",
      threadId: "t1",
      labelIds: ["INBOX"],
      internalDate: String(TUESDAY.getTime()),
      payload: {
        mimeType: "text/html",
        headers: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
        body: { data: base64UrlEncode(html) },
      },
    });
    const read = async (html: string) => {
      const fetch: FetchLike = async (input) =>
        String(input).includes("/labels") ? Response.json({ labels: [] }) : Response.json(message(html));
      const mail = createGoogleMailCalendar({
        baseUrl: "https://gmail.test",
        label: "x",
        isDemo: false,
        fetch,
      });
      return (await mail.getEmail("m1"))?.body ?? "";
    };
    const note = "[truncated: the message is longer than this]";
    // Past the first million characters of HTML nothing is read.
    const padded = await read(`<p>Early</p>${"<b></b>".repeat(200_000)}<p>Late</p>`);
    expect(padded).toBe(`Early\n\n${note}`);
    // Conversion stops once the kept body is full, before text that would only follow it.
    const breaks = await read(`${"<br>".repeat(50_000)}<p>Later</p>`);
    expect(breaks).toBe(`\n\n${note}`);
    expect(await read("<p>Short</p>")).toBe("Short");
  });

  it("returns undefined for an email that does not exist", async () => {
    const { mail } = setup();
    expect(await mail.getEmail("ffffffffffffffff")).toBeUndefined();
  });

  it("sends a new email as RFC 2822, with non-ASCII intact", async () => {
    const { mail, sent } = setup();
    const result = await mail.sendEmail({
      to: [{ name: "Jamie Rivera", email: "jamie.r@example.net" }],
      cc: [{ email: "sam@example.net" }],
      subject: "Saturday — count me in",
      body: "Hey!\n\nYes please. I'll bring the £5 for the café.",
    });
    expect(result.id).toMatch(/^[0-9a-f]{16}$/);
    expect(await sent()).toEqual([
      expect.objectContaining({
        id: result.id,
        to: ["jamie.r@example.net"],
        cc: ["sam@example.net"],
        subject: "Saturday — count me in",
        body: "Hey!\n\nYes please. I'll bring the £5 for the café.",
      }),
    ]);
  });

  it("sends a reply in the original thread, with In-Reply-To and References", async () => {
    const { mail, sent } = setup();
    const original = (await mail.listEmails({ query: "subject:boiler" }))[0];
    await mail.sendEmail({
      to: [original?.from ?? { email: "" }],
      subject: "Re: Boiler not heating water",
      body: "Hello,\n\nThe 8:00 to 10:00 slot works. Someone will be in.",
      inReplyTo: original?.id,
    });
    const [record] = await sent();
    expect(record?.threadId).toBe(original?.threadId);
    expect(record?.inReplyTo).toMatch(/^<landlord-repair\./);
  });

  it("refuses header injection and empty recipient lists before anything is sent", async () => {
    const { mail, fetch } = setup();
    fetch.mockClear();
    await expect(
      mail.sendEmail({ to: [{ email: "a@b.example" }], subject: "Hi\r\nBcc: spy@evil.test", body: "x" }),
    ).rejects.toThrow(/line breaks/);
    await expect(mail.sendEmail({ to: [], subject: "Hi", body: "x" })).rejects.toThrow(
      /at least one recipient/,
    );
    await expect(
      mail.sendEmail({ to: [{ email: "not an email" }], subject: "Hi", body: "x" }),
    ).rejects.toThrow(/doesn't look like an email address/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("MailCalendar over the demo server: calendar", () => {
  it("lists events between two times, timed ones as UTC ISO and all-day ones as dates", async () => {
    const { mail } = setup();
    const events = await mail.listEvents({ from: "2026-10-27T00:00:00Z", to: "2026-10-29T00:00:00Z" });
    const standup = events.find((e) => e.title === "Team stand-up");
    expect(standup).toMatchObject({
      start: "2026-10-27T09:30:00.000Z",
      end: "2026-10-27T09:45:00.000Z",
      allDay: false,
      meetingUrl: "https://meet.example.com/tsu-9w2p-xra",
    });
    expect(standup?.attendees).toContainEqual({
      name: "Dana Whitfield",
      email: "dana.whitfield@corvid-analytics.example",
    });
    expect(events.find((e) => e.title === "Recycling collection")).toMatchObject({
      start: "2026-10-28",
      end: "2026-10-29",
      allDay: true,
    });
    const starts = events.map((e) => (e.allDay ? `${e.start}T00:00:00.000Z` : e.start));
    expect(starts).toEqual([...starts].sort());
  });

  it("creates an event and reads it back", async () => {
    const { mail, fetch } = setup();
    const created = await mail.createEvent({
      title: "Boiler engineer visit",
      start: "2026-10-29T08:00:00Z",
      end: "2026-10-29T10:00:00Z",
      allDay: false,
      location: "Flat 3, 27 Kestrel Road",
      attendees: [{ name: "Helen Marsh", email: "helen.marsh@northgate-lettings.test" }],
      meetingUrl: "https://meet.example.com/abc",
    });
    expect(created).toMatchObject({
      title: "Boiler engineer visit",
      start: "2026-10-29T08:00:00.000Z",
      location: "Flat 3, 27 Kestrel Road",
      meetingUrl: "https://meet.example.com/abc",
    });
    const url = String(fetch.mock.calls.at(-1)?.[0]);
    expect(url).toContain("sendUpdates=none");
    const listed = await mail.listEvents({ from: "2026-10-29T00:00:00Z", to: "2026-10-30T00:00:00Z" });
    expect(listed.map((e) => e.id)).toContain(created.id);
  });

  it("creates all-day events with an exclusive end date", async () => {
    const { mail } = setup();
    const created = await mail.createEvent({
      title: "Leave",
      start: "2026-11-02",
      end: "2026-11-02",
      allDay: true,
      attendees: [],
    });
    expect(created).toMatchObject({ start: "2026-11-02", end: "2026-11-03", allDay: true });
  });
});

describe("MailCalendar: talking to Google", () => {
  it("sends the access token as a Bearer header and builds Google's URLs", async () => {
    const { mail, fetch } = setup({ accessToken: "ya29.test-token" });
    await mail.listEmails({ limit: 1 });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://demo.test/gmail/v1/users/me/messages?q=in%3Ainbox&maxResults=1");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ya29.test-token");
  });

  it("uses a separate calendar base URL when given one", async () => {
    const fetch = vi.fn<FetchLike>(async () => Response.json({ items: [] }));
    const mail = createGoogleMailCalendar({
      baseUrl: "https://gmail.googleapis.com",
      calendarBaseUrl: "https://www.googleapis.com",
      accessToken: "t",
      label: "me@example.com",
      isDemo: false,
      fetch,
    });
    expect(mail.id).toBe("google");
    await mail.listEvents({ from: "2026-10-27T00:00:00Z", to: "2026-10-28T00:00:00Z" });
    expect(String(fetch.mock.calls[0]?.[0])).toMatch(
      /^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/primary\/events\?/,
    );
  });

  it("turns Google's errors into plain sentences", async () => {
    const fetch: FetchLike = async () =>
      Response.json(
        { error: { code: 401, message: "Request had invalid authentication credentials." } },
        { status: 401 },
      );
    const mail = createGoogleMailCalendar({
      baseUrl: "https://gmail.googleapis.com",
      label: "x",
      isDemo: false,
      fetch,
    });
    const err = await mail.listEmails().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect((err as GoogleApiError).status).toBe(401);
    expect((err as Error).message).toMatch(/^Gmail turned the request down because the sign-in has expired/);
    expect((err as Error).message).toMatch(/invalid authentication credentials/);
  });

  it("says when Google cannot be reached", async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    const mail = createGoogleMailCalendar({
      baseUrl: "https://gmail.googleapis.com",
      label: "x",
      isDemo: false,
      fetch,
    });
    await expect(mail.listEvents({ from: "2026-10-27", to: "2026-10-28" })).rejects.toThrow(
      "Couldn't reach Calendar: fetch failed",
    );
  });
});
