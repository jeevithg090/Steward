import { type DirectoryClient, describeMayDo, hashPack, type PackProblem, validatePack } from "@steward/bots";
import type { Db } from "@steward/db";
import { gateCallFor, type StewardGateway } from "@steward/gateway";
import {
  type BotListing,
  type BotPack,
  BotPackSchema,
  type BotPreview,
  type Decision,
  type DirectoryIndex,
  type EventBus,
  type InstalledBot,
  type MailCalendar,
  type McpManager,
  mcpToolName,
  parseMcpToolName,
  TOOL_PLAIN_WORDS,
  TOOLS,
} from "@steward/shared";
import { isRemoteDirectory } from "../config.ts";
import type { ProactiveServices } from "../context.ts";
import { asUserError, HttpError, notFound } from "../http/errors.ts";
import type { AgentHost, BotAgentSource } from "../runtime/agents.ts";
import { clip } from "../runtime/run-summary.ts";
import { type InstalledBotRecord, type InstalledBotStore, toInstalledBot } from "../store/bots.ts";
import type { SettingsStore } from "../store/settings.ts";
import type { ThreadStore } from "../store/threads.ts";

export type { PackProblem };

export type PackCheck =
  | { ok: true; pack: BotPack; problems: PackProblem[] }
  | { ok: false; problems: PackProblem[] };

/** A listing with what this Steward knows about it: installed, and whether the listing is newer. */
export type BotListingState = BotListing & { installed?: { version: number; updateAvailable: boolean } };

/** Limits of the stores a pack's parts land in. */
const SKILL_NAME_MAX = 41;
const SKILL_DESCRIPTION_MAX = 300;
const RULE_NAME_MAX = 120;

/** What every bot asks before, whatever its tools: the gateway's defaults for send, pay and sign. */
const ALWAYS_ASKS = ["sending anything", "paying", "signing"];

/** Plain words for a tool the gateway would ask about, without the "(asks first)" note. */
function askWords(tool: string): string {
  const known = TOOL_PLAIN_WORDS[tool];
  if (known) return known.replace(/\s*\(asks first\)\s*$/, "");
  const mcp = parseMcpToolName(tool);
  if (mcp) return `use ${mcp.tool} on ${mcp.server}`;
  return tool.replace(/_/g, " ");
}

function dedupe(words: string[]): string[] {
  return [...new Set(words.map((w) => w.trim()).filter(Boolean))];
}

/**
 * Where an install is counted, for a directory read over the network: `<site>/api/bots/<id>/installed`,
 * or beside the index when the index names no site. A directory read from a file has no such place.
 */
export function countsEndpoint(
  source: string,
  id: string,
  index?: Pick<DirectoryIndex, "site">,
): string | undefined {
  if (!isRemoteDirectory(source)) return undefined;
  const site = index?.site?.trim();
  const base = site && isRemoteDirectory(site) ? (site.endsWith("/") ? site : `${site}/`) : source;
  try {
    return new URL(`api/bots/${encodeURIComponent(id)}/installed`, base).toString();
  } catch {
    return undefined;
  }
}

/** What the host builds a bot's agent from: the pack and its skills' names as the store has them. */
export function botAgentSources(
  store: InstalledBotStore,
  skills: ProactiveServices["skills"],
): BotAgentSource[] {
  return store.list().map((record) => ({
    pack: record.pack,
    skills: record.skillIds.flatMap((id) => {
      const skill = skills.get(id);
      return skill ? [skill.name] : [];
    }),
  }));
}

export interface BotServiceDeps {
  db: Db;
  directory: DirectoryClient;
  /** The index's URL or path, as configured. */
  directorySource: string;
  /** Tell the directory about installs. Never for a file index. */
  counts: boolean;
  store: InstalledBotStore;
  gateway: StewardGateway;
  proactive: ProactiveServices;
  threads: ThreadStore;
  settings: SettingsStore;
  mail: () => MailCalendar | undefined;
  mcp: McpManager;
  host: AgentHost;
  bus: EventBus;
  actorId: string;
  /** The tenant's agent ids. A bot may not take one of them. */
  tenantAgentIds: readonly string[];
  fetch?: typeof fetch;
}

/**
 * Bots from the directory, in this Steward: what a pack would mean for this person's setup, and
 * installing, updating and removing one. A pack can only tighten the gateway; installing it creates
 * skills, rules (source `bot`) and switched-off routines, and remembers their ids so removal takes
 * away exactly that.
 */
export class BotService {
  constructor(private readonly deps: BotServiceDeps) {}

