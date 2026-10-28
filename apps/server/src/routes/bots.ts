import { generateBot } from "@steward/bots-gen";
import { BOT_CATEGORIES, BotMakeBody, BotsQuery, ROUTES } from "@steward/shared";
import type { Hono } from "hono";
import { z } from "zod";
import { BotService } from "../bots/service.ts";
import { isRemoteDirectory } from "../config.ts";
import type { StewardServices } from "../context.ts";
import { HttpError, readBody } from "../http/errors.ts";
import { clip } from "../runtime/run-summary.ts";

const isMissingFile = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "ENOENT";

/**
 * Like `BotPreviewBody`, with the pack read loosely: a pack that breaks the rules (an `allow` rule,
 * a tool Steward does not have) is answered with the problem named in plain words, not with the
 * schema's first complaint.
 */
const PackBody = z
  .object({
    packUrl: z.string().min(1).max(2048).optional(),
    pack: z.unknown().optional(),
  })
  .refine((b) => b.packUrl || b.pack !== undefined, "Give a pack or its URL");

/** `/api/bots`: the directory, what a bot would mean here, and installing, updating and removing one. */
export function registerBotRoutes(app: Hono, s: StewardServices): void {
  const { bots, directory } = s;

  app.get(ROUTES.bots, async (c) => {
    const parsed = BotsQuery.safeParse(c.req.query());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new HttpError(
        400,
        `${issue?.path.join(".") ?? "query"}: ${issue?.message ?? "could not be read."}`,
      );
    }
    try {
      const [page, index] = await Promise.all([directory.list(parsed.data), directory.index()]);
      return c.json({
        bots: bots.decorate(page.bots),
        total: page.total,
        categories: Object.keys(index.categories).length > 0 ? index.categories : BOT_CATEGORIES,
        directory: { name: index.name, ...(index.site ? { site: index.site } : {}) },
      });
    } catch (err) {
      // The bundled directory is built from `directory/bots`; before that build there is nothing
      // to list, which is not a failure.
      if (isMissingFile(err) && !isRemoteDirectory(s.config.directoryUrl)) {
        return c.json({
          bots: [],
          total: 0,
          categories: BOT_CATEGORIES,
          directory: { name: "", problem: "The bot directory has not been built yet." },
        });
      }
      console.error(
        "[steward] the bot directory could not be read:",
        err instanceof Error ? err.message : err,
      );
      throw new HttpError(
        502,
        "Couldn't reach the bot directory. Check the directory address in your settings.",
      );
    }
  });

  app.get(ROUTES.botsInstalled, async (c) => c.json(await bots.listInstalled()));

  app.post(ROUTES.botsPreview, async (c) => {
    const body = await readBody(c, PackBody);
    const { raw } = await bots.load(body);
    const checked = bots.check(raw);
    const pack = checked.ok ? checked.pack : bots.readable(raw);
    if (!pack) throw BotService.refusal(checked.problems);
    return c.json({ ...bots.preview(pack), problems: checked.problems });
  });

  app.post(ROUTES.botsInstall, async (c) => {
    const body = await readBody(c, PackBody);
    const { raw, source, fromDirectory } = await bots.load(body);
    const checked = bots.check(raw);
    if (!checked.ok) {
      const refusal = BotService.refusal(checked.problems);
      return c.json({ error: refusal.message, problems: refusal.problems }, 400);
    }
    return c.json(await bots.install(checked.pack, source, { fromDirectory }), 201);
  });

  app.post(`${ROUTES.botInstalled}/update`, async (c) =>
    c.json(await bots.updateFromDirectory(c.req.param("id"))),
  );

  app.delete(ROUTES.botInstalled, async (c) => {
    await bots.remove(c.req.param("id"));
    return c.json({ ok: true });
  });

  // Make a bot: generated here, with the person's own model when there is one (the scripted model
  // has no real answers, so the generator falls back to a template). Never installed by this route.
  app.post(ROUTES.botsMake, async (c) => {
    const body = await readBody(c, BotMakeBody);
    const model = s.models.textModel();
    let made: Awaited<ReturnType<typeof generateBot>>;
    try {
      made = await generateBot(
        {
          job: body.job,
          ...(body.name ? { name: body.name } : {}),
          ...(body.category ? { category: body.category } : {}),
        },
        {
          ...(model ? { model } : {}),
          tools: bots.knownTools(),
          validateRule: (when: string) => s.gateway.rules.validate(when),
        },
      );
    } catch (err) {
      console.error("[steward] making a bot failed:", err instanceof Error ? err.message : err);
      throw new HttpError(
        502,
        "The bot couldn't be made. The model did not answer in a way Steward could use.",
      );
    }
    const errors = made.problems.filter((p: { severity: string }) => p.severity === "error");
    if (errors.length > 0) {
      return c.json(
        { error: `The bot couldn't be made: ${clip(errors[0]!.message, 300)}`, problems: made.problems },
        422,
      );
    }
    return c.json(made.pack);
  });
}
