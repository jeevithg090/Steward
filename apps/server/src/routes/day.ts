import { type EmailSummary, ROUTES, type TriageItem } from "@steward/shared";
import type { Hono } from "hono";
import { z } from "zod";
import type { StewardServices } from "../context.ts";
import { HttpError, readBody } from "../http/errors.ts";
import { isLocalDate, localDate, zonedDayRange } from "../util/time.ts";
import { flagQuery, intQuery } from "./query.ts";

const BriefGenerateBody = z.object({
  date: z.string().optional(),
  force: z.boolean().default(true),
});

/** The longest calendar window one request may ask for. */
const MAX_CALENDAR_DAYS = 62;
const TRIAGE_TIMEOUT_MS = 45_000;

/**
 * Adds the triage verdict to each email. The triage service keeps its own cache, so mail it has
 * sorted before is not sent to the model again. A failed triage leaves mail unsorted rather than
 * guessing.
 */
async function withTriage(
  emails: EmailSummary[],
  triage: StewardServices["proactive"]["triage"],
): Promise<(EmailSummary & { triage?: TriageItem })[]> {
  let verdicts: TriageItem[] = [];
  try {
    verdicts = await triage.triage(emails, { signal: AbortSignal.timeout(TRIAGE_TIMEOUT_MS) });
  } catch (err) {
    console.error("[steward] triage failed:", err instanceof Error ? err.message : err);
  }
  const byEmail = new Map(verdicts.map((v) => [v.emailId, v]));
  return emails.map((e) => {
    const verdict = byEmail.get(e.id);
    return verdict ? { ...e, triage: verdict } : e;
  });
}

/** Accepts an ISO instant or a local date; a local date means the start of that day in `tz`. */
function instant(value: string, tz: string, endOfDay: boolean): string {
  if (isLocalDate(value)) {
    const day = zonedDayRange(value, tz);
    return endOfDay ? day.to : day.from;
  }
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new HttpError(400, "Give dates as YYYY-MM-DD or a full date and time.");
  return new Date(t).toISOString();
}

/** `/api/brief`, `/api/inbox`, `/api/calendar`: the person's day. */
export function registerDayRoutes(app: Hono, s: StewardServices): void {
  const { brief, triage } = s.proactive;

  app.get(ROUTES.brief, (c) => {
    const date = c.req.query("date");
    if (date && !isLocalDate(date)) throw new HttpError(400, "Give the date as YYYY-MM-DD.");
    return c.json((date ? brief.get(date) : brief.latest()) ?? null);
  });

  app.post(ROUTES.briefGenerate, async (c) => {
    const body = await readBody(c, BriefGenerateBody);
    const date = body.date ?? localDate(new Date(), s.settings.timezone());
    if (!isLocalDate(date)) throw new HttpError(400, "Give the date as YYYY-MM-DD.");
    try {
      return c.json(await brief.generate({ date, force: body.force, signal: c.req.raw.signal }));
    } catch (err) {
      console.error("[steward] brief failed:", err instanceof Error ? err.message : err);
      throw new HttpError(502, "Couldn't prepare the brief just now. Try again.");
    }
  });

  app.get(ROUTES.inbox, async (c) => {
    const mail = s.mail();
    if (!mail) return c.json([]);
    const limit = intQuery(c, "limit", { min: 1, max: 50, fallback: 25 });
    let emails: EmailSummary[];
    try {
      emails = await mail.listEmails({ limit, ...(flagQuery(c, "unread") ? { unreadOnly: true } : {}) });
    } catch (err) {
      console.error("[steward] reading mail failed:", err instanceof Error ? err.message : err);
      throw new HttpError(502, "Couldn't read your mail. Try again.");
    }
    return c.json(await withTriage(emails, triage));
  });

  app.get(ROUTES.calendar, async (c) => {
    const mail = s.mail();
    if (!mail) return c.json([]);
    const tz = s.settings.timezone();
    const today = zonedDayRange(localDate(new Date(), tz), tz);
    const fromRaw = c.req.query("from");
    const toRaw = c.req.query("to");
    const from = fromRaw ? instant(fromRaw, tz, false) : today.from;
    const to = toRaw ? instant(toRaw, tz, true) : fromRaw ? instant(fromRaw, tz, true) : today.to;
    const span = Date.parse(to) - Date.parse(from);
    if (span <= 0) throw new HttpError(400, "The end must come after the start.");
    if (span > MAX_CALENDAR_DAYS * 86_400_000) {
      throw new HttpError(400, `Ask for at most ${MAX_CALENDAR_DAYS} days at a time.`);
    }
    try {
      return c.json(await mail.listEvents({ from, to }));
    } catch (err) {
      console.error("[steward] reading the calendar failed:", err instanceof Error ? err.message : err);
      throw new HttpError(502, "Couldn't read your calendar. Try again.");
    }
  });
}
