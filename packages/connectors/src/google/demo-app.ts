import { createHash, randomBytes } from "node:crypto";
import { type Context, Hono } from "hono";
import { htmlToText } from "../web/html-to-text.ts";
import { DEMO_ACCOUNT, DEMO_LABEL, DEMO_TIME_ZONE } from "./demo-constants.ts";
import {
  SEED_EMAILS,
  SEED_EVENTS,
  type SeedContext,
  type SeedEmail,
  type SeedEvent,
  type Weekday,
} from "./demo-data.ts";
import { matchesQuery } from "./gmail-query.ts";
import {
  base64UrlDecodeBytes,
  base64UrlEncode,
  type Header,
  headerValue,
  parseAddress,
  parseMessage,
  splitAddresses,
} from "./mime.ts";
import {
  addDays,
  clock,
  dateKey,
  longDay,
  monthName,
  rfc2822Date,
  rfc3339InZone,
  weekdayName,
  zonedTime,
} from "./time.ts";

/**
 * A pretend Google: the parts of Gmail v1 and Calendar v3 Steward uses, serving an invented inbox and
 * calendar for an unnamed person in London. It lets the whole product run, and its tests pass, with
 * no Google account. Every message carries the "Demo" label and the server says "demo" on its front
 * page, so nothing it serves can pass for real mail.
 *
 * Mounted by the server at `/demo-google`. Data is dated relative to `now()` and re-dated when the
 * London day changes; what was sent, delivered or added survives that, and `POST /__demo/reset`
 * starts over.
 */
