/**
 * GitHub, for two things: signing people in (read-only, the public profile only, no token kept) and
 * reading a bot pack out of a public repository folder or gist that a person submits. The `fetch`
 * is injectable so tests never reach the network. Only `api.github.com`, `github.com` and GitHub's
 * raw-content hosts are ever contacted, each by a URL this module builds.
 */
export class GitHubError extends Error {
  override name = "GitHubError";
  constructor(
    message: string,
    readonly status: 400 | 404 | 422 | 502 | 503 = 502,
  ) {
    super(message);
  }
}

export interface GitHubUser {
  githubId: number;
  login: string;
  name?: string;
  avatarUrl?: string;
  /** The profile page. */
  url: string;
}

export type PackSource =
  | { kind: "repo"; owner: string; repo: string; ref?: string; path: string; url: string }
  | { kind: "gist"; id: string; url: string };

export interface FetchedPack {
  /** Path inside the pack folder (`bot.yaml`, `README.md`, `skills/<name>/SKILL.md`) → text. */
  files: Map<string, string>;
  /** The GitHub login that owns the repository or gist. */
  owner: string;
  source: PackSource;
}

export interface GitHubOptions {
  fetch?: typeof fetch;
  /** A server-side token, only to raise GitHub's rate limit for reading public packs. */
  token?: string;
  apiBase?: string;
  webBase?: string;
}

export const PACK_URL_HELP =
  "Paste the address of a public GitHub repository folder or gist that holds bot.yaml, such as https://github.com/you/your-bot or https://gist.github.com/you/abc123.";

/** Files a pack may hold: no bigger than this, and no more than `MAX_FILES` of them. */
export const MAX_FILE_BYTES = 200_000;
export const MAX_FILES = 40;

const SKILL_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const RAW_HOSTS = new Set(["raw.githubusercontent.com", "gist.githubusercontent.com"]);

/** Reads a repository or gist address. Anything else is refused with `PACK_URL_HELP`. */
export function parsePackUrl(raw: string): PackSource {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new GitHubError(PACK_URL_HELP, 400);
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new GitHubError(PACK_URL_HELP, 400);
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (host === "github.com" || host === "www.github.com") {
    const [owner, repoRaw, mode, ref, ...rest] = parts;
    if (!owner || !repoRaw) throw new GitHubError(PACK_URL_HELP, 400);
    const repo = repoRaw.replace(/\.git$/, "");
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw new GitHubError(PACK_URL_HELP, 400);
    if (mode && mode !== "tree" && mode !== "blob") throw new GitHubError(PACK_URL_HELP, 400);
    const path = rest.filter((p) => p !== "." && p !== "..").join("/");
    return {
      kind: "repo",
      owner,
      repo,
      ...(mode && ref ? { ref } : {}),
      path: path.endsWith("/bot.yaml") ? path.slice(0, -"/bot.yaml".length) : path === "bot.yaml" ? "" : path,
      url: url.toString(),
    };
  }
  if (host === "gist.github.com") {
    const id = parts[parts.length - 1];
    if (!id || !/^[0-9a-f]{6,64}$/i.test(id)) throw new GitHubError(PACK_URL_HELP, 400);
    return { kind: "gist", id, url: url.toString() };
  }
  throw new GitHubError(PACK_URL_HELP, 400);
}

interface ContentsEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
  download_url: string | null;
}

interface GistFile {
  filename: string;
  size: number;
  truncated: boolean;
  content?: string;
  raw_url: string;
}

/** `name:` from a SKILL.md's frontmatter, for a gist whose file is just `SKILL.md`. */
function skillNameOf(text: string, fallback: string): string {
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const name = front?.[1]?.match(/^name:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1]?.trim();
  return name ?? fallback;
}

export class GitHub {
  private readonly fetchFn: typeof fetch;
  private readonly api: string;
  private readonly web: string;
  private readonly token?: string;

  constructor(
    private readonly oauth: { clientId: string; clientSecret: string } | undefined,
    opts: GitHubOptions = {},
  ) {
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.api = (opts.apiBase ?? "https://api.github.com").replace(/\/+$/, "");
    this.web = (opts.webBase ?? "https://github.com").replace(/\/+$/, "");
    if (opts.token) this.token = opts.token;
  }

