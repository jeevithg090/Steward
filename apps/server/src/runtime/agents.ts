import { randomUUID } from "node:crypto";
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
  resolveModelConfig,
} from "@steward/agent";
import { profileFromPack } from "@steward/bots";
import type { AgentProfile, BotPack, ModelConfig, TenantPackage, TextModel } from "@steward/shared";
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

type LoadedModel = Awaited<ReturnType<typeof createModel>>;

/**
 * Everything `createStewardAgent` needs except what the host decides per profile. The directory
 * client rides along in `directory`, for the `directory_find` tool.
 */
export type SharedAgentDeps = Omit<AgentDeps, "profile" | "tenant" | "model" | "serverRunToken">;

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

interface Generation {
  config: ModelConfig;
  info: ModelInfo;
  /** Tenant profiles first, then one per installed bot, each with its `source`. */
  profiles: AgentProfile[];
  agents: Record<string, AbstractAgent>;
  text?: TextModel;
  loaded: LoadedModel[];
}

/**
 * Owns the model and one agent per profile: the tenant's, then one for every installed bot. The
 * runtime reads `agents` on every request, so a model change in Settings or a bot being added or
 * removed swaps them without a restart; runs already in flight finish on the clone they started
 * with, and the old model is closed a minute later.
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
    },
  ) {}

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

  /** The tenant's profiles, then one per installed bot. A bot with a tenant agent's id is left out. */
  private collectProfiles(): AgentProfile[] {
    const profiles: AgentProfile[] = this.deps.tenant.agents.map((p) => ({
      ...p,
      source: p.source ?? "tenant",
    }));
    const taken = new Set(profiles.map((p) => p.id));
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
    let config: ModelConfig;
    try {
      config = resolveModelConfig(tenant, env);
    } catch (err) {
      console.error("[steward] model settings could not be read:", err instanceof Error ? err.message : err);
      config = tenant.model;
    }

    const loaded: LoadedModel[] = [];
    let primary: LoadedModel | undefined;
    let problem: ModelInfo["problem"];
    if (!hasKey(config, this.deps.env)) {
      problem = "no_key";
    } else {
      try {
        primary = await createModel(config, this.deps.env);
        loaded.push(primary);
      } catch (err) {
        console.error("[steward] the model could not be started:", err instanceof Error ? err.message : err);
        problem = "unavailable";
      }
    }

    const profiles = this.collectProfiles();
    const agents: Record<string, AbstractAgent> = {};
    for (const profile of profiles) {
      if (!primary) {
        agents[profile.id] = new UnconfiguredAgent(
          problem === "no_key" ? NOTICE_NO_KEY : NOTICE_UNAVAILABLE,
          {
            agentId: profile.id,
            description: profile.title,
          },
        );
        continue;
      }
      let model = primary;
      if (profile.model && profile.model !== config.model && !primary.scripted) {
        try {
          model = await createModel({ ...config, model: profile.model }, this.deps.env);
          loaded.push(model);
        } catch (err) {
          console.error(
            `[steward] agent ${profile.id}'s model could not be started; using the default:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      try {
        agents[profile.id] = createStewardAgent({
          ...this.deps.shared,
          profile,
          tenant,
          model: model.model,
          serverRunToken: this.deps.serverRunToken,
          maxOutputTokens: maxOutputTokens(this.deps.env),
        });
      } catch (err) {
        console.error(
          `[steward] agent ${profile.id} could not be built:`,
          err instanceof Error ? err.message : err,
        );
        agents[profile.id] = new UnconfiguredAgent(NOTICE_UNAVAILABLE, { agentId: profile.id });
      }
    }

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
      // The scripted model has no real answers for triage or the brief, so those fall back to rules.
      ...(primary && !primary.scripted ? { text: createTextModel(primary.model, primary.label) } : {}),
      loaded,
    };

    const previous = this.current;
    this.current = next;
    this.generation++;
    if (previous) this.retire(previous.loaded);
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