export function createDemoGoogleApp(opts: { now?: () => Date } = {}): Hono {
  const now = opts.now ?? (() => new Date());
  const store = new DemoStore(now);
  const app = new Hono();

  app.onError((err, c) =>
    googleError(c, 500, `The demo server hit a problem: ${err.message}`, "backendError"),
  );
  app.notFound((c) => googleError(c, 404, "Not Found", "notFound"));

  app.get("/", (c) =>
    c.json({
      demo: true,
      about: "Invented mail and calendar for trying Steward. Nothing here is real.",
      account: DEMO_ACCOUNT,
      timeZone: DEMO_TIME_ZONE,
      messages: store.messages().length,
      events: store.events().length,
      sent: store.sent.length,
    }),
  );

  // ── Gmail ────────────────────────────────────────────────────────────────────────────────────

  const gmail = new Hono();
  gmail.use("/users/:user/*", async (c, next) => {
    const user = c.req.param("user");
    if (user !== "me" && user !== DEMO_ACCOUNT)
      return googleError(c, 403, "Delegation denied for this account.", "forbidden");
    await next();
  });

  gmail.get("/users/:user/profile", (c) => {
    const messages = store.messages();
    return c.json({
      emailAddress: DEMO_ACCOUNT,
      messagesTotal: messages.length,
      threadsTotal: new Set(messages.map((m) => m.threadId)).size,
      historyId: String(store.historyId),
    });
  });

  gmail.get("/users/:user/labels", (c) => c.json({ labels: LABELS }));
  gmail.get("/users/:user/labels/:id", (c) => {
    const label = LABELS.find((l) => l.id === c.req.param("id"));
    return label ? c.json(label) : googleError(c, 404, "Requested entity was not found.", "notFound");
  });

  gmail.get("/users/:user/messages", (c) => {
    const q = c.req.query("q") ?? "";
    const maxResults = intParam(c.req.query("maxResults"), 100, 1, 500);
    if (maxResults === undefined)
      return googleError(c, 400, "Invalid value for maxResults.", "invalidArgument");
    const offset = c.req.query("pageToken") ? Number(c.req.query("pageToken")) : 0;
    if (!Number.isInteger(offset) || offset < 0)
      return googleError(c, 400, "Invalid pageToken.", "invalidArgument");
    const labelIds = c.req.queries("labelIds") ?? [];
    const nowMs = now().getTime();
    const matched = store
      .messages()
      .filter((m) => labelIds.every((l) => m.labelIds.includes(l)))
      .filter((m) => matchesQuery(m, q, nowMs, LABEL_NAMES));
    const page = matched.slice(offset, offset + maxResults);
    const next = offset + maxResults < matched.length ? String(offset + maxResults) : undefined;
    return c.json({
      ...(page.length > 0 ? { messages: page.map((m) => ({ id: m.id, threadId: m.threadId })) } : {}),
      ...(next ? { nextPageToken: next } : {}),
      resultSizeEstimate: matched.length,
    });
  });

  gmail.get("/users/:user/messages/:id", (c) => {
    const message = store.message(c.req.param("id"));
    if (!message) return googleError(c, 404, "Requested entity was not found.", "notFound");
    const format = (c.req.query("format") ?? "full").toLowerCase();
    if (!["full", "metadata", "minimal", "raw"].includes(format)) {
      return googleError(c, 400, `Invalid value at 'format' (${format}).`, "invalidArgument");
    }
    return c.json(messageResource(message, format as MessageFormat, c.req.queries("metadataHeaders") ?? []));
  });

  gmail.post("/users/:user/messages/send", async (c) => {
    const body = await c.req.json<{ raw?: unknown; threadId?: unknown }>().catch(() => undefined);
    if (!body || typeof body.raw !== "string" || body.raw === "") {
      return googleError(
        c,
        400,
        "'raw' RFC822 payload message string or uploading message via /upload/* URL required",
        "invalidArgument",
      );
    }
    let parsed: ReturnType<typeof parseMessage>;
    try {
      parsed = parseMessage(base64UrlDecodeBytes(body.raw));
    } catch {
      return googleError(c, 400, "Invalid raw message.", "invalidArgument");
    }
    const recipients = ["To", "Cc", "Bcc"].flatMap((h) => splitAddresses(headerValue(parsed.headers, h)));
    if (recipients.length === 0) return googleError(c, 400, "Recipient address required", "invalidArgument");
    const sent = store.send(parsed, typeof body.threadId === "string" ? body.threadId : undefined);
    return c.json({ id: sent.id, threadId: sent.threadId, labelIds: ["SENT"] });
  });

  app.route("/gmail/v1", gmail);

  // ── Calendar ─────────────────────────────────────────────────────────────────────────────────

  const calendar = new Hono();
  calendar.use("/calendars/:calendarId/*", async (c, next) => {
    const id = c.req.param("calendarId");
    if (id !== "primary" && id !== DEMO_ACCOUNT) return googleError(c, 404, "Not Found", "notFound");
    await next();
  });

  calendar.get("/calendars/:calendarId", (c) => {
    const id = c.req.param("calendarId");
    if (id !== "primary" && id !== DEMO_ACCOUNT) return googleError(c, 404, "Not Found", "notFound");
    return c.json({
      kind: "calendar#calendar",
      etag: '"demo"',
      id: DEMO_ACCOUNT,
      summary: DEMO_ACCOUNT,
      timeZone: DEMO_TIME_ZONE,
    });
  });

  calendar.get("/calendars/:calendarId/events", (c) => {
    const timeMin = c.req.query("timeMin");
    const timeMax = c.req.query("timeMax");
    const min = timeMin === undefined ? Number.NEGATIVE_INFINITY : rfc3339Ms(timeMin);
    const max = timeMax === undefined ? Number.POSITIVE_INFINITY : rfc3339Ms(timeMax);
    if (Number.isNaN(min) || Number.isNaN(max)) return googleError(c, 400, "Bad Request", "badRequest");
    const orderBy = c.req.query("orderBy");
    const singleEvents = c.req.query("singleEvents") === "true";
    if (orderBy === "startTime" && !singleEvents) {
      return googleError(
        c,
        400,
        "The requested ordering is not available for the particular query.",
        "invalid",
      );
    }
    if (orderBy !== undefined && orderBy !== "startTime" && orderBy !== "updated") {
      return googleError(c, 400, "Invalid value for: orderBy", "invalid");
    }
    const maxResults = intParam(c.req.query("maxResults"), 250, 1, 2500);
    if (maxResults === undefined) return googleError(c, 400, "Invalid value for maxResults.", "invalid");
    const q = (c.req.query("q") ?? "").toLowerCase();
    const offset = c.req.query("pageToken") ? Number(c.req.query("pageToken")) : 0;

    const matched = store
      .events()
      .filter((e) => e.endMs > min && e.startMs < max)
      .filter(
        (e) =>
          !q ||
          [e.resource.summary, e.resource.description, e.resource.location].some((t) =>
            t?.toLowerCase().includes(q),
          ),
      )
      .sort((a, b) =>
        orderBy === "updated" ? a.updatedMs - b.updatedMs : a.startMs - b.startMs || a.endMs - b.endMs,
      );
    const page = matched.slice(offset, offset + maxResults);
    const next = offset + maxResults < matched.length ? String(offset + maxResults) : undefined;
    return c.json({
      kind: "calendar#events",
      etag: `"${store.historyId}"`,
      summary: DEMO_ACCOUNT,
      description: "Demo calendar. Every event here is invented.",
      updated: now().toISOString(),
      timeZone: DEMO_TIME_ZONE,
      accessRole: "owner",
      defaultReminders: [{ method: "popup", minutes: 10 }],
      ...(next ? { nextPageToken: next } : {}),
      items: page.map((e) => e.resource),
    });
  });

  calendar.get("/calendars/:calendarId/events/:eventId", (c) => {
    const event = store.events().find((e) => e.resource.id === c.req.param("eventId"));
    return event ? c.json(event.resource) : googleError(c, 404, "Not Found", "notFound");
  });

  calendar.post("/calendars/:calendarId/events", async (c) => {
    const body = await c.req.json<EventInput>().catch(() => undefined);
    if (!body || typeof body !== "object") return googleError(c, 400, "Bad Request", "badRequest");
    const result = store.insertEvent(body);
    if (typeof result === "string") return googleError(c, 400, result, "invalid");
    return c.json(result.resource);
  });

  app.route("/calendar/v3", calendar);

  // ── Demo controls ────────────────────────────────────────────────────────────────────────────

  app.get("/__demo/sent", (c) => c.json(store.sent));
  app.post("/__demo/reset", (c) => {
    store.reset();
    return c.json({ ok: true });
  });
  app.post("/__demo/deliver", async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => undefined);
    const ok = (v: unknown) => typeof v === "string" && v.trim() !== "";
    if (!body || !ok(body.from) || !ok(body.subject) || !ok(body.body)) {
      return googleError(
        c,
        400,
        "Send JSON with from, subject and body, each a non-empty string.",
        "invalidArgument",
      );
    }
    const delivered = store.deliver({
      from: String(body.from),
      subject: String(body.subject),
      body: String(body.body),
      labels: Array.isArray(body.labels) ? body.labels.filter((l): l is string => typeof l === "string") : [],
    });
    return c.json({ id: delivered.id, threadId: delivered.threadId }, 201);
  });

  return app;
}

