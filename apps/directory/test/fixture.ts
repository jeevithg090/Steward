import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex, writeBotFolder } from "@steward/bots";
import type { BotPack } from "@steward/shared";
import { stringify as stringifyYaml } from "yaml";
import { createDirectoryApp, type DirectoryDeps, type DirectoryServer, SESSION_COOKIE } from "../src/app.ts";
import { type DirectoryConfig, loadConfig } from "../src/config.ts";
import { GitHub } from "../src/github.ts";

export const SITE = "https://bots.example.org";

export function pack(id: string, extra: Partial<BotPack> = {}): BotPack {
  return {
    id,
    name: id,
    pitch: "A bot.",
    category: "misc",
    version: 1,
    author: { kind: "person", handle: "sam" },
    licence: "MIT",
    needs: { tools: ["web_search"], connectors: [], model: "any" },
    instructions: "Help the person with one job. Say what you could not check.",
    starters: [],
    examples: [],
    skills: [],
    rules: [],
    routines: [],
    shortcuts: [],
    readme: "",
    ...extra,
  };
}

/** Five bots chosen so the search tests can tell name, pitch, starters and README matches apart. */
export const SEED: BotPack[] = [
  pack("rent-scout", {
    name: "Rent Scout",
    pitch: "Finds rentals in your budget and flags scams.",
    category: "home",
    starters: ["Find two-bed flats near Oxford."],
    needs: { tools: ["web_search", "browser_navigate", "browser_snapshot"], connectors: [], model: "any" },
    rules: [
      { name: "Never pay", effect: "deny", when: 'tool.kind == "pay"', description: "Deposits are yours." },
    ],
    skills: [
      {
        name: "find-rentals",
        description: "Search rental sites.",
        body: "Search two sites. Put the results in a table.",
        allowedTools: ["web_search"],
      },
    ],
    readme:
      "# Rent Scout\n\nFinds rentals and reads the **small print**.\n\n<img src=x onerror=alert(1)>\n\n[Bad link](javascript:alert(1)) and [good link](https://example.org/rent).",
  }),
  pack("lease-reader", {
    name: "Lease Reader",
    pitch: "Reads a tenancy agreement and lists what you would be signing up to.",
    category: "home",
    readme: "# Lease Reader\n\nUseful before you pay the first month's rent.",
  }),
  pack("meal-planner", {
    name: "Meal Planner",
    pitch: "Plans a week of dinners and writes the shopping list.",
    category: "food",
    author: { kind: "ai", model: "test/model", generated: "2026-10-28" },
    starters: ["Plan dinners for a family of four."],
  }),
  pack("inbox-zero", {
    name: "Inbox Zero",
    pitch: "Sorts your mail into what needs you today and what can wait.",
    category: "productivity",
    needs: { tools: ["mail_list", "mail_read"], connectors: ["mail"], model: "any" },
  }),
  pack("budget-buddy", {
    name: "Budget Buddy",
    pitch: "Adds up where the money went this month.",
    category: "money",
    starters: ["How much did I spend on takeaway?"],
  }),
];

// biome-ignore lint/suspicious/noExplicitAny: tests read whatever JSON a route answered.
type AnyJson = any;

export interface Fixture {
  root: string;
  dir: string;
  server: DirectoryServer;
  config: DirectoryConfig;
  github: FakeGitHub;
  /** A request through the app in process, with JSON and a session cookie when asked. */
  request(
    path: string,
    init?: RequestInit & { json?: unknown; session?: string; ip?: string },
  ): Promise<{ status: number; body: AnyJson; text: string; headers: Headers }>;
  signIn(login: string, githubId: number): string;
  close(): Promise<void>;
}

/**
 * A pretend GitHub: OAuth, `/user`, the contents API over in-memory repositories, gists and raw
 * files. It records every URL it was asked for, so tests can check nothing else was reached.
 */
