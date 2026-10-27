// Copy and the "ready means it works" rule follow OpenDuet server/src/openduet/setup.ts (MIT, CopilotKit).
import type { ComputerManager, MailCalendar, McpManager, SetupCheck, TextModel } from "@steward/shared";
import type { ModelInfo } from "../runtime/agents.ts";

/** Network checks (the model, the mail) are cached this long. */
export const CHECK_TTL_MS = 5 * 60_000;
/** "Check again" re-asks at most this often. */
export const RECHECK_MIN_MS = 10_000;
const MODEL_TIMEOUT_MS = 12_000;
const MAIL_TIMEOUT_MS = 8_000;

export interface SetupDeps {
  model: () => { info: ModelInfo; text?: TextModel; version: number };
  mail: () => MailCalendar | undefined;
  computers: ComputerManager;
  agentId: string;
  mcp: McpManager;
  brandName: string;
  /**
   * The most one reply may write. The check asks for the same room a real reply does: providers
   * judge an account's credit against it, so a 16-token check passed while every reply was refused.
   */
  maxOutputTokens?: number;
  now?: () => number;
}

type CachedCheck = { at: number; key: string; check: SetupCheck };

function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  for (const key of ["statusCode", "status"]) {
    const v = (err as Record<string, unknown>)[key];
    if (typeof v === "number") return v;
  }
  const cause = (err as { cause?: unknown }).cause;
  return cause && cause !== err ? statusOf(cause) : undefined;
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/**
 * The setup checklist. Ready means it works, not that something is set: the model row asks the
 * model for a few tokens, the mail rows read one email and today's calendar. The computer is not
 * launched just to be checked; it reads "not checked" until it has run. Person-facing text never
 * names environment variables or keys beyond "Add a model key in .env".
 */
export class SetupService {
  private readonly cache = new Map<SetupCheck["id"], CachedCheck>();
  private inflight: Promise<SetupCheck[]> | undefined;
  private lastForced = 0;

