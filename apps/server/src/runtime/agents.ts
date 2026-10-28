import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  AbstractAgent,
  type AgentConfig,
  type BaseEvent,
  EventType,
  type RunAgentInput,
} from "@ag-ui/client";
import {
  type AgentDeps,
  createModel,
  createStewardAgent,
  createTextModel,
  PROVIDERS,
  profileModel,
  type ResolvedModelConfig,
  resolveModelConfig,
} from "@steward/agent";
import { profileFromPack } from "@steward/bots";
import {
  AcpBackend,
  HarnessAgent,
  type HarnessBackend,
  type HarnessSessionStore,
  HarnessThreads,
  type HarnessThreadsOptions,
  harnessInfo,
  profileKey,
} from "@steward/harnesses";
import type {
  AgentInfo,
  AgentProfile,
  ApprovalStore,
  AuditLog,
  BotPack,
  HarnessInfo,
  HarnessProfile,
  ModelConfig,
  TenantPackage,
  TextModel,
} from "@steward/shared";
import { Observable } from "rxjs";
import { type ModelChoice, takesAddress } from "../store/settings.ts";

/** What the info route and the setup checklist say about the model in use. */
export interface ModelInfo {
  provider: ModelConfig["provider"];
  model: string;
  /**
   * The address someone gave (`STEWARD_MODEL_BASE_URL` or model.yaml), for a provider that takes
   * one. Never a provider's own endpoint: Settings shows it and sends it back with the next choice.
   */
  baseUrl?: string;
  label: string;
  scripted: boolean;
  /** Set when no working model could be built; every agent then answers with a setup notice. */
  problem?: "no_key" | "unavailable";
}

/** What `GET /api/agents` says about one agent: the model it runs on, and whether it can answer. */
export type AgentStatus = Pick<AgentInfo, "available" | "model" | "provider" | "signIn" | "reason">;

type LoadedModel = Awaited<ReturnType<typeof createModel>>;

/**
 * Everything `createStewardAgent` needs except what the host decides per profile. The directory
 * client rides along in `directory`, for the `directory_find` tool.
 */
export type SharedAgentDeps = Omit<AgentDeps, "profile" | "tenant" | "model" | "serverRunToken">;

/** What the host needs to run external coding agents (`tenants/<id>/harnesses.yaml`). */
export interface HarnessDeps {
  profiles: HarnessProfile[];
  /** The server's data folder: each harness works in `computers/<agentId>/workspace` under it. */
  dataDir: string;
  store?: HarnessSessionStore;
  audit?: AuditLog;
  approvals?: Pick<ApprovalStore, "byToolCall">;
  /** How a harness process is started. Tests pass a fake; by default, by the profile's kind. */
  backend?: (
    profile: HarnessProfile,
    opts: Parameters<HarnessThreadsOptions["backend"]>[0],
  ) => HarnessBackend;
  /** Steward's version, sent to the harness as the client's. */
  version?: string;
  idleMs?: number;
}

/** The agent profile an external coding agent gets: its own name, none of Steward's skills or tools. */
export function harnessAgentProfile(harness: HarnessProfile): AgentProfile {
  return {
    id: harness.id,
    name: harness.name,
    title: harness.title,
    instructions: "",
    skills: [],
    tools: [],
    harness: harness.id,
    source: "tenant",
  };
}

/** An installed bot as the host builds an agent from it: its pack and the names its skills got. */
export interface BotAgentSource {
  pack: BotPack;
  /** The skills the bot brought, by the names they have in the store (a clash gets a suffix). */
  skills: string[];
}

/**
 * The model id a pack's `needs.model` names, if it names one. `any` and sentences such as "a model
 * that uses tools well" are capabilities, not ids, and leave the agent on the tenant's model.
 */
export function modelIdFrom(needs: string | undefined): string | undefined {
  const value = needs?.trim() ?? "";
  if (!value || value.toLowerCase() === "any" || value.length > 120) return undefined;
  return /^[a-z0-9][a-z0-9._/:-]*$/i.test(value) && /[a-z]/i.test(value) ? value : undefined;
}

const KEYLESS: ReadonlySet<ModelConfig["provider"]> = new Set(["scripted", "ollama"]);

