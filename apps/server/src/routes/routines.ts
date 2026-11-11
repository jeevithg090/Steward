import { InboxWatchBody, ROUTES, RoutineBody } from "@steward/shared";
import type { Hono } from "hono";
import { z } from "zod";
import type { StewardServices } from "../context.ts";
import { asUserError, HttpError, notFound, readBody } from "../http/errors.ts";
import { isTimezone } from "../store/settings.ts";
import { withdrawApprovals } from "./threads.ts";

/** Like `RoutineBody`, but a missing time zone means the person's own rather than UTC. */
const RoutineCreateBody = RoutineBody.extend({ timezone: z.string().optional() });
/** Every field optional and none defaulted, so a patch changes only what it names. */
const RoutinePatchBody = RoutineBody.extend({
  timezone: z.string().optional(),
  enabled: z.boolean().optional(),
}).partial();

const checkTimezone = (tz: string | undefined) => {
  if (tz !== undefined && !isTimezone(tz)) throw new HttpError(400, "That is not a time zone I know.");
};

/** `/api/routines`: standing instructions on a schedule. The store refuses anything more often than every 15 minutes. */
export function registerRoutineRoutes(app: Hono, s: StewardServices): void {
  const { routines } = s.proactive;

  app.get(ROUTES.routines, (c) => c.json(routines.list()));

  app.post(ROUTES.routines, async (c) => {
    const body = await readBody(c, RoutineCreateBody);
    checkTimezone(body.timezone);
    let routine: ReturnType<typeof routines.create>;
    try {
      routine = routines.create({
        title: body.title.trim(),
        prompt: body.prompt.trim(),
        schedule: body.schedule.trim(),
        timezone: body.timezone ?? s.settings.timezone(),
        enabled: body.enabled,
        agentId: s.defaultAgentId,
      });
    } catch (err) {
      asUserError(err);
    }
    s.threads.upsertMeta({
      id: routine.threadId,
      agentId: routine.agentId,
      kind: "routine",
      title: routine.title,
    });
    return c.json(routine, 201);
  });

  app.patch(ROUTES.routine, async (c) => {
    const id = c.req.param("id");
    const body = await readBody(c, RoutinePatchBody);
    if (!routines.get(id)) throw notFound("that routine");
    checkTimezone(body.timezone);
    let routine: ReturnType<typeof routines.update>;
    try {
      routine = routines.update(id, body);
    } catch (err) {
      asUserError(err);
    }
    if (body.title !== undefined) {
      s.threads.upsertMeta({
        id: routine.threadId,
        agentId: routine.agentId,
        kind: "routine",
        title: routine.title,
      });
    }
    return c.json(routine);
  });

  app.delete(ROUTES.routine, (c) => {
    const id = c.req.param("id");
    const routine = routines.get(id);
    if (!routine) throw notFound("that routine");
    routines.remove(id);
    // Nothing will fire it again, so a request its last run left waiting goes too.
    withdrawApprovals(s, routine.threadId);
    return c.json({ ok: true });
  });

  // The inbox watch: off until the person switches it on. It only reads mail and suggests.
  app.get(ROUTES.inboxWatch, (c) => c.json(s.proactive.watch.status()));
  app.patch(ROUTES.inboxWatch, async (c) => {
    const body = await readBody(c, InboxWatchBody);
    return c.json(s.proactive.watch.setEnabled(body.enabled));
  });

  app.post(ROUTES.routineRun, (c) => {
    const routine = routines.get(c.req.param("id"));
    if (!routine) throw notFound("that routine");
    if (!routine.enabled) throw new HttpError(409, "This routine is paused. Turn it on first.");
    const run = s.workers.runRoutine(routine);
    return c.json({ threadId: run.threadId });
  });
}
