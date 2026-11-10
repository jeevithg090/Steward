import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentsResponse, AppInfo, Decision, PhoneCatalogue, Rule, Skill } from "@steward/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { ServerConfig } from "../src/config.ts";
import { missingPackages } from "./helpers.ts";
import { startTestServer, type TestServer } from "./server.ts";

/**
 * The whole server on the Tempo package, the way `STEWARD_TENANT=tempo pnpm dev` starts it: what the
 * app shows (the brand, the agent, the rules, the skills, the phone shortcuts) comes from
 * tenants/tempo, and a broken package stops start-up naming the file.
 */

const TEMPO = fileURLToPath(new URL("../../../tenants/tempo", import.meta.url));

/** Copies tenants/tempo into the temporary repository, as tenants/tempo, and points the server at it. */
function withTempo(overrides: Partial<ServerConfig>, change?: (dir: string) => void) {
  return ({ root }: { root: string }) => {
    const dir = join(root, "tenants", "tempo");
    mkdirSync(dir, { recursive: true });
    for (const file of readdirSync(TEMPO))
      if (file.endsWith(".yaml")) copyFileSync(join(TEMPO, file), join(dir, file));
    change?.(dir);
    overrides.tenantDir = dir;
  };
}

const missing = await missingPackages();
if (missing.length > 0) it.todo(`the Tempo package (waiting for ${missing.join(", ")})`);

describe.runIf(missing.length === 0)("the server on the Tempo package", () => {
  let t: TestServer;
  const brand = parse(readFileSync(join(TEMPO, "brand.yaml"), "utf8")) as {
    name: string;
    starters: string[];
  };
  const rulesFile = parse(readFileSync(join(TEMPO, "rules.yaml"), "utf8")) as { rules: { name: string }[] };

  beforeAll(async () => {
    const overrides: Partial<ServerConfig> = {};
    t = await startTestServer({ STEWARD_TENANT: "tempo" }, overrides, withTempo(overrides));
  });
  afterAll(async () => {
    await t?.close();
  });

  it("shows Tempo's name, amber accent and starters", async () => {
    const info = await t.api<AppInfo>("/api/info");
    expect(info.status).toBe(200);
    expect(info.body.brand.name).toBe("Tempo");
    expect(info.body.brand.name).toBe(brand.name);
    expect(info.body.brand.accent).toBe("#b45309");
    expect(info.body.starters).toEqual(brand.starters);
    expect(info.body.agents[0]?.id).toBe("tempo");
  });

  it("offers the tempo agent in the picker", async () => {
    const agents = await t.api<AgentsResponse>("/api/agents");
    expect(agents.body.agents.map((a) => a.id)).toContain("tempo");
  });

  it("lists Tempo's rules as coming from the setup, switched on", async () => {
    const rules = await t.api<Rule[]>("/api/rules");
    const fromSetup = rules.body.filter((r) => r.source === "tenant");
    expect(fromSetup.map((r) => r.name).sort()).toEqual(rulesFile.rules.map((r) => r.name).sort());
    expect(fromSetup.every((r) => r.enabled && r.effect === "deny")).toBe(true);
  });

  it("lists Tempo's skills", async () => {
    const skills = await t.api<Skill[]>("/api/skills");
    const names = skills.body.filter((s) => s.source === "tenant").map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["delay-repay-claim", "scam-check", "subscription-audit"]));
  });

  it("refuses to send bank details, by Tempo's rule", async () => {
    const decision = await t.api<Decision>("/api/rules/dry-run", {
      method: "POST",
      json: {
        tool: "mail_send",
        args: { to: ["sam@example.com"], subject: "Refund", body: "Pay it to GB82 WEST 1234 5698 7654 32" },
      },
    });
    expect(decision.status).toBe(200);
    expect(decision.body.effect).toBe("deny");
    expect(decision.body.rule).toMatchObject({ name: "Bank and card numbers never leave", source: "tenant" });
  });

  it("puts Tempo's phone shortcuts in the catalogue", async () => {
    const catalogue = await t.api<PhoneCatalogue>("/api/phone/catalogue");
    const ids = catalogue.body.entries.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["tenant:delay-spotter", "tenant:scam-spotter"]));
  });
});

describe.runIf(missing.length === 0)("a broken tenant package", () => {
  // The server never starts, so nothing else removes its temporary folder.
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  async function startError(change: (dir: string) => void): Promise<Error> {
    const overrides: Partial<ServerConfig> = {};
    const prepare = withTempo(overrides, change);
    const started = startTestServer({ STEWARD_TENANT: "tempo" }, overrides, (repo) => {
      roots.push(repo.root);
      prepare(repo);
    });
    const error = await started.then(
      async (t) => {
        await t.close();
        return undefined;
      },
      (err: unknown) => err as Error,
    );
    expect(error, "the server started").toBeDefined();
    return error!;
  }

  it("does not start with a rule that does not compile, naming the file, the line and the rule", async () => {
    const error = await startError((dir) =>
      writeFileSync(
        join(dir, "rules.yaml"),
        "rules:\n  - name: Bad\n    effect: deny\n    when: 'tool.kind = \"pay\"'\n",
      ),
    );
    expect(error.name).toBe("ConfigError");
    expect(error.message).toMatch(
      /^Couldn't load the tenant package "tempo" from tenants\/tempo: rules\.yaml line 4: rules\[0\] "Bad": /,
    );
    expect(error.message).not.toMatch(/cannot be used.*cannot be used/);
  });

  it("does not start with an allow rule that would let it send unasked", async () => {
    const error = await startError((dir) =>
      writeFileSync(
        join(dir, "rules.yaml"),
        "rules:\n  - name: Everything\n    effect: allow\n    when: 'true'\n",
      ),
    );
    expect(error.name).toBe("ConfigError");
    expect(error.message).toMatch(
      /rules\.yaml line 3: rules\[0\] "Everything": an allow rule cannot let Steward send/,
    );
  });

  it("does not start with a phone shortcut that names a skill the package does not have", async () => {
    const error = await startError((dir) => {
      const file = join(dir, "shortcuts.yaml");
      writeFileSync(file, readFileSync(file, "utf8").replace("skill: scam-check", "skill: scam-chek"));
    });
    expect(error.name).toBe("ConfigError");
    expect(error.message).toMatch(
      /^Couldn't load the tenant package "tempo" from tenants\/tempo: shortcuts\.yaml line \d+: shortcuts\[1\]\.skill: no skill named "scam-chek" \(skills\.yaml has: /,
    );
  });
});