  /** Every tool name this Steward has: the built-ins and the tools of connected MCP servers. */
  knownTools(): string[] {
    const names = new Set<string>(Object.keys(TOOLS));
    for (const server of this.deps.mcp.list()) {
      for (const tool of server.tools) names.add(mcpToolName(server.id, tool.name));
    }
    return [...names];
  }

  /** Connectors a pack may ask for that are present: `mail`, `calendar`, and MCP server ids. */
  connectors(): string[] {
    const out: string[] = [];
    if (this.deps.mail()) out.push("mail", "calendar");
    for (const server of this.deps.mcp.list()) out.push(server.id);
    return out;
  }

  /**
   * Checks a pack against this Steward: the schema, the tool names, the rules' conditions, and the
   * one rule that never bends (a bot may ask or deny, never allow). The product rule is checked here
   * as well as in the validator, so the refusal names the rule in plain words.
   */
  check(raw: unknown): PackCheck {
    const problems: PackProblem[] = [];
    const rules = (raw as { rules?: unknown } | null)?.rules;
    if (Array.isArray(rules)) {
      rules.forEach((rule: unknown, i) => {
        const r = rule as { name?: unknown; effect?: unknown } | null;
        if (r && typeof r === "object" && r.effect === "allow") {
          const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : `rule ${i + 1}`;
          problems.push({
            path: `rules[${i}].effect`,
            message: `The rule "${name}" would allow something. A bot's rules may only ask or deny.`,
            severity: "error",
          });
        }
      });
    }
    const result = validatePack(raw, {
      tools: this.knownTools(),
      connectors: this.connectors(),
      validateRule: (when) => this.deps.gateway.rules.validate(when),
    });
    const seen = new Set(problems.map((p) => p.path));
    for (const p of result.problems) {
      if (p.severity === "error" && seen.has(p.path)) continue;
      problems.push(p);
    }
    const errors = problems.some((p) => p.severity === "error");
    if (result.ok && result.pack && !errors) return { ok: true, pack: result.pack, problems };
    if (errors) return { ok: false, problems };
    // The validator said no without an error-level problem: still a no, said plainly.
    return {
      ok: false,
      problems: [...problems, { path: "", message: "This pack could not be used.", severity: "error" }],
    };
  }

  /** The pack as far as it can be read, for a preview of something that will be refused. */
  readable(raw: unknown): BotPack | undefined {
    const parsed = BotPackSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }

  /** The 400 install and update answer with: the first problem, and all of them. */
  static refusal(problems: PackProblem[]): HttpError & { problems: PackProblem[] } {
    const errors = problems.filter((p) => p.severity === "error");
    const first = errors[0]?.message ?? "it could not be read.";
    return Object.assign(new HttpError(400, `This bot can't be added: ${first}`), { problems: errors });
  }

  /** Loads the pack a request names: from the directory by URL, or as given. */
  async load(body: {
    packUrl?: string;
    pack?: unknown;
  }): Promise<{ raw: unknown; source: string; fromDirectory: boolean }> {
    if (body.packUrl) {
      let pack: BotPack;
      try {
        pack = await this.deps.directory.pack(body.packUrl);
      } catch (err) {
        throw new HttpError(
          502,
          `Couldn't get that bot from the directory: ${err instanceof Error ? clip(err.message, 200) : "it did not answer."}`,
        );
      }
      const source = isRemoteDirectory(body.packUrl) ? body.packUrl : this.deps.directorySource;
      return { raw: pack, source, fromDirectory: true };
    }
    return { raw: body.pack, source: "local", fromDirectory: false };
  }

  /**
   * What the pack would mean for this person: what it may do without asking is decided by the real
   * gateway (a representative call per tool, untainted), never declared by the pack.
   */
  preview(pack: BotPack): BotPreview {
    const { gateway, actorId } = this.deps;
    const known = new Set(this.knownTools());
    const present = new Set(this.connectors());
    const allowed: string[] = [];
    const asks: string[] = [];
    for (const tool of dedupe(pack.needs.tools)) {
      if (!known.has(tool)) continue;
      let decision: Decision | undefined;
      try {
        decision = gateway.governance.dryRun(gateCallFor({ tool, args: {}, agentId: pack.id, actorId }));
      } catch {
        decision = undefined; // Deciding failed: not something it may do without asking.
      }
      if (decision?.effect === "allow") allowed.push(tool);
      else if (decision?.effect === "ask") asks.push(tool);
    }
    const installed = this.deps.store.get(pack.id);
    return {
      pack,
      mayDoWithoutAsking: describeMayDo(allowed),
      asksBefore: dedupe([
        ...asks.map(askWords),
        ...pack.rules.filter((r) => r.effect === "ask").map((r) => r.name),
        ...ALWAYS_ASKS,
      ]),
      needsMissing: dedupe(pack.needs.connectors).filter((c) => !present.has(c)),
      toolsMissing: dedupe(pack.needs.tools).filter((t) => !known.has(t)),
      ...(installed ? { alreadyInstalled: toInstalledBot(installed) } : {}),
    };
  }

