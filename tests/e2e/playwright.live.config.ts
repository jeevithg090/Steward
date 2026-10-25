// The live GPU demo's browser checks (plan.md §13, docs/gpu-demo.md): the real Vercel site, the
// real Gateway behind its tunnel, our own model on the RunPod GPU. No local servers are started.
// `make live-test` runs it after the Gateway suite; the site and tunnel come from
// ../../../.tempo-live/live.json, written by scripts/live_demo.sh (or LIVE_SITE / LIVE_TUNNEL).
import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const runFile = fileURLToPath(new URL("../../../.tempo-live/live.json", import.meta.url));
const run: { site?: string; tunnel?: string } = existsSync(runFile) ? JSON.parse(readFileSync(runFile, "utf8")) : {};
export const SITE = process.env.LIVE_SITE ?? run.site ?? "";
export const TUNNEL = process.env.LIVE_TUNNEL ?? run.tunnel ?? "";

export default defineConfig({
  testDir: ".",
  testMatch: "live.spec.ts",
  timeout: 300_000, // a cold Serverless GPU loads the model before its first answer
  expect: { timeout: 120_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: SITE, trace: "retain-on-failure", viewport: { width: 1280, height: 860 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } }],
});
