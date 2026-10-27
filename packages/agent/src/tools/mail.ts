import type { EmailAddress, MailCalendar } from "@steward/shared";
import { dayBounds, localDate } from "../time.ts";
import { builtin } from "./define.ts";
import {
  ArgumentError,
  bool,
  INTENT,
  int,
  list,
  object,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalString,
  readString,
  readStringList,
  str,
} from "./schema.ts";
import { parseAddress } from "./target.ts";
import type { StewardTool, ToolArgs, ToolContext } from "./types.ts";

export const NO_MAILBOX =
  "No mailbox is connected. Say so plainly, and that mail and calendar can be connected on the Connections page.";

function mailbox(ctx: ToolContext): MailCalendar {
  const mail = ctx.services.mail();
  if (!mail) throw new Error(NO_MAILBOX);
  return mail;
}

function addresses(args: ToolArgs, key: string, required: boolean): EmailAddress[] {
  const out: EmailAddress[] = [];
  for (const raw of readStringList(args, key, { required })) {
    const parsed = parseAddress(raw);
    if (!parsed) throw new ArgumentError(`"${raw}" in "${key}" is not an email address.`);
    out.push(parsed);
  }
  return out;
}

const ADDRESS_LIST = (what: string) =>
  list(str("An email address, such as sam@example.com."), `${what}, as a list of email addresses.`);

export const mailList = builtin("mail_list", {
  description:
    "List recent emails in the connected mailbox, newest first: who sent each, the subject, a short snippet and whether it is unread. Use query to search the way you would in Gmail, such as from:sam@example.com or subject:invoice.",
  parameters: object({
    query: str("Optional search, such as from:sam@example.com or subject:invoice."),
    limit: int("How many to list, at most 50. Defaults to 20.", { minimum: 1, maximum: 50 }),
    unreadOnly: bool("Only unread mail."),
  }),
  toGateCall: async () => ({ target: {} }),
  execute: async (args, ctx) => {
    const query = readOptionalString(args, "query");
    const unreadOnly = readOptionalBoolean(args, "unreadOnly");
    return mailbox(ctx).listEmails({
      limit: readOptionalNumber(args, "limit", { min: 1, max: 50 }) ?? 20,
      ...(query ? { query } : {}),
      ...(unreadOnly !== undefined ? { unreadOnly } : {}),
    });
  },
});

export const mailRead = builtin("mail_read", {
  description: "Read one email in full, by its id from mail_list, triage_inbox or the brief.",
  parameters: object({ id: str("The email's id.") }, ["id"]),
  toGateCall: async () => ({ target: {} }),
  execute: async (args, ctx) => {
    const email = await mailbox(ctx).getEmail(readString(args, "id"));
    if (!email) throw new Error("There is no email with that id. List the mail again to get its id.");
    return email;
  },
});

export const mailSend = builtin("mail_send", {
  description:
    "Send an email from the connected mailbox. When the person asks you to send something, call this directly: the call itself shows them the exact message and waits for their answer, so never ask them to confirm first. If they refuse, say plainly that nothing was sent. Write the way they would, short and plain, and never sign with a name they have not given you.",
  parameters: object(
    {
      to: ADDRESS_LIST("Who it goes to"),
      cc: ADDRESS_LIST("Optional copies"),
      subject: str("The subject line."),
      body: str("The message, in plain text."),
      inReplyTo: str("Optional. The id of the email this replies to."),
      intent: INTENT,
    },
    ["to", "subject", "body"],
  ),
  // Checked before the gateway decides, so the person is never asked to approve a message that cannot be sent.
  toGateCall: async (args) => {
    const people = [...addresses(args, "to", true), ...addresses(args, "cc", false)];
    const subject = readString(args, "subject", { max: 500 });
    const body = readString(args, "body", { max: 50_000 });
    return {
      target: { recipients: [...new Set(people.map((p) => p.email))] },
      outbound: `${subject}\n\n${body}`,
    };
  },
  execute: async (args, ctx) => {
    const to = addresses(args, "to", true);
    const cc = addresses(args, "cc", false);
    const inReplyTo = readOptionalString(args, "inReplyTo");
    const sent = await mailbox(ctx).sendEmail({
      to,
      ...(cc.length > 0 ? { cc } : {}),
      subject: readString(args, "subject", { max: 500 }),
      body: readString(args, "body", { max: 50_000 }),
      ...(inReplyTo ? { inReplyTo } : {}),
    });
    return { sent: true, id: sent.id, to: to.map((a) => a.email) };
  },
});

export const calendarList = builtin("calendar_list", {
  description:
    "List events on the connected calendar between two times. Leave both out for today, in the person's own timezone. Times are ISO 8601, such as 2026-10-28T09:00:00Z.",
  parameters: object({
    from: str("Optional start, ISO 8601."),
    to: str("Optional end, ISO 8601."),
  }),
  toGateCall: async () => ({ target: {} }),
  execute: async (args, ctx) => {
    const timezone = ctx.services.settings().timezone;
    const today = dayBounds(localDate(timezone), timezone);
    const from = readOptionalString(args, "from") ?? today.from;
    const to = readOptionalString(args, "to") ?? (args.from ? addDays(from, 1) : today.to);
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      throw new ArgumentError("from and to must be ISO 8601 times, such as 2026-10-28T09:00:00Z.");
    }
    return mailbox(ctx).listEvents({ from, to });
  },
});

function addDays(iso: string, days: number): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t + days * 86_400_000).toISOString();
}

export const calendarCreate = builtin("calendar_create", {
  description:
    "Add an event to the connected calendar. Times are ISO 8601 with an offset, such as 2026-10-28T15:00:00+00:00. Any attendees are sent an invitation, so the person is asked first when there are attendees.",
  parameters: object(
    {
      title: str("The event's title."),
      start: str("Start, ISO 8601."),
      end: str("End, ISO 8601."),
      allDay: bool("True for an all-day event."),
      location: str("Optional place or address."),
      attendees: ADDRESS_LIST("Optional people to invite"),
      description: str("Optional notes for the event."),
      intent: INTENT,
    },
    ["title", "start", "end"],
  ),
  toGateCall: async (args) => {
    const recipients = [...new Set(addresses(args, "attendees", false).map((p) => p.email))];
    if (recipients.length === 0) return { target: {} };
    const title = typeof args.title === "string" ? args.title : "";
    const notes = typeof args.description === "string" ? args.description : "";
    return { target: { recipients }, outbound: `${title}\n\n${notes}`.trim() };
  },
  execute: async (args, ctx) => {
    const start = readString(args, "start");
    const end = readString(args, "end");
    if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
      throw new ArgumentError("start and end must be ISO 8601 times, such as 2026-10-28T15:00:00+00:00.");
    }
    if (Date.parse(end) < Date.parse(start)) throw new ArgumentError("The event ends before it starts.");
    const location = readOptionalString(args, "location");
    const description = readOptionalString(args, "description");
    return mailbox(ctx).createEvent({
      title: readString(args, "title", { max: 300 }),
      start,
      end,
      allDay: readOptionalBoolean(args, "allDay") ?? false,
      attendees: addresses(args, "attendees", false),
      ...(location ? { location } : {}),
      ...(description ? { description } : {}),
    });
  },
});

export const MAIL_TOOLS: StewardTool[] = [mailList, mailRead, mailSend, calendarList, calendarCreate];
