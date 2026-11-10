import type {
  CalendarEvent,
  Email,
  EmailAddress,
  EmailDraft,
  EmailSummary,
  MailCalendar,
} from "@steward/shared";
import type { FetchLike } from "../net/guarded-fetch.ts";
import { decodeEntities, htmlToText } from "../web/html-to-text.ts";
import {
  assertHeaderSafe,
  base64UrlDecode,
  base64UrlEncode,
  buildMessage,
  decodeWords,
  type Header,
  headerValue,
  parseAddress,
  parseAddressList,
  visibleText,
} from "./mime.ts";
import { zonedTime } from "./time.ts";

export interface GoogleMailCalendarOptions {
  /**
   * Where Gmail lives: the demo server (`http://127.0.0.1:8787/demo-google`) or Google
   * (`https://gmail.googleapis.com`, or `https://www.googleapis.com`, which serves both APIs).
   */
  baseUrl: string;
  /** Where Calendar lives, when it differs from `baseUrl`. For real Google: `https://www.googleapis.com`. */
  calendarBaseUrl?: string;
  /** An OAuth access token with the Gmail and Calendar scopes. Sent as a Bearer token; never logged. */
  accessToken?: string;
  /** Shown on screen: "Demo inbox", or the account's address. */
  label: string;
  isDemo: boolean;
  /** Defaults to `demo-google` or `google`. */
  id?: string;
  /** Replaces `fetch`, e.g. to call the demo app in-process: `(i, init) => demo.fetch(new Request(i, init))`. */
  fetch?: FetchLike;
  /** Per request. Default 20 s. */
  timeoutMs?: number;
  /**
   * The person's IANA time zone (Settings → Time zone), read on every use. A calendar time with no
   * offset, such as `2026-07-10T14:00`, means that wall-clock time there. Without it such a time is
   * refused rather than read in the server's own zone.
   */
  timeZone?: () => string;
}

/** What Gmail or Calendar answered when it said no, in words a person can act on. */
export class GoogleApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

/** Headers triage cares about, fetched with every summary. */
const TRIAGE_HEADERS = ["List-Unsubscribe", "List-Id", "Precedence", "Auto-Submitted"] as const;
const SUMMARY_HEADERS = ["From", "To", "Cc", "Subject", "Date", "Message-ID", ...TRIAGE_HEADERS];
const MAX_BODY_CHARS = 20_000;
/** The most HTML read from one body: far more than MAX_BODY_CHARS of text ever needs. */
const MAX_HTML_CHARS = 1_000_000;
const LOOKUP_CONCURRENCY = 8;

/**
 * A summary as the connector returns it: the shared `EmailSummary` plus the headers that tell a
 * newsletter or an auto-reply apart, so triage can decide by rule before asking a model.
 */
export interface GmailEmailSummary extends EmailSummary {
  headers: Partial<Record<(typeof TRIAGE_HEADERS)[number], string>>;
}

export interface GmailEmail extends Email {
  headers: GmailEmailSummary["headers"];
  /** The RFC 2822 Message-ID, for threading replies. */
  messageId?: string;
}

/**
 * Mail and calendar over Google's REST shapes (Gmail v1, Calendar v3). The same code reads the demo
 * server and a real Google account; only `baseUrl` and the token differ.
 */