// ── Store ──────────────────────────────────────────────────────────────────────────────────────

interface DemoMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  internalDate: number;
  historyId: number;
  headers: Header[];
  /** text/plain body, "" for HTML-only mail. */
  text: string;
  html?: string;
  /** Readable text used for search and the snippet. */
  readable: string;
}

interface DemoEvent {
  startMs: number;
  endMs: number;
  updatedMs: number;
  resource: Record<string, unknown> & {
    id: string;
    summary?: string;
    description?: string;
    location?: string;
  };
}

interface SentRecord {
  id: string;
  threadId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  sentAt: string;
}

interface EventInput {
  summary?: unknown;
  description?: unknown;
  location?: unknown;
  start?: { dateTime?: unknown; date?: unknown; timeZone?: unknown };
  end?: { dateTime?: unknown; date?: unknown; timeZone?: unknown };
  attendees?: unknown;
}

class DemoStore {
  private seededFor = "";
  private base: DemoMessage[] = [];
  private extra: DemoMessage[] = [];
  private baseEvents: DemoEvent[] = [];
  private extraEvents: DemoEvent[] = [];
  sent: SentRecord[] = [];
  historyId = 1000;

  private readonly now: () => Date;

  constructor(now: () => Date) {
    this.now = now;
    this.refresh();
  }

