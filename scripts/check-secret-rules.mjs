#!/usr/bin/env node
// Checks that .gitleaks.toml still catches the key shapes Steward cares about.
//
// It makes fresh random keys in each provider's shape (never real ones), writes them into a
// temporary folder as code, JSON, YAML and prose under neutral names, runs `gitleaks dir` on that
// folder with the repository's config, and fails if any of them is missed. Needs gitleaks on PATH.
//
//   node scripts/check-secret-rules.mjs
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ALNUM = `${LETTERS}0123456789`;
const URL_SAFE = `${ALNUM}_-`;
const HEX = "0123456789abcdef";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function random(length, alphabet) {
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** One made-up key per shape. The first five need Steward's own rules; the rest are gitleaks' own. */
const keys = {
  "NVIDIA key": `nvapi-${random(64, URL_SAFE)}`,
  "OpenRouter key": `sk-or-v1-${random(64, HEX)}`,
  "xAI key": `xai-${random(80, ALNUM)}`,
  "Groq key": `gsk_${random(52, ALNUM)}`,
  "Steward phone token": `stw_dev_${random(43, URL_SAFE)}`,
  "Hugging Face token": `hf_${random(34, LETTERS)}`,
  "GitLab token": `glpat-${random(20, URL_SAFE)}`,
  "npm token": `npm_${random(36, ALNUM)}`,
  "GitHub token": `ghp_${random(36, ALNUM)}`,
  "Slack webhook": `https://hooks.slack.com/services/T${random(8, UPPER)}/B${random(10, UPPER)}/${random(24, ALNUM)}`,
};

const probe = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
if (probe.error) {
  console.error("gitleaks is not installed. See https://github.com/gitleaks/gitleaks#installing");
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "steward-secret-rules-"));
try {
  const values = Object.values(keys);
  const fakes = join(dir, "fakes");
  mkdirSync(fakes);
  writeFileSync(join(fakes, "code.ts"), values.map((v, i) => `const value${i} = "${v}";\n`).join(""));
  writeFileSync(
    join(fakes, "data.json"),
    JSON.stringify(Object.fromEntries(values.map((v, i) => [`v${i}`, v]))),
  );
  writeFileSync(join(fakes, "config.yaml"), values.map((v, i) => `item${i}: ${v}\n`).join(""));
  writeFileSync(join(fakes, "notes.md"), values.map((v) => `Use ${v} here.\n`).join(""));

  const report = join(dir, "report.json");
  const run = spawnSync(
    "gitleaks",
    ["dir", "--no-banner", "--config", join(ROOT, ".gitleaks.toml"), "-f", "json", "-r", report, fakes],
    { encoding: "utf8" },
  );
  // gitleaks exits 1 both when it finds leaks and when it cannot run; only a report tells them apart.
  let findings;
  try {
    findings = JSON.parse(readFileSync(report, "utf8"));
  } catch {
    console.error(`gitleaks could not check the folder:\n${run.stderr || run.stdout}`);
    process.exit(1);
  }
  const missed = [];
  for (const [name, value] of Object.entries(keys)) {
    for (const file of ["code.ts", "data.json", "config.yaml", "notes.md"]) {
      const found = findings.some((f) => f.File.endsWith(file) && value.includes(f.Secret));
      if (!found) missed.push(`${name} in ${file}`);
    }
  }
  if (missed.length > 0) {
    console.error(`.gitleaks.toml missed ${missed.length} made-up keys:\n  ${missed.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`.gitleaks.toml caught every made-up key (${Object.keys(keys).length} shapes, 4 file types).`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