export const NOTICE_NO_KEY =
  "I can't answer yet: no AI model is set up. Add a model key in .env, then restart Steward.";
export const NOTICE_UNAVAILABLE =
  "I can't answer right now: the AI model could not be started. The server log says why.";

/** The provider's name as people see it: "xAI", "OpenRouter". */
export function providerName(provider: string): string {
  return (PROVIDERS as Record<string, { name: string } | undefined>)[provider]?.name ?? provider;
}

/** What an agent with a provider of its own says while that provider has no key. */
export function noticeNoKeyFor(provider: string): string {
  const name = providerName(provider);
  return `I can't answer yet: this agent runs on ${name}, and no ${name} key is set. Add one in .env, then restart Steward.`;
}

/** The one line `GET /api/agents` gives for an agent whose provider has no key. */
export function reasonNoKeyFor(provider: string): string {
  const name = providerName(provider);
  return `No ${name} key is set. Add one in .env, then restart Steward.`;
}

export const REASON_NO_KEY = "No model key is set. Add one in .env, then restart Steward.";
export const REASON_UNAVAILABLE = "The model could not be started. The server log says why.";

/**
 * Stands in for an agent when there is no working model. It answers every run with one honest
 * sentence instead of failing with a provider error, so first run without a key still works:
 * the app opens, the setup checklist says what to do, and the chat says it too.
 */
export class UnconfiguredAgent extends AbstractAgent {
  private notice: string;

  constructor(notice: string, config?: AgentConfig) {
    super(config);
    this.notice = notice;
  }

