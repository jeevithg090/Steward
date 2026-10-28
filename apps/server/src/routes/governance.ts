import { isGatewayError } from "@steward/gateway";
import {
  type Approval,
  type ApprovalAnswer,
  type ApprovalDecider,
  ApprovalDecisionBody,
  type ApprovalStatus,
  DryRunBody,
  ROUTES,
  type Rule,
  RuleBody,
} from "@steward/shared";
import type { Hono } from "hono";
import type { StewardServices } from "../context.ts";
import { asUserError, HttpError, notFound, readBody } from "../http/errors.ts";
import { clip } from "../runtime/run-summary.ts";
import { dryRunCall } from "../tools/dry-run.ts";
import { enumQuery, intQuery, textQuery } from "./query.ts";

const APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  "pending",
  "allowed",
  "refused",
  "expired",
  "cancelled",
];
const EFFECTS = ["allow", "ask", "deny"] as const;

/** Rules that ship with Steward or the tenant package: they can be switched off, not rewritten. */
const isShipped = (rule: Rule) => rule.source === "preset" || rule.source === "tenant";

/**
 * The one way an answer is recorded, for the web card and for a phone alike: the approval must be
 * pending, "Always allow" only where offered, the gateway claims the answer once (and checks the
 * device presets when `by` names a device), and the resume sweep carries on if no browser does.
 */
export function decideApproval(
  s: StewardServices,
  id: string,
  answer: ApprovalAnswer,
  note?: string,
  by?: ApprovalDecider,
): Approval {
  const { approvals } = s.gateway;
  const existing = approvals.get(id);
  if (!existing) throw notFound("that approval");
  if (existing.status !== "pending") {
    throw new HttpError(
      409,
      existing.status === "expired"
        ? "That request expired before it was answered."
        : "That was already answered.",
    );
  }
  if (answer === "always" && !existing.canAlways) {
    throw new HttpError(400, "Always allow isn't offered for this. Choose Allow once or Refuse.");
  }
  let decided: Approval;
  try {
    decided = approvals.decide(id, answer, s.actorId, note, by);
  } catch (err) {
    if (isGatewayError(err) && err.code === "forbidden") throw new HttpError(403, err.message);
    asUserError(err, 409);
  }
  // If no browser resumes the run within a few seconds, the server does.
  s.sweep.schedule(decided.id);
  return decided;
}

/** `/api/approvals`, `/api/rules`, `/api/audit`: what Steward may do, what it asked, and the record. */
export function registerGovernanceRoutes(app: Hono, s: StewardServices): void {
  const { approvals, rules, audit, governance } = s.gateway;

  // ── Approvals ──────────────────────────────────────────────────────────────────────────────

  app.get(ROUTES.approvals, (c) => {
    const status = enumQuery(c, "status", APPROVAL_STATUSES);
    const threadId = textQuery(c, "threadId", 128);
    const limit = intQuery(c, "limit", { min: 1, max: 500, fallback: 100 });
    return c.json(
      approvals.list({
        ...(status ? { status } : {}),
        ...(threadId ? { threadId } : {}),
        ...(limit ? { limit } : {}),
      }),
    );
  });

  app.get(ROUTES.approval, (c) => {
    const approval = approvals.get(c.req.param("id"));
    if (!approval) throw notFound("that approval");
    return c.json(approval);
  });

  app.post(ROUTES.approvalDecide, async (c) => {
    const body = await readBody(c, ApprovalDecisionBody);
    return c.json(decideApproval(s, c.req.param("id"), body.answer, body.note));
  });

  // ── Rules ──────────────────────────────────────────────────────────────────────────────────

  const validateWhen = (when: string) => {
    try {
      rules.validate(when);
    } catch (err) {
      const why = err instanceof Error && err.message ? clip(err.message, 300) : "It could not be read.";
      throw new HttpError(400, `That rule's condition doesn't work: ${why}`);
    }
  };

  app.get(ROUTES.rules, (c) => c.json(rules.list()));

  app.get(ROUTES.rulesPresets, (c) => c.json(rules.presets()));

  app.post(ROUTES.rulesDryRun, async (c) => {
    const body = await readBody(c, DryRunBody);
    const { proactive } = s;
    const call = await dryRunCall(body, {
      agentId: s.defaultAgentId,
      actorId: s.actorId,
      mcp: s.mcp,
      services: {
        computers: s.computers,
        mail: s.mail,
        web: s.web,
        mcp: s.mcp,
        stores: {
          tasks: proactive.tasks,
          memory: proactive.memory,
          skills: proactive.skills,
          routines: proactive.routines,
          brief: proactive.brief,
          triage: proactive.triage,
        },
        settings: () => ({ plainLanguage: s.settings.plainLanguage(), timezone: s.settings.timezone() }),
      },
    });
    return c.json(governance.dryRun(call));
  });

  app.post(ROUTES.rules, async (c) => {
    const body = await readBody(c, RuleBody);
    validateWhen(body.when);
    try {
      return c.json(rules.create({ ...body, source: "person" }), 201);
    } catch (err) {
      asUserError(err);
    }
  });

  app.put(ROUTES.rule, async (c) => {
    const id = c.req.param("id");
    const body = await readBody(c, RuleBody);
    const rule = rules.get(id);
    if (!rule) throw notFound("that rule");
    if (isShipped(rule)) {
      const rewritten =
        body.name !== rule.name ||
        body.effect !== rule.effect ||
        body.when !== rule.when ||
        body.description !== rule.description;
      if (rewritten) {
        throw new HttpError(
          403,
          "Rules that come with Steward can't be changed. Switch it off, or add your own rule.",
        );
      }
      return c.json(rules.update(id, { enabled: body.enabled }));
    }
    validateWhen(body.when);
    try {
      return c.json(rules.update(id, body));
    } catch (err) {
      asUserError(err);
    }
  });

  app.delete(ROUTES.rule, (c) => {
    const id = c.req.param("id");
    const rule = rules.get(id);
    if (!rule) throw notFound("that rule");
    if (isShipped(rule)) {
      throw new HttpError(403, "Rules that come with Steward can't be deleted. Switch it off instead.");
    }
    rules.remove(id);
    return c.json({ ok: true });
  });

  // ── The record ─────────────────────────────────────────────────────────────────────────────

  app.get(ROUTES.audit, (c) => {
    const before = intQuery(c, "before", { min: 1, max: Number.MAX_SAFE_INTEGER });
    const limit = intQuery(c, "limit", { min: 1, max: 200, fallback: 50 });
    const type = textQuery(c, "type", 64);
    const effect = enumQuery(c, "effect", EFFECTS);
    const q = textQuery(c, "q", 200);
    return c.json(
      audit.page({
        ...(before ? { before } : {}),
        ...(limit ? { limit } : {}),
        ...(type ? { type } : {}),
        ...(effect ? { effect } : {}),
        ...(q ? { q } : {}),
      }),
    );
  });

  app.get(ROUTES.auditVerify, (c) => c.json(audit.verify()));
}
