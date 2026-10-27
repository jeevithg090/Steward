import { MemoryBody, ROUTES, SkillBody } from "@steward/shared";
import type { Hono } from "hono";
import type { StewardServices } from "../context.ts";
import { asUserError, HttpError, notFound, readBody } from "../http/errors.ts";

/** `/api/memory` and `/api/skills`: what Steward knows about the person, and instructions written once. */
export function registerKnowledgeRoutes(app: Hono, s: StewardServices): void {
  const { memory, skills } = s.proactive;

  app.get(ROUTES.memory, (c) => c.json(memory.list()));

  app.post(ROUTES.memory, async (c) => {
    const body = await readBody(c, MemoryBody);
    const text = body.text.trim();
    if (!text) throw new HttpError(400, "Say what Steward should remember.");
    return c.json(memory.add(text, "you"), 201);
  });

  app.delete(ROUTES.memoryItem, (c) => {
    const id = c.req.param("id");
    if (!memory.list().some((f) => f.id === id)) throw notFound("that memory");
    memory.remove(id);
    return c.json({ ok: true });
  });

  app.get(ROUTES.skills, (c) => c.json(skills.list()));

  app.post(ROUTES.skills, async (c) => {
    const body = await readBody(c, SkillBody);
    if (skills.get(body.name)) throw new HttpError(409, `There is already a skill called /${body.name}.`);
    try {
      return c.json(skills.create(body), 201);
    } catch (err) {
      asUserError(err);
    }
  });

  app.put(ROUTES.skill, async (c) => {
    const id = c.req.param("id");
    const body = await readBody(c, SkillBody);
    const skill = skills.get(id);
    if (!skill) throw notFound("that skill");
    if (skill.source === "tenant") {
      throw new HttpError(
        403,
        "This skill comes with Steward and can't be changed. Make your own copy instead.",
      );
    }
    const clash = skills.get(body.name);
    if (clash && clash.id !== skill.id)
      throw new HttpError(409, `There is already a skill called /${body.name}.`);
    try {
      return c.json(skills.update(skill.id, body));
    } catch (err) {
      asUserError(err);
    }
  });

  app.delete(ROUTES.skill, (c) => {
    const skill = skills.get(c.req.param("id"));
    if (!skill) throw notFound("that skill");
    if (skill.source === "tenant")
      throw new HttpError(403, "This skill comes with Steward and can't be deleted.");
    skills.remove(skill.id);
    return c.json({ ok: true });
  });
}