  reset(): void {
    this.extra = [];
    this.extraEvents = [];
    this.sent = [];
    this.seededFor = "";
    this.refresh();
  }

  /** Newest first, re-dated if the London day has turned since the last request. */
  messages(): DemoMessage[] {
    this.refresh();
    return [...this.base, ...this.extra].sort((a, b) => b.internalDate - a.internalDate);
  }

  message(id: string): DemoMessage | undefined {
    return this.messages().find((m) => m.id === id);
  }

  events(): DemoEvent[] {
    this.refresh();
    return [...this.baseEvents, ...this.extraEvents];
  }

  private refresh(): void {
    const now = this.now();
    const today = dateKey(now, DEMO_TIME_ZONE);
    if (today === this.seededFor) return;
    this.seededFor = today;
    this.base = seedMessages(now, today, () => ++this.historyId);
    this.baseEvents = SEED_EVENTS.flatMap((e) => seedEvent(e, today, now) ?? []);
  }

  send(parsed: ReturnType<typeof parseMessage>, threadIdHint: string | undefined): DemoMessage {
    const now = this.now();
    const all = this.messages();
    const inReplyTo = headerValue(parsed.headers, "In-Reply-To");
    const threadId =
      (threadIdHint && all.some((m) => m.threadId === threadIdHint) ? threadIdHint : undefined) ??
      all.find((m) => inReplyTo && headerValue(m.headers, "Message-ID") === inReplyTo)?.threadId;
    const id = randomBytes(8).toString("hex");
    const subject = headerValue(parsed.headers, "Subject") ?? "";
    const keep = ["To", "Cc", "Subject", "In-Reply-To", "References"];
    const headers: Header[] = [
      { name: "MIME-Version", value: "1.0" },
      { name: "Date", value: rfc2822Date(now, DEMO_TIME_ZONE) },
      { name: "Message-ID", value: `<${id}@demo.steward.local>` },
      { name: "From", value: DEMO_ACCOUNT },
      ...keep.flatMap((name) => {
        const value = headerValue(parsed.headers, name);
        return value === undefined ? [] : [{ name, value }];
      }),
      { name: "Content-Type", value: 'text/plain; charset="UTF-8"' },
    ];
    const text = parsed.text || (parsed.html ? htmlToText(parsed.html).text : "");
    const message: DemoMessage = {
      id,
      threadId: threadId ?? id,
      labelIds: ["SENT", DEMO_LABEL.id],
      internalDate: now.getTime(),
      historyId: ++this.historyId,
      headers,
      text,
      readable: text,
    };
    this.extra.push(message);
    const list = (name: string) =>
      splitAddresses(headerValue(parsed.headers, name)).map((a) => parseAddress(a)?.email ?? a);
    this.sent.push({
      id,
      threadId: message.threadId,
      to: list("To"),
      cc: list("Cc"),
      bcc: list("Bcc"),
      subject,
      body: text,
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(headerValue(parsed.headers, "References")
        ? { references: headerValue(parsed.headers, "References") }
        : {}),
      sentAt: now.toISOString(),
    });
    return message;
  }

  deliver(input: { from: string; subject: string; body: string; labels: string[] }): DemoMessage {
    const now = this.now();
    const id = randomBytes(8).toString("hex");
    const domain = parseAddress(input.from)?.email.split("@")[1] ?? "example.com";
    const message: DemoMessage = {
      id,
      threadId: id,
      labelIds: [
        "INBOX",
        "UNREAD",
        ...(input.labels.length ? input.labels : ["CATEGORY_PERSONAL"]),
        DEMO_LABEL.id,
      ],
      internalDate: now.getTime(),
      historyId: ++this.historyId,
      headers: [
        { name: "Delivered-To", value: DEMO_ACCOUNT },
        { name: "MIME-Version", value: "1.0" },
        { name: "Date", value: rfc2822Date(now, DEMO_TIME_ZONE) },
        { name: "Message-ID", value: `<${id}@${domain}>` },
        { name: "Subject", value: input.subject },
        { name: "From", value: input.from },
        { name: "To", value: DEMO_ACCOUNT },
        { name: "Content-Type", value: 'text/plain; charset="UTF-8"' },
      ],
      text: input.body,
      readable: input.body,
    };
    this.extra.push(message);
    return message;
  }