  constructor(private readonly deps: SetupDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The checklist, using cached network checks younger than five minutes. */
  async list(): Promise<SetupCheck[]> {
    if (!this.inflight) {
      this.inflight = this.build(false).finally(() => {
        this.inflight = undefined;
      });
    }
    return this.inflight;
  }

  /** "Check again": re-asks the network checks, at most once every ten seconds. */
  async recheck(): Promise<SetupCheck[]> {
    const now = this.now();
    if (now - this.lastForced < RECHECK_MIN_MS) return this.list();
    this.lastForced = now;
    await this.inflight?.catch(() => {});
    this.inflight = this.build(true).finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async cached(
    id: SetupCheck["id"],
    key: string,
    force: boolean,
    run: () => Promise<SetupCheck>,
  ): Promise<SetupCheck> {
    const hit = this.cache.get(id);
    if (!force && hit && hit.key === key && this.now() - hit.at < CHECK_TTL_MS) return hit.check;
    const check = await run();
    // A check that could not run is not worth remembering: try again next time.
    if (check.status !== "not_checked") this.cache.set(id, { at: this.now(), key, check });
    else this.cache.delete(id);
    return check;
  }

  private async build(force: boolean): Promise<SetupCheck[]> {
    const model = this.deps.model();
    const mail = this.deps.mail();
    const modelKey = `${model.version}:${model.info.provider}:${model.info.model}`;
    const mailKey = mail ? `${mail.id}:${mail.label}` : "none";
    const [modelCheck, mailCheck, calendarCheck] = await Promise.all([
      this.cached("model", modelKey, force, () => this.checkModel(model.info, model.text)),
      this.cached("mail", mailKey, force, () => this.checkMail(mail)),
      this.cached("calendar", mailKey, force, () => this.checkCalendar(mail)),
    ]);
    return [
      modelCheck,
      mailCheck,
      calendarCheck,
      this.checkComputer(),
      this.checkNotifications(),
      this.checkVoice(),
      this.checkMcp(),
    ];
  }

  private async checkModel(info: ModelInfo, text: TextModel | undefined): Promise<SetupCheck> {
    const name = this.deps.brandName;
    const base = { id: "model" as const, label: "AI model", href: "/settings", optional: false };
    // The scripted model answers but does not think; it has no text model for triage on purpose.
    if (info.scripted && info.problem !== "unavailable") {
      return {
        ...base,
        status: "needs_setup",
        detail: `${name} is using its scripted demo model. It follows a script and does not really think.`,
        fix: "Add a model key in .env, then restart.",
      };
    }
    if (info.problem === "no_key" || (!text && !info.problem)) {
      return {
        ...base,
        status: "needs_setup",
        detail: `Without a model key, ${name} can't answer.`,
        fix: "Add a model key in .env, then restart.",
      };
    }
    if (info.problem === "unavailable" || !text) {
      return {
        ...base,
        status: "needs_setup",
        detail: `The model could not be started, so ${name} can't answer.`,
        fix: "Check the model settings, then restart. The server log says what went wrong.",
      };
    }
    try {
      await text.complete({
        system: "Reply with the single word OK.",
        prompt: "OK?",
        maxTokens: this.deps.maxOutputTokens ?? 4096,
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      });
      return { ...base, status: "ready", detail: `${name} can answer you. It uses ${info.model}.` };
    } catch (err) {
      const status = statusOf(err);
      if (status === 401 || status === 403) {
        return {
          ...base,
          status: "needs_setup",
          detail: `The model provider refused the key, so ${name} can't answer.`,
          fix: "Check the model key in .env, then restart.",
        };
      }
      if (status === 404) {
        return {
          ...base,
          status: "needs_setup",
          detail: `The model provider doesn't offer ${info.model}, so ${name} can't answer.`,
          fix: "Choose another model in Settings.",
        };
      }
      if (status === 402) {
        return {
          ...base,
          status: "needs_setup",
          detail: `The model provider says the account needs credit, so ${name} can't answer.`,
          fix: "Add credit with the model provider, then check again.",
        };
      }
      if (status === 429) {
        return {
          ...base,
          status: "not_checked",
          detail: "The model provider is busy right now. Check again in a minute.",
        };
      }
      return {
        ...base,
        status: "not_checked",
        detail: isTimeout(err)
          ? "The model provider didn't answer in time. Check again later."
          : "Couldn't reach the model provider. Check again later.",
      };
    }
  }

  private async checkMail(mail: MailCalendar | undefined): Promise<SetupCheck> {
    const name = this.deps.brandName;
    const base = { id: "mail" as const, label: "Mail", href: "/connections", optional: false };
    if (!mail) {
      return {
        ...base,
        status: "needs_setup",
        detail: `Without it, ${name} can't read your mail.`,
        fix: "Connect your mail in Connections.",
      };
    }
    try {
      await withTimeout(mail.listEmails({ limit: 1 }), MAIL_TIMEOUT_MS);
      return {
        ...base,
        status: "ready",
        detail: mail.isDemo
          ? "Reading the demo inbox. It holds made-up mail, not yours."
          : `${name} can read your mail (${mail.label}).`,
      };
    } catch {
      return {
        ...base,
        status: "needs_setup",
        detail: `Couldn't read your mail just now, so ${name} can't check it.`,
        fix: "Check the connection in Connections.",
      };
    }
  }

  private async checkCalendar(mail: MailCalendar | undefined): Promise<SetupCheck> {
    const name = this.deps.brandName;
    const base = { id: "calendar" as const, label: "Calendar", href: "/connections", optional: false };
    if (!mail) {
      return {
        ...base,
        status: "needs_setup",
        detail: `Without it, ${name} can't read your calendar.`,
        fix: "Connect your calendar in Connections.",
      };
    }
    try {
      const from = new Date();
      const to = new Date(from.getTime() + 24 * 3_600_000);
      await withTimeout(mail.listEvents({ from: from.toISOString(), to: to.toISOString() }), MAIL_TIMEOUT_MS);
      return {
        ...base,
        status: "ready",
        detail: mail.isDemo
          ? "Reading the demo calendar. Its events are made up."
          : `${name} can read your calendar (${mail.label}).`,
      };
    } catch {
      return {
        ...base,
        status: "needs_setup",
        detail: `Couldn't read your calendar just now, so ${name} can't check it.`,
        fix: "Check the connection in Connections.",
      };
    }
  }

  private checkComputer(): SetupCheck {
    const base = { id: "computer" as const, label: "Computer", href: "/computer", optional: false };
    let running = false;
    try {
      running = this.deps.computers.status(this.deps.agentId).running;
    } catch {
      running = false;
    }
    return running
      ? {
          ...base,
          status: "ready",
          detail: "Its computer is running. It can browse the web and work with files.",
        }
      : {
          ...base,
          status: "not_checked",
          detail:
            "Its computer starts the first time it's needed. Then it can browse the web and work with files.",
        };
  }

  private checkNotifications(): SetupCheck {
    return {
      id: "notifications",
      label: "Notifications",
      status: "not_checked",
      detail: "Your browser decides. Without them, you see what needs you only when you look.",
      fix: "Turn them on in Settings.",
      href: "/settings",
      optional: true,
    };
  }

  private checkVoice(): SetupCheck {
    return {
      id: "voice",
      label: "Voice",
      status: "not_checked",
      detail: "Replies can be read aloud with your browser's own voices.",
      fix: "Try it in Settings.",
      href: "/settings",
      optional: true,
    };
  }

  private checkMcp(): SetupCheck {
    const base = { id: "mcp" as const, label: "More tools", href: "/connections", optional: true };
    let servers: ReturnType<McpManager["list"]> = [];
    try {
      servers = this.deps.mcp.list();
    } catch {
      return { ...base, status: "not_checked", detail: "Couldn't list the tool servers just now." };
    }
    if (servers.length === 0) {
      return {
        ...base,
        status: "ready",
        detail: "No tool servers added. Add one in Connections when you need more.",
      };
    }
    const failing = servers.filter((s) => s.status === "error").length;
    const connected = servers.filter((s) => s.status === "connected").length;
    if (failing > 0) {
      return {
        ...base,
        status: "needs_setup",
        detail:
          failing === 1
            ? `1 of ${servers.length} tool servers isn't answering.`
            : `${failing} of ${servers.length} tool servers aren't answering.`,
        fix: "Check them in Connections.",
      };
    }
    return {
      ...base,
      status: "ready",
      detail: connected === 1 ? "1 tool server connected." : `${connected} tool servers connected.`,
    };
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("Timed out"), { name: "TimeoutError" })), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