  /** Installed bots, each with the newer version the directory lists, when it lists one. */
  async listInstalled(): Promise<InstalledBot[]> {
    const records = this.deps.store.list();
    if (records.length === 0) return [];
    let listings: Map<string, BotListing> | undefined;
    try {
      listings = new Map((await this.deps.directory.index()).bots.map((b) => [b.id, b]));
    } catch {
      listings = undefined; // The directory is unreachable: the list still answers, without update news.
    }
    return records.map((record) => {
      const listing = listings?.get(record.id);
      return {
        ...toInstalledBot(record),
        ...(listing && listing.version > record.version
          ? { updateAvailable: { version: listing.version, packUrl: listing.packUrl } }
          : {}),
      };
    });
  }

  /** Listings with what this Steward knows about each: installed, and whether the listing is newer. */
  decorate(bots: BotListing[]): BotListingState[] {
    const installed = new Map(this.deps.store.list().map((r) => [r.id, r]));
    return bots.map((bot) => {
      const mine = installed.get(bot.id);
      return mine
        ? { ...bot, installed: { version: mine.version, updateAvailable: bot.version > mine.version } }
        : bot;
    });
  }

  /**
   * Installs a checked pack, or updates the bot it replaces, in one transaction: skills, rules
   * (source `bot`, named after the bot), routines switched off, the installed row and the audit
   * row. Then the agents are rebuilt and browsers told.
   */
  async install(
    pack: BotPack,
    source: string,
    opts: { fromDirectory?: boolean } = {},
  ): Promise<InstalledBot> {
    const { store, proactive, gateway, threads, settings, db, actorId } = this.deps;
    if (this.deps.tenantAgentIds.includes(pack.id)) {
      throw new HttpError(
        400,
        `"${pack.id}" is the id of one of Steward's own agents. The bot needs another id.`,
      );
    }
    const hash = hashPack(pack);
    if (pack.hash && pack.hash !== hash) {
      throw new HttpError(
        400,
        "This bot can't be added: its contents don't match its hash, so it was changed after it was built.",
      );
    }
    const existing = store.get(pack.id);
    if (existing) {
      if (pack.version < existing.version) {
        throw new HttpError(
          409,
          `A newer version of ${existing.name} (version ${existing.version}) is already installed.`,
        );
      }
      if (existing.hash === hash) throw new HttpError(409, `${existing.name} is already installed.`);
    }

    let record: InstalledBotRecord;
    try {
      record = db.tx(() => {
        if (existing) this.takeAway(existing);
        const skillIds = pack.skills.map((skill) => {
          const name = proactive.skills.get(skill.name) ? suffixed(skill.name, pack.id) : skill.name;
          if (name !== skill.name && proactive.skills.get(name)) {
            throw new HttpError(
              409,
              `There is already a skill called /${skill.name} and one called /${name}.`,
            );
          }
          try {
            return proactive.skills.create({
              name,
              description: clip(skill.description, SKILL_DESCRIPTION_MAX),
              instructions: skill.body,
              tools: skill.allowedTools ?? [],
            }).id;
          } catch (err) {
            throw new HttpError(
              400,
              `Skill "${skill.name}": ${err instanceof Error ? err.message : "could not be added."}`,
            );
          }
        });
        const ruleIds = pack.rules.map((rule) => {
          try {
            return gateway.rules.create({
              name: clip(`${pack.name}: ${rule.name}`, RULE_NAME_MAX),
              effect: rule.effect,
              when: rule.when,
              description: rule.description,
              enabled: true,
              source: "bot",
            }).id;
          } catch (err) {
            throw new HttpError(
              400,
              `Rule "${rule.name}": ${err instanceof Error ? err.message : "could not be added."}`,
            );
          }
        });
        const routineIds = pack.routines.map((routine) => {
          let made: ReturnType<ProactiveServices["routines"]["create"]>;
          try {
            made = proactive.routines.create({
              title: routine.title,
              prompt: routine.prompt,
              schedule: routine.schedule,
              timezone: settings.timezone(),
              enabled: false,
              agentId: pack.id,
            });
          } catch (err) {
            throw new HttpError(
              400,
              `Routine "${routine.title}": ${err instanceof Error ? err.message : "could not be added."}`,
            );
          }
          threads.upsertMeta({ id: made.threadId, agentId: pack.id, kind: "routine", title: made.title });
          return made.id;
        });
        const saved = store.upsert({
          id: pack.id,
          name: pack.name,
          version: pack.version,
          hash,
          source,
          agentId: pack.id,
          pack: { ...pack, hash },
          skillIds,
          ruleIds,
          routineIds,
        });
        gateway.audit.append({
          type: existing ? "bot.updated" : "bot.installed",
          actorId,
          agentId: pack.id,
          detail: {
            id: pack.id,
            name: pack.name,
            version: pack.version,
            hash,
            source,
            author: pack.author.kind === "ai" ? "AI-made" : pack.author.handle,
            ...(existing ? { from: existing.version } : {}),
          },
        });
        return saved;
      });
    } catch (err) {
      asUserError(err);
    }
    await this.refresh();
    if (opts.fromDirectory) this.count(pack.id);
    return toInstalledBot(record);
  }