  insertEvent(body: EventInput): DemoEvent | string {
    const start = eventTime(body.start);
    const end = eventTime(body.end);
    if (!start) return "Missing start time.";
    if (!end) return "Missing end time.";
    if (start.allDay !== end.allDay) return "Start and end must both be dates or both be date-times.";
    if (end.ms <= start.ms) return "The specified time range is empty.";
    const now = this.now();
    const id = randomBytes(13).toString("hex");
    const attendees = Array.isArray(body.attendees)
      ? body.attendees
          .filter((a): a is { email: string; displayName?: unknown } => typeof a?.email === "string")
          .map((a) => ({
            email: a.email,
            ...(typeof a.displayName === "string" ? { displayName: a.displayName } : {}),
            responseStatus: a.email === DEMO_ACCOUNT ? "accepted" : "needsAction",
            ...(a.email === DEMO_ACCOUNT ? { self: true } : {}),
          }))
      : [];
    const event = makeEvent({
      id,
      summary: typeof body.summary === "string" && body.summary ? body.summary : "(No title)",
      description: typeof body.description === "string" ? body.description : undefined,
      location: typeof body.location === "string" ? body.location : undefined,
      startMs: start.ms,
      endMs: end.ms,
      allDay: start.allDay,
      attendees,
      status: "confirmed",
      createdMs: now.getTime(),
    });
    this.extraEvents.push(event);
    this.historyId++;
    return event;
  }
}

// ── Seeding ────────────────────────────────────────────────────────────────────────────────────