  get signInEnabled(): boolean {
    return this.oauth !== undefined;
  }

  // ── Sign-in ──────────────────────────────────────────────────────────────────────────────────

  /** No scope: GitHub then shares only the public profile, which is all the directory needs. */
  authorizeUrl(state: string, redirectUri: string): string {
    if (!this.oauth) throw new GitHubError("GitHub sign-in is not set up on this directory.", 400);
    const url = new URL(`${this.web}/login/oauth/authorize`);
    url.searchParams.set("client_id", this.oauth.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", "");
    url.searchParams.set("allow_signup", "false");
    return url.toString();
  }

  /** The code from the callback → an access token, used once to read the profile and then dropped. */
  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    if (!this.oauth) throw new GitHubError("GitHub sign-in is not set up on this directory.", 400);
    const body = new URLSearchParams({
      client_id: this.oauth.clientId,
      client_secret: this.oauth.clientSecret,
      code,
      redirect_uri: redirectUri,
    });
    const response = await this.fetchFn(`${this.web}/login/oauth/access_token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string };
    if (!response.ok || !data.access_token) {
      throw new GitHubError("GitHub did not accept the sign-in. Try again.", 502);
    }
    return data.access_token;
  }

  async user(token: string): Promise<GitHubUser> {
    const response = await this.fetchFn(`${this.api}/user`, {
      headers: { ...this.headers(), authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new GitHubError("GitHub did not share the profile. Try signing in again.", 502);
    const data = (await response.json()) as {
      id: number;
      login: string;
      name?: string | null;
      avatar_url?: string;
      html_url?: string;
    };
    if (typeof data.id !== "number" || typeof data.login !== "string") {
      throw new GitHubError("GitHub's answer could not be read.", 502);
    }
    return {
      githubId: data.id,
      login: data.login,
      ...(data.name ? { name: data.name } : {}),
      ...(data.avatar_url ? { avatarUrl: data.avatar_url } : {}),
      url: data.html_url ?? `${this.web}/${data.login}`,
    };
  }

  // ── Reading a pack ───────────────────────────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      "user-agent": "steward-directory",
      "x-github-api-version": "2022-11-28",
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
    };
  }

  private async apiJson<T>(path: string, what: string): Promise<T> {
    const response = await this.fetchFn(`${this.api}${path}`, { headers: this.headers() });
    if (response.status === 404) {
      throw new GitHubError(`GitHub could not find ${what}. Is it public, and is the address right?`, 404);
    }
    if (response.status === 403 || response.status === 429) {
      throw new GitHubError("GitHub's rate limit for this directory was reached. Try again in an hour.", 503);
    }
    if (!response.ok) throw new GitHubError(`GitHub answered ${response.status} for ${what}.`, 502);
    return (await response.json()) as T;
  }

  private async rawText(url: string, what: string): Promise<string> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new GitHubError(`GitHub gave an address for ${what} that could not be read.`, 502);
    }
    if (parsed.protocol !== "https:" || !RAW_HOSTS.has(parsed.hostname.toLowerCase())) {
      throw new GitHubError(
        `GitHub gave an address for ${what} outside its own hosts, so it was not read.`,
        502,
      );
    }
    const response = await this.fetchFn(parsed.toString(), {
      headers: { "user-agent": "steward-directory" },
    });
    if (!response.ok) throw new GitHubError(`GitHub answered ${response.status} for ${what}.`, 502);
    const text = await response.text();
    if (text.length > MAX_FILE_BYTES)
      throw new GitHubError(`${what} is over ${MAX_FILE_BYTES / 1000} KB.`, 422);
    return text;
  }

  async fetchPack(source: PackSource): Promise<FetchedPack> {
    return source.kind === "repo" ? this.fetchRepoPack(source) : this.fetchGistPack(source);
  }

  private async listDir(
    source: PackSource & { kind: "repo" },
    path: string,
    what: string,
  ): Promise<ContentsEntry[]> {
    const ref = source.ref ? `?ref=${encodeURIComponent(source.ref)}` : "";
    const encoded = path
      .split("/")
      .filter(Boolean)
      .map((p) => encodeURIComponent(p))
      .join("/");
    const data = await this.apiJson<ContentsEntry[] | ContentsEntry>(
      `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/contents/${encoded}${ref}`,
      what,
    );
    if (!Array.isArray(data))
      throw new GitHubError(`${what} is a file, and a pack is a folder with bot.yaml in it.`, 422);
    return data;
  }

  private async fetchRepoPack(source: PackSource & { kind: "repo" }): Promise<FetchedPack> {
    const where = `${source.owner}/${source.repo}${source.path ? `/${source.path}` : ""}`;
    const entries = await this.listDir(source, source.path, `the folder ${where}`);
    const files = new Map<string, string>();
    const file = (entry: ContentsEntry | undefined, path: string): Promise<void> | undefined => {
      if (entry?.type !== "file" || !entry.download_url) return undefined;
      if (entry.size > MAX_FILE_BYTES)
        throw new GitHubError(`${path} is over ${MAX_FILE_BYTES / 1000} KB.`, 422);
      return this.rawText(entry.download_url, path).then((text) => {
        files.set(path, text);
      });
    };
    const botYaml = entries.find((e) => e.name === "bot.yaml");
    if (botYaml?.type !== "file") {
      throw new GitHubError(`There is no bot.yaml in ${where}. Point at the folder that holds it.`, 422);
    }
    await file(botYaml, "bot.yaml");
    await file(
      entries.find((e) => e.name === "README.md"),
      "README.md",
    );
    const skillsDir = entries.find((e) => e.name === "skills" && e.type === "dir");
    if (skillsDir) {
      const skillFolders = (await this.listDir(source, skillsDir.path, `${where}/skills`)).filter(
        (e) => e.type === "dir",
      );
      if (skillFolders.length > MAX_FILES)
        throw new GitHubError(`A pack may hold at most ${MAX_FILES} files.`, 422);
      for (const folder of skillFolders) {
        if (!SKILL_NAME.test(folder.name)) {
          throw new GitHubError(
            `skills/${folder.name}: a skill folder is named in lowercase letters, digits and hyphens.`,
            422,
          );
        }
        const inside = await this.listDir(source, folder.path, `${where}/skills/${folder.name}`);
        await file(
          inside.find((e) => e.name === "SKILL.md"),
          `skills/${folder.name}/SKILL.md`,
        );
      }
    }
    return { files, owner: source.owner, source };
  }

  private async fetchGistPack(source: PackSource & { kind: "gist" }): Promise<FetchedPack> {
    const gist = await this.apiJson<{ owner?: { login?: string }; files: Record<string, GistFile> }>(
      `/gists/${encodeURIComponent(source.id)}`,
      "that gist",
    );
    const files = new Map<string, string>();
    const entries = Object.values(gist.files ?? {});
    if (entries.length > MAX_FILES) throw new GitHubError(`A pack may hold at most ${MAX_FILES} files.`, 422);
    for (const entry of entries) {
      const name = entry.filename;
      let path: string | undefined;
      if (name === "bot.yaml" || name === "README.md") path = name;
      else if (name === "SKILL.md" || name.endsWith(".SKILL.md")) path = name;
      if (!path) continue;
      if (entry.size > MAX_FILE_BYTES)
        throw new GitHubError(`${name} is over ${MAX_FILE_BYTES / 1000} KB.`, 422);
      const text =
        entry.truncated || entry.content === undefined
          ? await this.rawText(entry.raw_url, name)
          : entry.content;
      if (path === "SKILL.md" || path.endsWith(".SKILL.md")) {
        const stem = path === "SKILL.md" ? "" : path.slice(0, -".SKILL.md".length);
        const skillName = stem || skillNameOf(text, "");
        if (!SKILL_NAME.test(skillName)) {
          throw new GitHubError(
            `${name}: name a gist skill file <skill-name>.SKILL.md, in lowercase letters, digits and hyphens.`,
            422,
          );
        }
        path = `skills/${skillName}/SKILL.md`;
      }
      files.set(path, text);
    }
    if (!files.has("bot.yaml")) throw new GitHubError("There is no bot.yaml in that gist.", 422);
    return { files, owner: gist.owner?.login ?? "", source };
  }
}
