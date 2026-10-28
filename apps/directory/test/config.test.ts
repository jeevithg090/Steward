import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, describeConfig, loadConfig, publicInfo, REPO_ROOT } from "../src/config.ts";
import { parseEnv } from "../src/env.ts";
import { renderMarkdown, safeHref } from "../src/html.ts";
import { RateLimiter } from "../src/rate-limit.ts";
import { makeFixture } from "./fixture.ts";

const SECRET = "Zx9-very-secret-client-value-42";
const TOKEN = "Qp7-server-side-read-token-99";

const ENV = {
  GITHUB_CLIENT_ID: "Iv1.abcdef",
  GITHUB_CLIENT_SECRET: SECRET,
  DIRECTORY_GITHUB_TOKEN: TOKEN,
  ADMIN_GITHUB_LOGINS: "Quill-Reviewer, @second-quill",
  DIRECTORY_SITE_URL: "https://bots.example.org/",
};

describe("config", () => {
  it("reads the environment with plain defaults", () => {
    const config = loadConfig({}, { repoRoot: "/srv/steward" });
    expect(config.port).toBe(8790);
    expect(config.host).toBe("127.0.0.1");
    expect(config.directoryDir).toBe("/srv/steward/directory");
    expect(config.dbPath).toBe("/srv/steward/.steward-data/directory/directory.db");
    expect(config.siteUrl).toBe("http://127.0.0.1:8790");
    expect(config.github).toBeUndefined();
    const full = loadConfig(ENV, { repoRoot: "/srv/steward" });
    expect(full.siteUrl).toBe("https://bots.example.org");
    expect(full.adminLogins).toEqual(["quill-reviewer", "second-quill"]);
    expect(full.github).toEqual({ clientId: "Iv1.abcdef", clientSecret: SECRET, token: TOKEN });
  });

  it("refuses half a GitHub app, a bad port, and plain http in production", () => {
    expect(() => loadConfig({ GITHUB_CLIENT_ID: "x" })).toThrow(ConfigError);
    expect(() => loadConfig({ DIRECTORY_PORT: "eighty" })).toThrow(ConfigError);
    expect(() =>
      loadConfig({ NODE_ENV: "production", DIRECTORY_SITE_URL: "http://bots.example.org" }),
    ).toThrow(/https/);
    expect(() => loadConfig({ DIRECTORY_SITE_URL: "https://bots.example.org/?x=1" })).toThrow(ConfigError);
  });

  it("parses .env lines: comments, quotes, export, and blank values", () => {
    expect(parseEnv('# c\nA=1\nexport B="two words"\nC=\nD=x # note\n=bad\n')).toEqual([
      ["A", "1"],
      ["B", "two words"],
      ["C", ""],
      ["D", "x"],
    ]);
  });
});

describe("no plaintext secrets", () => {
  it("never shows the client secret or the token in the startup lines or the public info", () => {
    const config = loadConfig(ENV, { repoRoot: "/srv/steward" });
    const shown = JSON.stringify([describeConfig(config), publicInfo(config)]);
    expect(shown).not.toContain(SECRET);
    expect(shown).not.toContain(TOKEN);
    expect(shown).not.toContain("Iv1.abcdef");
    expect(shown.toLowerCase()).not.toContain("quill");
  });

  it("never sends them in any response", async () => {
    const f = await makeFixture({
      config: {
        github: { clientId: "Iv1.abcdef", clientSecret: SECRET, token: TOKEN },
        adminLogins: ["rev"],
      },
    });
    try {
      for (const path of [
        "/api/info",
        "/",
        "/submit",
        "/privacy",
        "/llms.txt",
        "/index.json",
        "/bots/rent-scout",
        "/nope",
      ]) {
        const res = await f.request(path);
        expect(res.text, path).not.toContain(SECRET);
        expect(res.text, path).not.toContain(TOKEN);
      }
      const start = await f.request("/auth/github");
      expect(start.headers.get("location") ?? "").not.toContain(SECRET);
    } finally {
      await f.close();
    }
  });

  it("finds no credential in the code, the Dockerfile or the docs a host deploys with", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "test") continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else files.push(path);
      }
    };
    walk(join(REPO_ROOT, "apps/directory"));
    files.push(join(REPO_ROOT, "docs/directory.md"), join(REPO_ROOT, ".dockerignore"));
    const patterns: [string, RegExp][] = [
      ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
      ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{20,}/],
      ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ["OpenAI-style key", /\bsk-[A-Za-z0-9]{20,}/],
      ["NVIDIA key", /\bnvapi-[A-Za-z0-9_-]{20,}/],
      ["AWS key id", /\bAKIA[0-9A-Z]{16}\b/],
      [
        "a secret written into a setting",
        /\b(?:SECRET|TOKEN|PASSWORD|API_KEY)\s*[=:]\s*["']?(?!["'\s]|<|\$|\.\.\.|…|your|change|set|example|placeholder)[A-Za-z0-9/+_.-]{12,}/,
      ],
    ];
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const [what, pattern] of patterns) {
        expect(pattern.test(text), `${what} in ${relative(REPO_ROOT, file)}`).toBe(false);
      }
    }
    const docker = readFileSync(join(REPO_ROOT, "apps/directory/Dockerfile"), "utf8");
    expect(docker).not.toMatch(/^\s*(?:ENV|ARG)\s+\S*(?:SECRET|TOKEN)/m);
  });
});

describe("listing text is escaped", () => {
  it("renders Markdown without raw HTML or script links", () => {
    const html = renderMarkdown(
      "# Title\n\n<script>alert(1)</script>\n\n**bold** and *it* and `code`\n\n- [ok](https://example.org) [bad](javascript:alert(1)) [data](data:text/html,x)\n\n![img](https://x/y.png)\n\n```\n<b>raw</b>\n```",
    );
    expect(html).toContain("<h2>Title</h2>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>it</em>");
    expect(html).toContain('<a href="https://example.org/" rel="nofollow noopener ugc">ok</a>');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain('href="data:');
    expect(html).not.toContain("<img");
    expect(html).toContain("<pre><code>&lt;b&gt;raw&lt;/b&gt;</code></pre>");
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
  });
});

describe("rate limiter", () => {
  it("allows the limit, refuses the next, and forgets an address when its window ends", () => {
    let now = 0;
    const limiter = new RateLimiter({ limit: 2, windowMs: 1000, now: () => now });
    expect(limiter.hit("a").ok).toBe(true);
    expect(limiter.hit("a").ok).toBe(true);
    const refused = limiter.hit("a");
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterSec).toBe(1);
    expect(limiter.hit("b").ok).toBe(true);
    now = 1500;
    expect(limiter.hit("a").ok).toBe(true);
    now = 5000;
    limiter.sweep();
    expect(limiter.size).toBe(0);
  });
});