const WEEKDAY_NAMES: Weekday[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function stableHex(text: string, length: number): string {
  return createHash("sha256").update(`steward-demo:${text}`).digest("hex").slice(0, length);
}

function seedContext(today: string, received: Date): SeedContext {
  const thisMonth = Number(today.slice(5, 7));
  return {
    day: (offset) => longDay(addDays(today, offset)),
    weekday: (offset) => weekdayName(addDays(today, offset)),
    next: (weekday, weeksLater = 0) => {
      const target = WEEKDAY_NAMES.indexOf(weekday);
      for (let n = 1; n <= 7; n++) {
        const key = addDays(today, n);
        if (weekdayName(key) === WEEKDAY_NAMES[target]) return longDay(addDays(key, weeksLater * 7));
      }
      return longDay(addDays(today, 7));
    },
    workday: (n) => longDay(workdayKey(today, Math.max(1, n)) as string),
    workdayName: (n) => weekdayName(workdayKey(today, Math.max(1, n)) as string),
    clockBefore: (minutes) => clock(new Date(received.getTime() - minutes * 60_000), DEMO_TIME_ZONE),
    month: (offset) => monthName(thisMonth + offset),
  };
}

/**
 * The nth working day (Monday to Friday) after `today`, or before it when n is negative. With n = 0,
 * today when it is a working day, else undefined: a stand-up on a Saturday would give the demo away.
 */
function workdayKey(today: string, n: number): string | undefined {
  const isWorkday = (key: string) => !["Saturday", "Sunday"].includes(weekdayName(key));
  if (n === 0) return isWorkday(today) ? today : undefined;
  const step = n > 0 ? 1 : -1;
  let key = today;
  for (let found = 0; found < Math.abs(n); ) {
    key = addDays(key, step);
    if (isWorkday(key)) found++;
  }
  return key;
}

function receivedAt(seed: SeedEmail, now: Date, today: string): Date {
  // A few stable seconds of jitter, so no two messages share a timestamp and none looks scripted.
  const jitter = Number.parseInt(stableHex(`${seed.key}:s`, 4), 16) % 60;
  if ("minutesAgo" in seed.at) {
    return new Date(Math.floor(now.getTime() / 1000) * 1000 - seed.at.minutesAgo * 60_000 - jitter * 1000);
  }
  return new Date(
    zonedTime(addDays(today, -seed.at.daysAgo), seed.at.time, DEMO_TIME_ZONE).getTime() + jitter * 1000,
  );
}

function seedMessages(now: Date, today: string, nextHistoryId: () => number): DemoMessage[] {
  const ids = new Map(SEED_EMAILS.map((s) => [s.key, stableHex(s.key, 16)]));
  const messageIds = new Map(SEED_EMAILS.map((s) => [s.key, messageIdOf(s)]));
  return SEED_EMAILS.map((seed) => {
    const received = receivedAt(seed, now, today);
    const ctx = seedContext(today, received);
    const id = ids.get(seed.key) as string;
    const parentId = seed.inReplyTo ? ids.get(seed.inReplyTo) : undefined;
    const subject = typeof seed.subject === "string" ? seed.subject : seed.subject(ctx);
    const text = seed.text(ctx);
    const html = seed.html?.(ctx);
    const multipart = html !== undefined && !seed.htmlOnly;
    const contentType = multipart
      ? `multipart/alternative; boundary="000000000000${stableHex(`${seed.key}:b`, 12)}"`
      : html !== undefined
        ? 'text/html; charset="UTF-8"'
        : 'text/plain; charset="UTF-8"';
    const parentMessageId = seed.inReplyTo ? messageIds.get(seed.inReplyTo) : undefined;
    const headers: Header[] = [
      ...(seed.sent ? [] : [{ name: "Delivered-To", value: DEMO_ACCOUNT }]),
      { name: "MIME-Version", value: "1.0" },
      { name: "Date", value: rfc2822Date(received, DEMO_TIME_ZONE) },
      { name: "Message-ID", value: messageIdOf(seed) },
      ...(parentMessageId
        ? [
            { name: "In-Reply-To", value: parentMessageId },
            { name: "References", value: parentMessageId },
          ]
        : []),
      { name: "Subject", value: subject },
      { name: "From", value: seed.from },
      { name: "To", value: seed.to ?? DEMO_ACCOUNT },
      ...(seed.cc ? [{ name: "Cc", value: seed.cc }] : []),
      ...Object.entries(seed.headers ?? {}).map(([name, value]) => ({ name, value })),
      { name: "Content-Type", value: contentType },
    ];
    const labelIds = seed.sent
      ? ["SENT", DEMO_LABEL.id]
      : [
          ...(seed.unread ? ["UNREAD"] : []),
          ...(seed.important ? ["IMPORTANT"] : []),
          seed.category,
          "INBOX",
          DEMO_LABEL.id,
        ];
    return {
      id,
      threadId: parentId ?? id,
      labelIds,
      internalDate: received.getTime(),
      historyId: nextHistoryId(),
      headers,
      text: seed.htmlOnly ? "" : text,
      ...(html !== undefined ? { html } : {}),
      readable: seed.htmlOnly && html ? htmlToText(html, { links: false }).text : text,
    };
  });
}

function messageIdOf(seed: SeedEmail): string {
  const domain = /@([^>\s]+)/.exec(seed.from)?.[1] ?? "demo.steward.local";
  return `<${seed.key}.${stableHex(seed.key, 8)}@${domain}>`;
}

function seedEvent(seed: SeedEvent, today: string, now: Date): DemoEvent | undefined {
  const day = typeof seed.day === "number" ? addDays(today, seed.day) : workdayKey(today, seed.day.workday);
  if (!day) return undefined;
  const allDay = !seed.start || !seed.end;
  const startMs = allDay
    ? zonedTime(day, "00:00", DEMO_TIME_ZONE).getTime()
    : zonedTime(day, seed.start as string, DEMO_TIME_ZONE).getTime();
  const endMs = allDay
    ? zonedTime(addDays(day, 1), "00:00", DEMO_TIME_ZONE).getTime()
    : zonedTime(day, seed.end as string, DEMO_TIME_ZONE).getTime();
  return makeEvent({
    id: stableHex(`event:${seed.key}`, 26),
    summary: seed.title,
    description: seed.description,
    location: seed.location,
    startMs,
    endMs,
    allDay,
    startDate: allDay ? day : undefined,
    endDate: allDay ? addDays(day, 1) : undefined,
    attendees: (seed.attendees ?? []).map((a) => ({
      email: a.email,
      ...(a.name ? { displayName: a.name } : {}),
      responseStatus: a.response,
      ...(a.email === DEMO_ACCOUNT ? { self: true, organizer: true } : {}),
    })),
    meet: seed.meet,
    status: seed.status ?? "confirmed",
    createdMs: now.getTime() - 7 * 86_400_000,
  });
}

function makeEvent(e: {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  startDate?: string;
  endDate?: string;
  attendees: Record<string, unknown>[];
  meet?: string;
  status: "confirmed" | "tentative";
  createdMs: number;
}): DemoEvent {
  const created = new Date(e.createdMs).toISOString();
  const when = (ms: number, date: string | undefined) =>
    e.allDay
      ? { date: date ?? dateKey(new Date(ms), DEMO_TIME_ZONE) }
      : { dateTime: rfc3339InZone(new Date(ms), DEMO_TIME_ZONE), timeZone: DEMO_TIME_ZONE };
  const resource = {
    kind: "calendar#event",
    etag: `"${stableHex(`etag:${e.id}`, 16)}"`,
    id: e.id,
    status: e.status,
    htmlLink: `https://calendar.demo.steward.local/event?eid=${e.id}`,
    created,
    updated: created,
    summary: e.summary,
    ...(e.description ? { description: e.description } : {}),
    ...(e.location ? { location: e.location } : {}),
    creator: { email: DEMO_ACCOUNT, self: true },
    organizer: { email: DEMO_ACCOUNT, self: true },
    start: when(e.startMs, e.startDate),
    end: when(e.endMs, e.endDate),
    iCalUID: `${e.id}@demo.steward.local`,
    sequence: 0,
    ...(e.attendees.length ? { attendees: e.attendees } : {}),
    ...(e.meet
      ? {
          hangoutLink: e.meet,
          conferenceData: {
            entryPoints: [{ entryPointType: "video", uri: e.meet, label: e.meet.replace(/^https:\/\//, "") }],
            conferenceSolution: { name: "Video call", key: { type: "addOn" } },
          },
        }
      : {}),
    reminders: { useDefault: true },
    eventType: "default",
  };
  return { startMs: e.startMs, endMs: e.endMs, updatedMs: e.createdMs, resource };
}

function eventTime(value: EventInput["start"]): { ms: number; allDay: boolean } | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date)) {
    return { ms: zonedTime(value.date, "00:00", DEMO_TIME_ZONE).getTime(), allDay: true };
  }
  if (typeof value.dateTime === "string") {
    const ms = rfc3339Ms(value.dateTime);
    return Number.isNaN(ms) ? undefined : { ms, allDay: false };
  }
  return undefined;
}

/** Parses an RFC 3339 timestamp. Google insists on an offset; so does this. */
function rfc3339Ms(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return Number.NaN;
  return Date.parse(value);
}

// ── Resources ──────────────────────────────────────────────────────────────────────────────────

type MessageFormat = "full" | "metadata" | "minimal" | "raw";

// biome-ignore format: a compact table reads better than one entry per line
const SYSTEM_LABELS = [
  "INBOX", "SENT", "UNREAD", "IMPORTANT", "STARRED", "DRAFT", "SPAM", "TRASH",
  "CATEGORY_PERSONAL", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS",
];
const LABELS = [
  ...SYSTEM_LABELS.map((id) => ({ id, name: id, type: "system" })),
  {
    id: DEMO_LABEL.id,
    name: DEMO_LABEL.name,
    type: "user",
    messageListVisibility: "show",
    labelListVisibility: "labelShow",
  },
];
const LABEL_NAMES: ReadonlyMap<string, string> = new Map(LABELS.map((l) => [l.id, l.name]));

function escapeSnippet(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function snippetOf(m: DemoMessage): string {
  // Plain words, as Gmail shows them: no heading marks or list bullets from the HTML conversion.
  const flat = m.readable
    .replace(/(^|\n)\s*(?:#{1,6}|[-•]|\d+\.) /g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const cut = flat.length > 160 ? `${flat.slice(0, 160).replace(/\s+\S*$/, "")}` : flat;
  return escapeSnippet(cut);
}

function mimeTypeOf(m: DemoMessage): string {
  return (headerValue(m.headers, "Content-Type") ?? "text/plain").split(";")[0]?.trim() ?? "text/plain";
}

function part(partId: string, mimeType: "text/plain" | "text/html", content: string) {
  const bytes = new TextEncoder().encode(content);
  return {
    partId,
    mimeType,
    filename: "",
    headers: [
      { name: "Content-Type", value: `${mimeType}; charset="UTF-8"` },
      { name: "Content-Transfer-Encoding", value: "quoted-printable" },
    ],
    body: { size: bytes.byteLength, data: base64UrlEncode(bytes) },
  };
}

function messageResource(m: DemoMessage, format: MessageFormat, metadataHeaders: string[]) {
  const raw = rawOf(m);
  const base = {
    id: m.id,
    threadId: m.threadId,
    labelIds: m.labelIds,
    snippet: snippetOf(m),
    sizeEstimate: Buffer.byteLength(raw),
    historyId: String(m.historyId),
    internalDate: String(m.internalDate),
  };
  if (format === "minimal") return base;
  if (format === "raw") return { ...base, raw: base64UrlEncode(raw) };
  const mimeType = mimeTypeOf(m);
  if (format === "metadata") {
    const wanted = metadataHeaders.map((h) => h.toLowerCase());
    const headers = wanted.length
      ? m.headers.filter((h) => wanted.includes(h.name.toLowerCase()))
      : m.headers;
    return { ...base, payload: { partId: "", mimeType, filename: "", headers } };
  }
  if (mimeType === "multipart/alternative") {
    return {
      ...base,
      payload: {
        partId: "",
        mimeType,
        filename: "",
        headers: m.headers,
        body: { size: 0 },
        parts: [part("0", "text/plain", m.text), part("1", "text/html", m.html ?? "")],
      },
    };
  }
  const content = mimeType === "text/html" ? (m.html ?? "") : m.text;
  const single = part("", mimeType === "text/html" ? "text/html" : "text/plain", content);
  return { ...base, payload: { ...single, headers: m.headers } };
}

/** The message as RFC 2822, for `format=raw` and the size estimate. */
function rawOf(m: DemoMessage): string {
  const lines = m.headers
    .filter((h) => h.name.toLowerCase() !== "content-type")
    .map((h) => `${h.name}: ${h.value}`);
  const contentType = headerValue(m.headers, "Content-Type") ?? 'text/plain; charset="UTF-8"';
  const encode = (s: string) =>
    (
      Buffer.from(s, "utf8")
        .toString("base64")
        .match(/.{1,76}/g) ?? []
    ).join("\r\n");
  lines.push(`Content-Type: ${contentType}`);
  const boundary = /boundary="([^"]+)"/.exec(contentType)?.[1];
  if (boundary) {
    lines.push(
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      encode(m.text),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      encode(m.html ?? ""),
      `--${boundary}--`,
    );
  } else {
    lines.push(
      "Content-Transfer-Encoding: base64",
      "",
      encode(contentType.startsWith("text/html") ? (m.html ?? "") : m.text),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────

function intParam(value: string | undefined, fallback: number, min: number, max: number): number | undefined {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) return undefined;
  return Math.min(n, max);
}

/** Google's error body, so a client written against Google handles the demo's errors the same way. */
function googleError(c: Context, code: 400 | 401 | 403 | 404 | 500, message: string, reason: string) {
  const status = {
    400: "INVALID_ARGUMENT",
    401: "UNAUTHENTICATED",
    403: "PERMISSION_DENIED",
    404: "NOT_FOUND",
    500: "INTERNAL",
  }[code];
  return c.json({ error: { code, message, errors: [{ message, domain: "global", reason }], status } }, code);
}
