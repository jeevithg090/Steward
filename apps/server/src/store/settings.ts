import type { Db } from "@steward/db";
import { fromJson, toJson } from "@steward/db";
import type { ModelConfig, Settings, SettingsBody } from "@steward/shared";
import type { z } from "zod";
import { HttpError } from "../http/errors.ts";

export type SettingsPatch = z.infer<typeof SettingsBody>;

/** The model the person picked in Settings. Overrides the tenant and the environment. */
export interface ModelChoice {
  provider: ModelConfig["provider"];
  model: string;
  /** Only for a provider that takes an address (`takesAddress`). */
  baseUrl?: string;
}

/** Providers whose address the person gives. Every other one has its own endpoint for its key. */
const ADDRESS_PROVIDERS: ReadonlySet<string> = new Set(["ollama", "openai-compatible"]);

export function takesAddress(provider: string): boolean {
  return ADDRESS_PROVIDERS.has(provider);
}

export const SETTINGS_DEFAULTS = {
  plainLanguage: false,
  briefTime: "08:00",
  approvalExpiryHours: 24,
} as const;

/** The machine's own time zone, falling back to UTC when the runtime cannot tell. */
export function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isBriefTime(value: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60;
}

/** Key-value settings in the server's own table. Values are JSON. */
export class SettingsStore {
  constructor(
    private readonly db: Db,
    private readonly fallbackTimezone: string = systemTimezone(),
  ) {}

  get<T>(key: string, fallback: T): T {
    const row = this.db.get<{ value: string }>("SELECT value FROM server_settings WHERE key = ?", [key]);
    return row ? fromJson<T>(row.value, fallback) : fallback;
  }

  set(key: string, value: unknown): void {
    this.db.run(
      `INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, toJson(value), new Date().toISOString()],
    );
  }

  delete(key: string): void {
    this.db.run("DELETE FROM server_settings WHERE key = ?", [key]);
  }

  plainLanguage(): boolean {
    return this.get("plainLanguage", SETTINGS_DEFAULTS.plainLanguage);
  }

  briefTime(): string {
    const value = this.get<string>("briefTime", SETTINGS_DEFAULTS.briefTime);
    return isBriefTime(value) ? value : SETTINGS_DEFAULTS.briefTime;
  }

  timezone(): string {
    const value = this.get<string>("timezone", this.fallbackTimezone);
    return isTimezone(value) ? value : this.fallbackTimezone;
  }

  approvalExpiryHours(): number {
    return this.get("approvalExpiryHours", SETTINGS_DEFAULTS.approvalExpiryHours);
  }

  /** The saved choice. An address saved with a provider that takes none (an older bug) is left out. */
  modelChoice(): ModelChoice | undefined {
    const choice = this.get<ModelChoice | undefined>("model", undefined);
    if (!choice?.baseUrl || takesAddress(choice.provider)) return choice;
    const { baseUrl: _ignored, ...rest } = choice;
    return rest;
  }

  /** The settings as the web app sees them, with the model actually in use. */
  read(model: { provider: string; model: string; baseUrl?: string }): Settings {
    return {
      model: {
        provider: model.provider,
        model: model.model,
        ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}),
      },
      plainLanguage: this.plainLanguage(),
      briefTime: this.briefTime(),
      timezone: this.timezone(),
      approvalExpiryHours: this.approvalExpiryHours(),
    };
  }

  /** Applies a validated patch. Throws a 400 for values the schema cannot judge alone. */
  update(patch: SettingsPatch): void {
    if (patch.timezone !== undefined && !isTimezone(patch.timezone)) {
      throw new HttpError(400, "That is not a time zone I know. Use a name like Europe/London.");
    }
    if (patch.briefTime !== undefined && !isBriefTime(patch.briefTime)) {
      throw new HttpError(400, "Give the brief time as HH:MM, for example 08:00.");
    }
    this.db.tx(() => {
      if (patch.plainLanguage !== undefined) this.set("plainLanguage", patch.plainLanguage);
      if (patch.briefTime !== undefined) this.set("briefTime", patch.briefTime);
      if (patch.timezone !== undefined) this.set("timezone", patch.timezone);
      if (patch.approvalExpiryHours !== undefined) this.set("approvalExpiryHours", patch.approvalExpiryHours);
      if (patch.model !== undefined) {
        // The choice is replaced whole, so a new provider never inherits the old one's address, and
        // an address sent with a provider that takes none (a stale form field) is dropped.
        const { provider, model, baseUrl } = patch.model;
        const choice: ModelChoice = {
          provider,
          model,
          ...(baseUrl && takesAddress(provider) ? { baseUrl } : {}),
        };
        this.set("model", choice);
      }
    });
  }
}