  /** Updates an installed bot from the directory's listing, when the listing is newer. */
  async updateFromDirectory(id: string): Promise<InstalledBot> {
    const existing = this.deps.store.get(id);
    if (!existing) throw notFound("that bot");
    let listing: BotListing | undefined;
    try {
      listing = await this.deps.directory.get(id);
    } catch {
      throw new HttpError(502, "Couldn't reach the bot directory.");
    }
    if (!listing) throw new HttpError(404, `${existing.name} is no longer in the directory.`);
    if (listing.version <= existing.version)
      throw new HttpError(409, `${existing.name} is already up to date.`);
    const { raw, source } = await this.load({ packUrl: listing.packUrl });
    const checked = this.check(raw);
    if (!checked.ok) throw BotService.refusal(checked.problems);
    if (checked.pack.id !== id) {
      throw new HttpError(
        400,
        `The directory's pack for ${existing.name} has another id ("${checked.pack.id}").`,
      );
    }
    return this.install(checked.pack, source, { fromDirectory: true });
  }

  /** Removes a bot and exactly what it brought. Its conversations keep their history. */
  async remove(id: string): Promise<void> {
    const { store, gateway, db, actorId } = this.deps;
    const existing = store.get(id);
    if (!existing) throw notFound("that bot");
    db.tx(() => {
      this.takeAway(existing);
      store.remove(id);
      gateway.audit.append({
        type: "bot.removed",
        actorId,
        agentId: id,
        detail: {
          id,
          name: existing.name,
          version: existing.version,
          hash: existing.hash,
          source: existing.source,
        },
      });
    });
    await this.refresh();
  }

  /** Removes the skills, rules and routines a bot brought, and nothing else. Already-gone ones are skipped. */
  private takeAway(record: InstalledBotRecord): void {
    const { proactive, gateway } = this.deps;
    for (const skillId of record.skillIds) {
      const skill = proactive.skills.get(skillId);
      if (skill && skill.id === skillId && skill.source !== "tenant") proactive.skills.remove(skillId);
    }
    for (const ruleId of record.ruleIds) {
      const rule = gateway.rules.get(ruleId);
      if (rule && rule.source === "bot") gateway.rules.remove(ruleId);
    }
    for (const routineId of record.routineIds) {
      if (proactive.routines.get(routineId)) proactive.routines.remove(routineId);
    }
  }

  private async refresh(): Promise<void> {
    await this.deps.host.rebuild();
    this.deps.bus.emit({ type: "bots.changed" });
  }

  /** One POST with no body and no identity, when counts are on and the directory is a site. */
  private count(id: string): void {
    if (!this.deps.counts) return;
    const send = this.deps.fetch ?? globalThis.fetch;
    void this.deps.directory
      .index()
      .then((index) => countsEndpoint(this.deps.directorySource, id, index))
      .then((url) => (url ? send(url, { method: "POST", signal: AbortSignal.timeout(5_000) }) : undefined))
      .catch(() => {
        // A count is a courtesy to the directory; it never matters to the person.
      });
  }
}

/** `<name>-<bot id>`, cut to the skill store's limit. */
function suffixed(name: string, botId: string): string {
  return `${name}-${botId}`.slice(0, SKILL_NAME_MAX).replace(/-+$/, "");
}
