#!/usr/bin/env node
// Builds src/showcase/catalog.json from ../../profiles/*.yaml and ../../skills/*/skill.yaml so the
// web's /profiles and /skills never drift from the manifests (SHIPPING.md §4.6).
//
//   pnpm catalog                      rebuild; fails loudly if the YAML is wrong
//   node scripts/build-catalog.mjs --if-present
//                                     prebuild: silently keep the committed JSON when the YAML
//                                     folders aren't in this clone (Vercel) or anything goes wrong
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const repo = resolve(web, "..", "..");
const profilesDir = join(repo, "profiles");
const skillsDir = join(repo, "skills");
const out = join(web, "src", "showcase", "catalog.json");
const ifPresent = process.argv.includes("--if-present");

const ACTIONS = [
  "claim", "call", "accept_cash", "accept_voucher", "discuss_other_accounts", "change_contract",
  "share_personal_data", "escalate",
];

async function main() {
  if (!existsSync(profilesDir) || !existsSync(skillsDir)) {
    if (ifPresent) {
      console.log(`catalog: profiles/ or skills/ not in this clone; keeping ${relative(out)}`);
      return 0;
    }
    throw new Error(`expected ${profilesDir} and ${skillsDir}`);
  }
  const { parse } = await import("yaml");

  const skills = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(skillsDir, d.name, "skill.yaml")))
    .map((d) => {
      const manifest = parse(readFileSync(join(skillsDir, d.name, "skill.yaml"), "utf8"));
      if (manifest.id !== d.name) throw new Error(`skills/${d.name}/skill.yaml: id "${manifest.id}" must equal the folder name`);
      return {
        id: manifest.id,
        name: manifest.name,
        version: String(manifest.version),
        status: manifest.status,
        summary: manifest.summary.trim(),
        jobs: manifest.jobs ?? [],
        needs: manifest.needs ?? [],
        channels: manifest.channels ?? [],
        mission: manifest.mission ?? null,
        operators: manifest.operators ?? [],
        docs: manifest.docs ?? null,
        notes: manifest.notes ?? null,
        maintainers: manifest.maintainers ?? [],
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(skills.map((s) => [s.id, s]));

  const profiles = readdirSync(profilesDir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => {
      const text = readFileSync(join(profilesDir, f), "utf8");
      const p = parse(text);
      const expected = f.replace(/\.yaml$/, "");
      if (p.id !== expected) throw new Error(`profiles/${f}: id "${p.id}" must equal the file name`);
      const both = (p.may ?? []).filter((a) => (p.may_not ?? []).includes(a));
      if (both.length) throw new Error(`profiles/${f}: "${both[0]}" is in both may and may_not`);
      for (const a of [...(p.may ?? []), ...(p.may_not ?? [])]) {
        if (!ACTIONS.includes(a)) throw new Error(`profiles/${f}: unknown capability "${a}"`);
      }
      const refs = (p.skills ?? []).map((id) => {
        const s = byId.get(id);
        if (!s) throw new Error(`profiles/${f}: skill "${id}" has no manifest`);
        const missing = s.needs.find((n) => !(p.may ?? []).includes(n));
        if (missing) throw new Error(`profiles/${f}: skill "${id}" needs "${missing}" but the profile does not allow it`);
        return { id: s.id, name: s.name, status: s.status, jobs: s.jobs };
      });
      return {
        id: p.id,
        name: p.name,
        version: String(p.version),
        status: p.status,
        summary: p.summary.trim(),
        for_whom: p.for_whom.trim(),
        skills: refs,
        jobs: unionJobs(refs),
        may: p.may ?? [],
        may_not: p.may_not ?? [],
        limits: {
          max_gbp_per_claim: String(p.limits.max_gbp_per_claim),
          max_user_questions: Number(p.limits.max_user_questions),
          max_llm_gbp_per_mission: String(p.limits.max_llm_gbp_per_mission),
          mandate_days: Number(p.limits.mandate_days),
        },
        access: p.access,
        channels: p.channels ?? [],
        time_value_gbp_h: String(p.time_value_gbp_h),
        share: p.share,
        yaml: text,
      };
    });

  const catalog = {
    generated_at: new Date().toISOString(),
    source: "profiles/*.yaml and skills/*/skill.yaml, via apps/web/scripts/build-catalog.mjs",
    skills,
    profiles,
  };
  writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`catalog: ${profiles.length} profiles, ${skills.length} skills -> ${relative(out)}`);
  return 0;
}

function unionJobs(skills) {
  const seen = new Set();
  const jobs = [];
  for (const s of skills) for (const job of s.jobs) if (!seen.has(job)) { seen.add(job); jobs.push(job); }
  return jobs;
}

function relative(path) {
  return path.startsWith(web) ? path.slice(web.length + 1) : path;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (ifPresent) {
    console.log(`catalog: ${error instanceof Error ? error.message : error}; keeping the committed JSON`);
    process.exitCode = 0;
  } else {
    console.error(`catalog: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
