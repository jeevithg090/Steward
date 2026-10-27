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
} from "./mime.ts";

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

  async function toSummary(m: GmailMessage): Promise<GmailEmailSummary> {
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
      from: parseAddress(headerValue(headers, "From")) ?? { email: "" },
      to: parseAddressList(headerValue(headers, "To")),
      subject: decodeWords(headerValue(headers, "Subject") ?? "").trim() || "(no subject)",
      snippet: decodeEntities(m.snippet ?? ""),
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
      const messages = await mapLimit(refs, LOOKUP_CONCURRENCY, (r) =>
        getMessage(r.id, "metadata", SUMMARY_HEADERS),
      );
      return Promise.all(messages.map(toSummary));
    },

    async getEmail(id) {
      let m: GmailMessage;
      try {
        m = await getMessage(id, "full");
      } catch (err) {
        if (err instanceof GoogleApiError && (err.status === 404 || err.status === 400)) return undefined;
        throw err;
      }
      const summary = await toSummary(m);
      const headers = m.payload?.headers ?? [];
      const email: GmailEmail = {
        ...summary,
        cc: parseAddressList(headerValue(headers, "Cc")),
        body: bodyOf(m.payload),
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
          timeMin: toRfc3339(from),
          timeMax: toRfc3339(to),
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
        start: event.allDay ? { date: event.start.slice(0, 10) } : { dateTime: toRfc3339(event.start) },
        end: event.allDay ? { date: allDayEnd(event.start, event.end) } : { dateTime: toRfc3339(event.end) },
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

/** The readable body: the first text/plain part, else the first text/html part as text. */
function bodyOf(payload: GmailPart | undefined): string {
  if (!payload) return "";
  const plain = findPart(payload, "text/plain");
  const html = plain ? undefined : findPart(payload, "text/html");
  const part = plain ?? html;
  if (!part?.body?.data) return "";
  const charset =
    /charset="?([^";\s]+)"?/i.exec(headerValue(part.headers ?? [], "Content-Type") ?? "")?.[1] ?? "utf-8";
  const decoded = base64UrlDecode(part.body.data, charset).replace(/\r\n/g, "\n");
  // Anyone can send HTML, so it is read only as far as the body that is kept.
  const page = html ? htmlToText(decoded.slice(0, MAX_HTML_CHARS), { maxChars: MAX_BODY_CHARS }) : undefined;
  const text = page ? page.text : decoded.trim();
  const cut = page ? page.truncated || decoded.length > MAX_HTML_CHARS : text.length > MAX_BODY_CHARS;
  return cut ? `${text.slice(0, MAX_BODY_CHARS)}\n\n[truncated: the message is longer than this]` : text;
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

/** Calendar wants RFC 3339 with an offset. A bare date becomes midnight UTC that day. */
function toRfc3339(value: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`"${value}" isn't a date or time.`);
  return new Date(ms).toISOString();
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
