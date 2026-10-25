// End-to-end smoke: the Gateway (in memory, replay mode) and a production build of the web app on
// their own ports (8010, 3010), so a demo already running on 8000/3000 is left alone.
import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const TOKEN = "e2e-token";
export const GATEWAY = "http://localhost:8010";
export const WEB = "http://localhost:3010";
const data = mkdtempSync(join(tmpdir(), "tempo-e2e-"));
const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  testDir: ".",
  testIgnore: "live.spec.ts", // the live GPU demo has its own config (playwright.live.config.ts)
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: WEB, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Run from the throwaway data folder, so a developer's .env (and its DATABASE_URL) is never read.
      command: `uv run --project ${root} --no-sync uvicorn tempo_gateway.main:build --factory --port 8010`,
      cwd: data,
      url: `${GATEWAY}/health`,
      env: {
        TEMPO_MODE: "replay", TEMPO_API_TOKEN: TOKEN, WEB_ORIGINS: WEB, PAYMENT_CHECK_AFTER_S: "0",
        CHECKPOINT_DIR: join(data, "checkpoints"), MESH_FILE: join(data, "mesh.json"), TEMPO_HOME: root,
      },
      timeout: 60_000,
    },
    {
      // Vite bakes VITE_* in at build time, so the Gateway's address and token are set on the build.
      command: "npm run build && npx vite preview --port 3010 --strictPort",
      cwd: "../../apps/web",
      url: WEB,
      env: { VITE_GATEWAY_URL: GATEWAY, VITE_TEMPO_TOKEN: TOKEN },
      timeout: 180_000,
    },
  ],
});