export function createGoogleMailCalendar(opts: GoogleMailCalendarOptions): MailCalendar {
  const gmailBase = `${opts.baseUrl.replace(/\/+$/, "")}/gmail/v1/users/me`;
  const calendarBase = `${(opts.calendarBaseUrl ?? opts.baseUrl).replace(/\/+$/, "")}/calendar/v3/calendars/primary`;
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let labelNames: Promise<Map<string, string>> | undefined;
  const at = (value: string) => toRfc3339(value, opts.timeZone?.());

  async function call<T>(service: "Gmail" | "Calendar", url: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (opts.accessToken) headers.set("authorization", `Bearer ${opts.accessToken}`);
    if (init.body) headers.set("content-type", "application/json");
    let res: Response;
    try {
      res = await doFetch(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if ((err as Error).name === "TimeoutError") {
        throw new GoogleApiError(
          `${service} didn't answer within ${Math.round(timeoutMs / 1000)} seconds.`,
          504,
        );
      }
      throw new GoogleApiError(`Couldn't reach ${service}: ${(err as Error).message}`, 502);
    }
    if (res.ok) return (await res.json()) as T;
    throw new GoogleApiError(await failureMessage(service, res), res.status);
  }

  /** User label ids (`Label_123`) mapped to their names, fetched once. System labels keep their ids. */
  function labels(): Promise<Map<string, string>> {
    labelNames ??= call<{ labels?: { id: string; name: string; type?: string }[] }>(
      "Gmail",
      `${gmailBase}/labels`,
    )
      .then((r) => new Map((r.labels ?? []).filter((l) => l.type === "user").map((l) => [l.id, l.name])))
      .catch(() => {
        labelNames = undefined;
        return new Map<string, string>();
      });
    return labelNames;
  }

  async function getMessage(id: string, format: "metadata" | "full", headers: readonly string[] = []) {
    const params = new URLSearchParams({ format });
    for (const h of headers) params.append("metadataHeaders", h);
    return call<GmailMessage>("Gmail", `${gmailBase}/messages/${encodeURIComponent(id)}?${params}`);
  }

  /**
   * A summary with only what a person would see: characters that are never drawn are taken out of
   * the subject, the names and addresses, and the snippet (`seen` counts them, the snippet aside,
   * since it repeats the body).
   */
  async function toSummary(m: GmailMessage, seen = new Seen()): Promise<GmailEmailSummary> {
    const headers = m.payload?.headers ?? [];
    const names = await labels();
    const triage: GmailEmailSummary["headers"] = {};
    for (const name of TRIAGE_HEADERS) {
      const value = headerValue(headers, name);
      if (value !== undefined) triage[name] = value;
    }
    const received = Number(m.internalDate);
    const dateHeader = headerValue(headers, "Date");
    return {
      id: m.id,
      threadId: m.threadId,
      from: seen.address(parseAddress(headerValue(headers, "From")) ?? { email: "" }),
      to: seen.addresses(headerValue(headers, "To")),
      subject: seen.text(decodeWords(headerValue(headers, "Subject") ?? "")).trim() || "(no subject)",
      snippet: visibleText(decodeEntities(m.snippet ?? "")).text,
      receivedAt: new Date(
        Number.isFinite(received) && received > 0 ? received : Date.parse(dateHeader ?? "") || 0,
      ).toISOString(),
      unread: (m.labelIds ?? []).includes("UNREAD"),
      labels: (m.labelIds ?? []).map((id) => names.get(id) ?? id),
      headers: triage,
    };
  }

  return {
    id: opts.id ?? (opts.isDemo ? "demo-google" : "google"),
    label: opts.label,
    isDemo: opts.isDemo,

    async listEmails(o = {}) {
      const limit = Math.min(100, Math.max(1, Math.floor(o.limit ?? 25)));
      const parts = [o.query?.trim() || "in:inbox"];
      if (o.unreadOnly && !/\bis:unread\b/i.test(parts[0] ?? "")) parts.push("is:unread");
      const params = new URLSearchParams({ q: parts.join(" "), maxResults: String(limit) });
      const list = await call<{ messages?: { id: string; threadId: string }[] }>(
        "Gmail",
        `${gmailBase}/messages?${params}`,
      );
      const refs = list.messages ?? [];
      // Mail is archived, trashed and deleted between the list and the read all the time. A message
      // gone by then is left out; any other refusal still fails the listing, since it says more.
      const messages = await mapLimit(refs, LOOKUP_CONCURRENCY, (r) =>
        getMessage(r.id, "metadata", SUMMARY_HEADERS).catch((err: unknown) => {
          if (isGone(err)) return undefined;
          throw err;
        }),
      );
      return Promise.all(messages.filter((m): m is GmailMessage => m !== undefined).map((m) => toSummary(m)));
    },

    async getEmail(id) {
      let m: GmailMessage;
      try {
        m = await getMessage(id, "full");
      } catch (err) {
        if (isGone(err)) return undefined;
        throw err;
      }
      const seen = new Seen();
      const summary = await toSummary(m, seen);
      const headers = m.payload?.headers ?? [];
      const cc = seen.addresses(headerValue(headers, "Cc"));
      const body = bodyOf(m.payload);
      // Said in the body, so the model knows the sender hid something, without reading what.
      const chars = seen.removed + body.removed;
      const notes = [
        chars > 0 ? `[Steward removed ${plural(chars, "hidden character")} from this email.]` : "",
        body.passages > 0 ? `[Steward left out ${plural(body.passages, "passage")} hidden from view.]` : "",
      ];
      const email: GmailEmail = {
        ...summary,
        cc,
        body: [body.text, ...notes].filter(Boolean).join("\n\n"),
        headers: summary.headers,
        messageId: headerValue(headers, "Message-ID"),
      };
      return email;
    },

    async sendEmail(draft: EmailDraft) {
      if (draft.to.length === 0) throw new Error("An email needs at least one recipient.");
      assertHeaderSafe(draft.subject, "subject");
      let threadId: string | undefined;
      let inReplyTo: string | undefined;
      let references: string | undefined;
      if (draft.inReplyTo) {
        assertHeaderSafe(draft.inReplyTo, "reply reference");
        if (/^<[^<>\s]+>$/.test(draft.inReplyTo)) {
          inReplyTo = draft.inReplyTo;
          references = draft.inReplyTo;
        } else {
          const original = await getMessage(draft.inReplyTo, "metadata", ["Message-ID", "References"]);
          threadId = original.threadId;
          inReplyTo = headerValue(original.payload?.headers ?? [], "Message-ID");
          const earlier = headerValue(original.payload?.headers ?? [], "References");
          references = [earlier, inReplyTo].filter(Boolean).join(" ") || undefined;
        }
      }
      const raw = buildMessage({
        to: draft.to,
        cc: draft.cc,
        subject: draft.subject,
        text: draft.body,
        inReplyTo,
        references,
      });
      const sent = await call<{ id: string; threadId: string }>("Gmail", `${gmailBase}/messages/send`, {
        method: "POST",
        body: JSON.stringify({ raw: base64UrlEncode(raw), ...(threadId ? { threadId } : {}) }),
      });
      return { id: sent.id };
    },

    async listEvents({ from, to }) {
      const items: GoogleEvent[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 5; page++) {
        const params = new URLSearchParams({
          timeMin: at(from),
          timeMax: at(to),
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "250",
        });
        if (pageToken) params.set("pageToken", pageToken);
        const res = await call<{ items?: GoogleEvent[]; nextPageToken?: string }>(
          "Calendar",
          `${calendarBase}/events?${params}`,
        );
        items.push(...(res.items ?? []));
        pageToken = res.nextPageToken;
        if (!pageToken) break;
      }
      return items.filter((e) => e.status !== "cancelled").map(toCalendarEvent);
    },

    async createEvent(event) {
      const body: Record<string, unknown> = {
        summary: event.title,
        start: event.allDay ? { date: event.start.slice(0, 10) } : { dateTime: at(event.start) },
        end: event.allDay ? { date: allDayEnd(event.start, event.end) } : { dateTime: at(event.end) },
      };
      if (event.location) body.location = event.location;
      const description = [
        event.description,
        event.meetingUrl ? `Video call: ${event.meetingUrl}` : undefined,
      ]
        .filter(Boolean)
        .join("\n\n");
      if (description) body.description = description;
      if (event.attendees.length) {
        body.attendees = event.attendees.map((a) => ({
          email: a.email,
          ...(a.name ? { displayName: a.name } : {}),
        }));
      }
      // sendUpdates=none: adding an event never emails the people on it. Inviting people is a send,
      // and sends go through their own approval.
      const created = await call<GoogleEvent>("Calendar", `${calendarBase}/events?sendUpdates=none`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return toCalendarEvent(created);
    },
  };
}

// ── Gmail payloads ─────────────────────────────────────────────────────────────────────────────

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Header[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

/**
 * The readable body: the first text/plain part, else the first text/html part as text, with what
 * a person cannot see taken out. `removed` counts characters that are never drawn (taken out
 * before the cut, so they cannot push the visible text past it, and again after HTML, whose
 * entities can spell them); `passages` counts HTML elements hidden from view that held words.
 */
function bodyOf(payload: GmailPart | undefined): { text: string; removed: number; passages: number } {
  const none = { text: "", removed: 0, passages: 0 };
  if (!payload) return none;
  const plain = findPart(payload, "text/plain");
  const html = plain ? undefined : findPart(payload, "text/html");
  const part = plain ?? html;
  if (!part?.body?.data) return none;
  const charset =
    /charset="?([^";\s]+)"?/i.exec(headerValue(part.headers ?? [], "Content-Type") ?? "")?.[1] ?? "utf-8";
  const raw = visibleText(base64UrlDecode(part.body.data, charset).replace(/\r\n/g, "\n"));
  const decoded = raw.text;
  // Anyone can send HTML, so it is read only as far as the body that is kept.
  const page = html
    ? htmlToText(decoded.slice(0, MAX_HTML_CHARS), { maxChars: MAX_BODY_CHARS, dropHidden: true })
    : undefined;
  const shown = visibleText(page ? page.text : decoded.trim());
  const text = shown.text;
  const cut = page ? page.truncated || decoded.length > MAX_HTML_CHARS : text.length > MAX_BODY_CHARS;
  return {
    text: cut ? `${text.slice(0, MAX_BODY_CHARS)}\n\n[truncated: the message is longer than this]` : text,
    removed: raw.removed + shown.removed,
    passages: page?.hidden ?? 0,
  };
}

function findPart(part: GmailPart, mimeType: string): GmailPart | undefined {
  if (part.mimeType?.toLowerCase() === mimeType && !part.filename && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return undefined;
}

// ── Calendar payloads ──────────────────────────────────────────────────────────────────────────

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: { email?: string; displayName?: string; resource?: boolean }[];
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}

function toCalendarEvent(e: GoogleEvent): CalendarEvent {
  const allDay = Boolean(e.start?.date);
  const when = (t: GoogleEvent["start"]) =>
    t?.date ?? (t?.dateTime ? new Date(t.dateTime).toISOString() : "");
  const attendees: EmailAddress[] = (e.attendees ?? [])
    .filter((a) => a.email && !a.resource)
    .map((a) =>
      a.displayName ? { name: a.displayName, email: a.email as string } : { email: a.email as string },
    );
  const meetingUrl =
    e.hangoutLink ??
    e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ??
    videoLinkIn(e.description);
  return {
    id: e.id,
    title: e.summary?.trim() || "(No title)",
    start: when(e.start),
    end: when(e.end),
    allDay,
    attendees,
    ...(e.location ? { location: e.location } : {}),
    ...(e.description ? { description: e.description } : {}),
    ...(meetingUrl ? { meetingUrl } : {}),
  };
}

function videoLinkIn(description: string | undefined): string | undefined {
  return description ? /Video call: (https:\/\/\S+)/.exec(description)?.[1] : undefined;
}

/** A date-time with no `Z` and no offset: `2026-07-10T14:00`, `2026-07-10T14:00:00.000`. */
const NAIVE_DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A date-time with `Z` or an offset. Anything looser is refused: `Date.parse` reads "tomorrow at 3" as 2001. */
const ZONED_DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

export const NO_OFFSET_MESSAGE = "Give the time with its offset, such as 2026-10-28T15:00:00+01:00.";

/**
 * Calendar wants RFC 3339 with an offset. A time without one is wall-clock time in the person's
 * zone (`Date.parse` would read it in the server's, which is wrong whenever the two differ); with
 * no zone to go on it is refused rather than guessed. A bare date is midnight in the person's zone,
 * or midnight UTC when there is none.
 */
export function toRfc3339(value: string, timeZone?: string): string {
  const text = value.trim();
  const naive = NAIVE_DATE_TIME.exec(text);
  if (naive) {
    const [, day, hh, mm, ss = "00"] = naive as unknown as [string, string, string, string, string?];
    if (!realDay(day) || Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) {
      throw new Error(`"${value}" isn't a date or time.`);
    }
    if (!timeZone) throw new Error(`"${value}" has no time zone. ${NO_OFFSET_MESSAGE}`);
    return zonedTime(day, `${hh}:${mm}:${ss}`, timeZone).toISOString();
  }
  const day = BARE_DATE.test(text) ? text : ZONED_DATE_TIME.exec(text)?.[1];
  const ms = day && realDay(day) ? Date.parse(text) : Number.NaN;
  if (Number.isNaN(ms)) throw new Error(`"${value}" isn't a date or time.`);
  if (timeZone && day === text) return zonedTime(text, "00:00", timeZone).toISOString();
  return new Date(ms).toISOString();
}

/** True for a `YYYY-MM-DD` that is on the calendar (not 30 February). */
function realDay(key: string): boolean {
  const t = new Date(`${key}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === key;
}

/** All-day ends are exclusive: an event on the 28th ends on the 29th. */
function allDayEnd(start: string, end: string): string {
  const s = start.slice(0, 10);
  const e = end.slice(0, 10);
  if (e > s) return e;
  const next = new Date(`${s}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────

/** Takes what is never drawn out of the parts of an email a person reads, and counts it. */
class Seen {
  removed = 0;

  text(value: string): string {
    const visible = visibleText(value);
    this.removed += visible.removed;
    return visible.text;
  }

  /**
   * The name and the address as they are drawn. An address is cleaned too: tag characters in it
   * are invisible on screen but read by a model, and the address the person sees is the one a
   * reply should go to.
   */
  address(a: EmailAddress): EmailAddress {
    const email = this.text(a.email).trim();
    const name = a.name ? this.text(a.name).trim() : "";
    return name ? { name, email } : { email };
  }

  /** A To or Cc header, cleaned; an address that was nothing but invisible characters is left out. */
  addresses(header: string | undefined): EmailAddress[] {
    return parseAddressList(header)
      .map((a) => this.address(a))
      .filter((a) => a.email !== "");
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Gmail's answer for a message id that no longer exists (404), or one it no longer accepts (400). */
function isGone(err: unknown): boolean {
  return err instanceof GoogleApiError && (err.status === 404 || err.status === 400);
}

async function failureMessage(service: string, res: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: { message?: string } | string; error_description?: string };
    detail =
      typeof body.error === "string" ? (body.error_description ?? body.error) : (body.error?.message ?? "");
  } catch {
    // Not JSON: the status says enough.
  }
  const said = detail ? ` It said: ${detail.slice(0, 300)}` : "";
  if (res.status === 401)
    return `${service} turned the request down because the sign-in has expired or is missing (401). Connect the account again.${said}`;
  if (res.status === 403)
    return `${service} refused the request (403). The account may not have given Steward this permission.${said}`;
  if (res.status === 404) return `${service} couldn't find that (404).${said}`;
  if (res.status === 429)
    return `${service} is limiting requests right now (429). Try again in a minute.${said}`;
  return `${service} answered ${res.status}.${said}`;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}