export class FakeGitHub {
  repos = new Map<string, Record<string, string>>();
  gists = new Map<string, { owner: string; files: Record<string, string> }>();
  users = new Map<string, { id: number; login: string; name?: string }>();
  seen: string[] = [];

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    this.seen.push(url.href);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.host === "github.com" && url.pathname === "/login/oauth/access_token") {
      const body = new URLSearchParams(String(init?.body ?? ""));
      const code = body.get("code") ?? "";
      return this.users.has(code)
        ? json({ access_token: `token-for-${code}`, token_type: "bearer" })
        : json({ error: "bad_verification_code" });
    }
    if (url.host === "api.github.com" && url.pathname === "/user") {
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      const code = auth.replace(/^Bearer token-for-/, "");
      const user = this.users.get(code);
      return user
        ? json({
            ...user,
            html_url: `https://github.com/${user.login}`,
            avatar_url: "https://avatars.example/1",
          })
        : json({}, 401);
    }
    const contents = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/?(.*)$/);
    if (url.host === "api.github.com" && contents) {
      const [, owner, repo, rawPath] = contents;
      const files = this.repos.get(`${owner}/${repo}`);
      if (!files) return json({ message: "Not Found" }, 404);
      const path = decodeURIComponent(rawPath ?? "").replace(/\/+$/, "");
      const prefix = path ? `${path}/` : "";
      const children = new Map<string, "file" | "dir">();
      for (const file of Object.keys(files)) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        const [head, ...tail] = rest.split("/");
        if (head) children.set(head, tail.length ? "dir" : "file");
      }
      if (children.size === 0) return json({ message: "Not Found" }, 404);
      return json(
        [...children].map(([name, type]) => ({
          name,
          path: `${prefix}${name}`,
          type,
          size: type === "file" ? (files[`${prefix}${name}`] ?? "").length : 0,
          download_url:
            type === "file"
              ? `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${prefix}${name}`
              : null,
        })),
      );
    }
    const raw = url.pathname.match(/^\/([^/]+)\/([^/]+)\/HEAD\/(.+)$/);
    if (url.host === "raw.githubusercontent.com" && raw) {
      const text = this.repos.get(`${raw[1]}/${raw[2]}`)?.[raw[3] ?? ""];
      return text === undefined ? new Response("404", { status: 404 }) : new Response(text);
    }
    const gist = url.pathname.match(/^\/gists\/([0-9a-f]+)$/);
    if (url.host === "api.github.com" && gist) {
      const g = this.gists.get(gist[1] ?? "");
      if (!g) return json({ message: "Not Found" }, 404);
      return json({
        owner: { login: g.owner },
        files: Object.fromEntries(
          Object.entries(g.files).map(([filename, content]) => [
            filename,
            {
              filename,
              size: content.length,
              truncated: false,
              content,
              raw_url: `https://gist.githubusercontent.com/x/${filename}`,
            },
          ]),
        ),
      });
    }
    return new Response("not in the fake", { status: 599 });
  };

  /** A pack as repository files, the way a person would lay it out. */
  addRepo(owner: string, repo: string, p: BotPack | Record<string, unknown>, folder = ""): void {
    const prefix = folder ? `${folder}/` : "";
    const { readme, skills, hash: _hash, ...rest } = p as BotPack;
    const doc: Record<string, unknown> = { ...rest };
    if (Array.isArray(skills) && skills.length) doc.skills = skills.map((s) => s.name);
    const files: Record<string, string> = { [`${prefix}bot.yaml`]: stringifyYaml(doc) };
    if (readme) files[`${prefix}README.md`] = `${readme}\n`;
    for (const skill of Array.isArray(skills) ? skills : []) {
      files[`${prefix}skills/${skill.name}/SKILL.md`] =
        `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.body}\n`;
    }
    this.repos.set(`${owner}/${repo}`, { ...(this.repos.get(`${owner}/${repo}`) ?? {}), ...files });
  }
}

export async function makeFixture(
  opts: { config?: Partial<DirectoryConfig>; deps?: DirectoryDeps; seed?: BotPack[] } = {},
): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "steward-directory-"));
  const dir = join(root, "directory");
  for (const p of opts.seed ?? SEED) await writeBotFolder(join(dir, "bots", p.id), p);
  const warn = console.warn;
  console.warn = () => {};
  try {
    await buildIndex(dir, { name: "Test bots", site: SITE });
  } finally {
    console.warn = warn;
  }
  const github = new FakeGitHub();
  const config = loadConfig(
    {},
    {
      repoRoot: root,
      dataDir: join(root, "data"),
      dbPath: ":memory:",
      directoryDir: dir,
      siteUrl: SITE,
      appUrl: "http://localhost:5173",
      name: "Test bots",
      github: { clientId: "client-id-for-tests", clientSecret: "client-secret-for-tests" },
      adminLogins: ["rev"],
      trustProxy: true,
      ...opts.config,
    },
  );
  const server = await createDirectoryApp(config, {
    github: new GitHub(config.github, { fetch: github.fetch }),
    limits: { perMinute: 10_000, writesPerHour: 1_000 },
    ...opts.deps,
  });
  return {
    root,
    dir,
    server,
    config,
    github,
    async request(path, init = {}) {
      const { json, session, ip, headers, ...rest } = init;
      const h = new Headers(headers);
      if (json !== undefined) h.set("content-type", "application/json");
      if (session) h.set("cookie", `${SESSION_COOKIE}=${session}`);
      h.set("x-forwarded-for", ip ?? "203.0.113.1");
      const response = await server.app.request(`${SITE}${path}`, {
        ...rest,
        headers: h,
        ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
      });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // HTML or text.
      }
      return { status: response.status, body, text, headers: response.headers };
    },
    signIn(login, githubId) {
      return server.store.createSession({ githubId, login, url: `https://github.com/${login}` }).id;
    },
    async close() {
      await server.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