  override clone(): UnconfiguredAgent {
    const copy = super.clone() as UnconfiguredAgent;
    copy.notice = this.notice;
    return copy;
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((sub) => {
      const messageId = randomUUID();
      const { threadId, runId } = input;
      sub.next({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent);
      sub.next({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent);
      sub.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: this.notice } as BaseEvent);
      sub.next({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
      sub.next({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);
      sub.complete();
    });
  }
}

/**
 * Applies the person's model choice from Settings on top of the environment: the choice wins, so
 * changing the model in the app works even when `.env` names one. A chosen address counts only for
 * a provider that takes one, so another provider's key is never sent to it.
 */
export function modelEnv(env: NodeJS.ProcessEnv, choice?: ModelChoice): NodeJS.ProcessEnv {
  if (!choice) return env;
  const out: NodeJS.ProcessEnv = {
    ...env,
    STEWARD_MODEL_PROVIDER: choice.provider,
    STEWARD_MODEL: choice.model,
  };
  if (choice.baseUrl && takesAddress(choice.provider)) out.STEWARD_MODEL_BASE_URL = choice.baseUrl;
  else if (env.STEWARD_MODEL_PROVIDER !== choice.provider) delete out.STEWARD_MODEL_BASE_URL;
  return out;
}

/** The address someone gave for this provider, as `resolveModelConfig` reads it, without the provider's own. */
function givenAddress(
  config: ModelConfig,
  tenant: TenantPackage,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (!takesAddress(config.provider)) return undefined;
  const fromEnv = env.STEWARD_MODEL_BASE_URL?.trim();
  if (fromEnv) return fromEnv;
  return config.provider === tenant.model.provider ? tenant.model.baseUrl?.trim() || undefined : undefined;
}

/** `STEWARD_MODEL_MAX_TOKENS`, between 256 and 64k; 4096 when unset or unreadable. */
export function maxOutputTokens(env: NodeJS.ProcessEnv): number {
  const n = Number(env.STEWARD_MODEL_MAX_TOKENS);
  return Number.isInteger(n) && n >= 256 && n <= 65_536 ? n : 4096;
}

function hasKey(cfg: ModelConfig, env: NodeJS.ProcessEnv): boolean {
  // A local OpenAI-compatible server (LM Studio, vLLM, llama.cpp) often needs no key at all.
  if (KEYLESS.has(cfg.provider) || cfg.provider === "openai-compatible" || !cfg.apiKeyEnv) return true;
  return Boolean(env[cfg.apiKeyEnv]?.trim());
}

/** Two configs that would build the same client share one model. */
function modelKey(cfg: ModelConfig): string {
  return [cfg.provider, cfg.model, cfg.baseUrl ?? "", cfg.apiKeyEnv ?? ""].join("\u0000");
}

interface Generation {
  config: ModelConfig;
  info: ModelInfo;
  /** Tenant profiles first, then one per installed bot, each with its `source`. */
  profiles: AgentProfile[];
  agents: Record<string, AbstractAgent>;
  statuses: Record<string, AgentStatus>;
  text?: TextModel;
  loaded: LoadedModel[];
}

/**
 * Owns the models and one agent per profile: the tenant's, then one for every installed bot. A
 * profile without a `model` runs on the model chosen in Settings (or .env, or model.yaml); a
 * profile with one keeps it, on the tenant's provider or on the provider it names, and is listed
 * as unavailable, with a notice instead of an agent, while that provider has no key. The runtime
 * reads `agents` on every request, so a model change in Settings or a bot being added or removed
 * swaps them without a restart; runs already in flight finish on the clone they started with, and
 * the old models are closed a minute later.
 */
export class AgentHost {
  private current: Generation | undefined;
  private readonly retired = new Set<LoadedModel>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private generation = 0;
  private choice: ModelChoice | undefined;
  /** Builds run one after another, so two quick changes never interleave their model starts. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly deps: {
      tenant: TenantPackage;
      env: NodeJS.ProcessEnv;
      serverRunToken: string;
      shared: SharedAgentDeps;
      /** The installed bots, read on every build. */
      bots?: () => BotAgentSource[];
      harnesses?: HarnessDeps;
    },
  ) {}

  /** One set of harness processes per harness profile, kept across rebuilds while it is unchanged. */
  private readonly harnessThreads = new Map<string, { key: string; threads: HarnessThreads }>();

  /** Builds (or rebuilds) the model and the agents. Never throws: problems become a notice agent. */
  configure(choice?: ModelChoice): Promise<void> {
    this.choice = choice;
    const run = this.queue.then(() => this.build(choice));
    this.queue = run.catch(() => {});
    return run;
  }

  /** Builds the agents again on the same model, after a bot was added, updated or removed. */
  rebuild(): Promise<void> {
    return this.configure(this.choice);
  }

  /**
   * The tenant's profiles, then one per external coding agent, then one per installed bot. A
   * harness or bot with an id already taken is left out.
   */
  private collectProfiles(): AgentProfile[] {
    const profiles: AgentProfile[] = this.deps.tenant.agents.map((p) => ({
      ...p,
      source: p.source ?? "tenant",
    }));
    const taken = new Set(profiles.map((p) => p.id));
    for (const harness of this.deps.harnesses?.profiles ?? []) {
      if (taken.has(harness.id)) {
        console.error(
          `[steward] the harness "${harness.id}" has the id of one of the tenant's agents; left out.`,
        );
        continue;
      }
      profiles.push(harnessAgentProfile(harness));
      taken.add(harness.id);
    }
    let sources: BotAgentSource[] = [];
    try {
      sources = this.deps.bots?.() ?? [];
    } catch (err) {
      console.error("[steward] installed bots could not be read:", err instanceof Error ? err.message : err);
    }
    for (const { pack, skills } of sources) {
      if (taken.has(pack.id)) {
        console.error(
          `[steward] the installed bot "${pack.id}" has the id of one of the tenant's agents; left out.`,
        );
        continue;
      }
      try {
        const { model: _declared, ...profile } = profileFromPack(pack);
        const model = modelIdFrom(pack.needs.model);
        profiles.push({ ...profile, skills, ...(model ? { model } : {}), source: `bot:${pack.id}` });
        taken.add(pack.id);
      } catch (err) {
        console.error(
          `[steward] the installed bot "${pack.id}" could not be loaded:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    return profiles;
  }

  private async build(choice?: ModelChoice): Promise<void> {
    const { tenant } = this.deps;
    const env = modelEnv(this.deps.env, choice);
    let config: ResolvedModelConfig;
    try {
      config = resolveModelConfig(tenant, env);
    } catch (err) {
      console.error("[steward] model settings could not be read:", err instanceof Error ? err.message : err);
      config = tenant.model;
    }

    const loaded: LoadedModel[] = [];
    const models = new Map<string, LoadedModel>();
    let primary: LoadedModel | undefined;
    let problem: ModelInfo["problem"];
    if (!hasKey(config, this.deps.env)) {
      problem = "no_key";
    } else {
      try {
        primary = await createModel(config, this.deps.env);
        loaded.push(primary);
        models.set(modelKey(config), primary);
      } catch (err) {
        console.error("[steward] the model could not be started:", err instanceof Error ? err.message : err);
        problem = "unavailable";
      }
    }

    const profiles = this.collectProfiles();
    const agents: Record<string, AbstractAgent> = {};
    const statuses: Record<string, AgentStatus> = {};
    const harnessesInUse = new Set<string>();
    for (const profile of profiles) {
      const harness = profile.harness ? this.harnessProfile(profile.harness) : undefined;
      const built = harness
        ? this.buildHarnessAgent(profile, harness, harnessesInUse)
        : await this.buildAgent(profile, { env, config, primary, problem, models, loaded });
      agents[profile.id] = built.agent;
      statuses[profile.id] = built.status;
    }
    this.retireHarnesses(harnessesInUse);

    const address = givenAddress(config, tenant, env);
    const info: ModelInfo = {
      provider: config.provider,
      model: config.model,
      ...(address ? { baseUrl: address } : {}),
      label: primary?.label ?? config.model,
      scripted: primary?.scripted ?? config.provider === "scripted",
      ...(problem ? { problem } : {}),
    };
    const next: Generation = {
      config,
      info,
      profiles,
      agents,
      statuses,
      // The scripted model has no real answers for triage or the brief, so those fall back to rules.
      ...(primary && !primary.scripted ? { text: createTextModel(primary.model, primary.label) } : {}),
      loaded,
    };

    const previous = this.current;
    this.current = next;
    this.generation++;
    if (previous) this.retire(previous.loaded);
  }

  /**
   * One agent. A profile without a `model` follows the primary model; one with a `model` resolves
   * its own (the tenant's provider, or the one it names) and shares a client with any other
   * profile on the same model. For a tenant profile the model is a pin: no key for its provider,
   * or a model that will not start, makes this one agent a notice; the others are untouched. For
   * an installed bot it is a preference (a pack's `needs.model`): the bot runs on it when it can,
   * and on the primary model otherwise, including the scripted demo model.
   */
  private async buildAgent(
    profile: AgentProfile,
    scope: {
      env: NodeJS.ProcessEnv;
      config: ResolvedModelConfig;
      primary: LoadedModel | undefined;
      problem: ModelInfo["problem"];
      models: Map<string, LoadedModel>;
      loaded: LoadedModel[];
    },
  ): Promise<{ agent: AbstractAgent; status: AgentStatus }> {
    const { tenant } = this.deps;
    const bot = typeof profile.source === "string" && profile.source.startsWith("bot:");
    let own = profile.model !== undefined && !(bot && (!scope.primary || scope.primary.scripted));
    let cfg: ResolvedModelConfig = scope.config;
    if (own) {
      try {
        cfg = resolveModelConfig(tenant, scope.env, profile);
      } catch (err) {
        console.error(
          `[steward] agent ${profile.id}'s model could not be read:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    const shown = (): Pick<AgentStatus, "provider" | "model"> => ({
      provider: cfg.provider,
      model: cfg.model,
    });

    // A bot's model it cannot have: it runs on the primary model instead.
    if (own && bot && cfg.fallbackReason) {
      own = false;
      cfg = scope.config;
    }

    // A profile of its own whose provider has no key: the resolver fell back to scripted and says why.
    if (own && cfg.fallbackReason) {
      const wanted = this.wanted(profile);
      const noKey = cfg.fallbackReason.startsWith("no key for ");
      return {
        agent: new UnconfiguredAgent(noKey ? noticeNoKeyFor(wanted.provider) : NOTICE_UNAVAILABLE, {
          agentId: profile.id,
          description: profile.title,
        }),
        status: {
          ...wanted,
          available: false,
          signIn: "api-key",
          reason: noKey ? reasonNoKeyFor(wanted.provider) : `${cfg.fallbackReason}.`,
        },
      };
    }

    // The primary model, or the profile's own, started once however many profiles share it.
    let model: LoadedModel | undefined =
      !own || (scope.primary && modelKey(cfg) === modelKey(scope.config))
        ? scope.primary
        : await this.loadModel(cfg, scope, profile.id);
    if (!model && own && bot && scope.primary) {
      model = scope.primary;
      cfg = scope.config;
    }

    if (!model) {
      const noKey = !own && scope.problem === "no_key";
      return {
        agent: new UnconfiguredAgent(noKey ? NOTICE_NO_KEY : NOTICE_UNAVAILABLE, {
          agentId: profile.id,
          description: profile.title,
        }),
        status: {
          ...shown(),
          available: false,
          signIn: "api-key",
          reason: noKey ? REASON_NO_KEY : REASON_UNAVAILABLE,
        },
      };
    }

    const status: AgentStatus = {
      ...shown(),
      available: true,
      signIn: model.scripted ? "scripted" : "api-key",
    };
    try {
      return {
        agent: createStewardAgent({
          ...this.deps.shared,
          profile,
          tenant,
          model: model.model,
          serverRunToken: this.deps.serverRunToken,
          maxOutputTokens: maxOutputTokens(this.deps.env),
        }),
        status,
      };
    } catch (err) {
      console.error(
        `[steward] agent ${profile.id} could not be built:`,
        err instanceof Error ? err.message : err,
      );
      return {
        agent: new UnconfiguredAgent(NOTICE_UNAVAILABLE, { agentId: profile.id }),
        status: { ...shown(), available: false, signIn: "api-key", reason: REASON_UNAVAILABLE },
      };
    }
  }

  private harnessProfile(id: string): HarnessProfile | undefined {
    return this.deps.harnesses?.profiles.find((h) => h.id === id);
  }

  /**
   * An external coding agent: a `HarnessAgent` when its program is installed, otherwise a notice
   * that says what to install. Its processes outlive a rebuild while the profile is unchanged, so
   * a request parked on the person is still there when they answer.
   */
  private buildHarnessAgent(
    profile: AgentProfile,
    harness: HarnessProfile,
    inUse: Set<string>,
  ): { agent: AbstractAgent; status: AgentStatus } {
    const info = harnessInfo(harness, this.deps.env);
    const shown = { provider: `harness:${harness.id}`, model: harness.name, signIn: harness.signIn } as const;
    if (!info.available) {
      const reason = info.reason ?? `${harness.name} is not installed.`;
      return {
        agent: new UnconfiguredAgent(`I can't start: ${reason}`, {
          agentId: profile.id,
          description: profile.title,
        }),
        status: { ...shown, available: false, reason },
      };
    }
    const threads = this.threadsFor(harness);
    inUse.add(harness.id);
    const deps = this.deps.harnesses;
    return {
      agent: new HarnessAgent({
        agentId: profile.id,
        title: profile.title,
        harness,
        threads,
        governance: this.deps.shared.governance,
        ...(deps?.approvals ? { approvals: deps.approvals } : {}),
        actorId: this.deps.shared.actorId,
        serverRunToken: this.deps.serverRunToken,
      }),
      status: { ...shown, available: true },
    };
  }

  private threadsFor(harness: HarnessProfile): HarnessThreads {
    const key = profileKey(harness);
    const existing = this.harnessThreads.get(harness.id);
    if (existing && existing.key === key) return existing.threads;
    if (existing) this.retireThreads(existing.threads);
    const deps = this.deps.harnesses;
    const env = this.deps.env;
    const threads = new HarnessThreads({
      profile: harness,
      agentId: harness.id,
      workspace: join(deps?.dataDir ?? ".", "computers", harness.id, "workspace"),
      ...(deps?.store ? { store: deps.store } : {}),
      ...(deps?.audit ? { audit: deps.audit } : {}),
      actorId: this.deps.shared.actorId,
      ...(deps?.idleMs ? { idleMs: deps.idleMs } : {}),
      backend: (opts) =>
        deps?.backend
          ? deps.backend(harness, opts)
          : new AcpBackend({
              profile: harness,
              cwd: opts.cwd,
              events: opts.events,
              env,
              ...(deps?.version ? { version: deps.version } : {}),
            }),
    });
    this.harnessThreads.set(harness.id, { key, threads });
    return threads;
  }

  /** Harness profiles that are gone (or no longer installed) stop their processes a minute later. */
  private retireHarnesses(inUse: Set<string>): void {
    for (const [id, entry] of this.harnessThreads) {
      if (inUse.has(id)) continue;
      this.harnessThreads.delete(id);
      this.retireThreads(entry.threads);
    }
  }

  private retireThreads(threads: HarnessThreads): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void threads.closeAll().catch(() => {});
    }, 60_000);
    timer.unref();
    this.timers.add(timer);
  }

  /** The external coding agents and whether each is installed, for `GET /api/harnesses`. */
  harnessInfos(): HarnessInfo[] {
    return (this.deps.harnesses?.profiles ?? []).map((h) => harnessInfo(h, this.deps.env));
  }

  /** A conversation was deleted: its harness process stops and its resume handle is forgotten. */
  async closeThread(threadId: string): Promise<void> {
    await Promise.all([...this.harnessThreads.values()].map(({ threads }) => threads.close(threadId, true)));
  }

  /** Starts the model a config names, or reuses the one already started for it. Undefined when it fails. */
  private async loadModel(
    cfg: ModelConfig,
    scope: { models: Map<string, LoadedModel>; loaded: LoadedModel[] },
    agentId: string,
  ): Promise<LoadedModel | undefined> {
    const key = modelKey(cfg);
    const existing = scope.models.get(key);
    if (existing) return existing;
    try {
      const model = await createModel(cfg, this.deps.env);
      scope.loaded.push(model);
      scope.models.set(key, model);
      return model;
    } catch (err) {
      console.error(
        `[steward] agent ${agentId}'s model could not be started:`,
        err instanceof Error ? err.message : err,
      );
      return undefined;
    }
  }

  /** The provider and model a profile's `model` asks for, by the same reading `resolveModelConfig` uses. */
  private wanted(profile: AgentProfile): Pick<AgentStatus, "provider" | "model"> {
    const { model: tenantModel } = this.deps.tenant;
    if (!profile.model) return { provider: tenantModel.provider, model: tenantModel.model };
    const own = profileModel(profile.model, tenantModel.provider);
    return { provider: own.provider ?? tenantModel.provider, model: own.model };
  }

  get agents(): Record<string, AbstractAgent> {
    return this.current?.agents ?? {};
  }

  agent(id: string): AbstractAgent | undefined {
    return this.current?.agents[id];
  }

  /** Every profile an agent was built for: the tenant's, then the installed bots', with `source`. */
  get profiles(): AgentProfile[] {
    return this.current?.profiles ?? [];
  }

  /** What `GET /api/agents` lists: every profile with the model it runs on and whether it can answer. */
  agentInfos(): AgentInfo[] {
    const statuses = this.current?.statuses ?? {};
    return this.profiles.map((profile) => {
      const status: AgentStatus = statuses[profile.id] ?? {
        provider: this.deps.tenant.model.provider,
        model: this.deps.tenant.model.model,
        available: false,
        signIn: "api-key",
        reason: REASON_UNAVAILABLE,
      };
      return { ...profile, ...status };
    });
  }

  hasAgent(id: string): boolean {
    return Object.hasOwn(this.agents, id);
  }

  get info(): ModelInfo {
    if (!this.current) throw new Error("AgentHost.configure() has not run");
    return this.current.info;
  }

  get config(): ModelConfig {
    if (!this.current) throw new Error("AgentHost.configure() has not run");
    return this.current.config;
  }

  textModel(): TextModel | undefined {
    return this.current?.text;
  }

  /** Bumps on every configure, so caches of model checks know to start over. */
  get version(): number {
    return this.generation;
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    const harnesses = [...this.harnessThreads.values()];
    this.harnessThreads.clear();
    await Promise.all(harnesses.map(({ threads }) => threads.closeAll().catch(() => {})));
    const all = [...this.retired, ...(this.current?.loaded ?? [])];
    this.retired.clear();
    this.current = undefined;
    await Promise.all(all.map((m) => m.close().catch(() => {})));
  }

  private retire(models: LoadedModel[]): void {
    for (const m of models) this.retired.add(m);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      for (const m of models) {
        this.retired.delete(m);
        m.close().catch(() => {});
      }
    }, 60_000);
    timer.unref();
    this.timers.add(timer);
  }
}
