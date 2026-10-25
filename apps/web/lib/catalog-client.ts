// The Gateway client for the new pages (SHIPPING.md §4.5 profile routes and the Track 1b letter
// routes). Plain fetch with the same bearer as lib/api.ts; that file is left as it is.
import { type GatewayConfig, gatewayConfig } from "./api";
import type { LetterReading, ReadLetterRequest, ReplyDraft, ReplyRequest, SampleLetter } from "./letters";
import type { ProfileView, SkillManifest } from "./profiles";
import lettersJson from "@/showcase/letters.json";
import type { LettersFixture } from "./letters";

/** What the profile, skill and letter pages need; served by the Gateway or by the showcase. */
export interface CatalogSource {
  readonly showcase: boolean;
  skills(): Promise<SkillManifest[]>;
  profiles(): Promise<ProfileView[]>;
  profile(id: string): Promise<ProfileView>;
  share(id: string, origin: string): Promise<{ code: string; url: string }>;
  importProfile(code: string): Promise<ProfileView>;
  sampleLetters(): Promise<SampleLetter[]>;
  readLetter(body: ReadLetterRequest): Promise<LetterReading>;
  reply(body: ReplyRequest): Promise<ReplyDraft>;
}

/** HTTP errors with the Gateway's own plain `detail` when it gives one. */
export class GatewayError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

async function detailOf(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      const first = body.detail[0] as { msg?: string; loc?: unknown[] } | undefined;
      if (first?.msg) return `${first.msg}${first.loc ? ` (${first.loc.slice(1).join(".")})` : ""}`;
    }
  } catch {
    // plain-text 404s and the like
  }
  return fallback;
}

export class CatalogClient implements CatalogSource {
  readonly showcase = false;

  constructor(
    private readonly config: GatewayConfig = gatewayConfig(),
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.config.url}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.config.token}`, "Content-Type": "application/json", ...init.headers },
    });
    if (!response.ok) {
      const fallback = `${init.method ?? "GET"} ${path}: HTTP ${response.status}`;
      throw new GatewayError(response.status, await detailOf(response, fallback));
    }
    return (await response.json()) as T;
  }

  skills = async () => (await this.call<{ skills: SkillManifest[] }>("/skills")).skills;
  profiles = async () => (await this.call<{ profiles: ProfileView[] }>("/profiles")).profiles;
  profile = (id: string) => this.call<ProfileView>(`/profiles/${encodeURIComponent(id)}`);
  share = (id: string) => this.call<{ code: string; url: string }>(`/profiles/${encodeURIComponent(id)}/share`);
  /** The Gateway validates and echoes; it never stores what is sent (§4.3). */
  importProfile = (code: string) =>
    this.call<ProfileView>("/profiles/import", { method: "POST", body: JSON.stringify({ code }) });
  /** The sample letters are the committed fixtures either way; a Gateway reads new ones. */
  sampleLetters = async (): Promise<SampleLetter[]> => (lettersJson as unknown as LettersFixture).letters;
  readLetter = (body: ReadLetterRequest) =>
    this.call<LetterReading>("/letters/read", { method: "POST", body: JSON.stringify(body) });
  reply = (body: ReplyRequest) => this.call<ReplyDraft>("/letters/reply", { method: "POST", body: JSON.stringify(body) });
}
