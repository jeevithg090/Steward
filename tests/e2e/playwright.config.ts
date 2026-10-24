// End-to-end: the Gateway (in memory, replay mode) and a production build of Mission Control on
// their own ports, so a demo already running on 8000/3000 is left alone.
import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TOKEN = "e2e-token";
export const GATEWAY = "http://localhost:8010";
export const WEB = "http://localhost:3010";
const data = mkdtempSync(join(tmpdir(), "tempo-e2e-"));

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: WEB, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "uv run --no-sync uvicorn tempo_gateway.main:build --factory --port 8010",
      cwd: "../..",
      url: `${GATEWAY}/health`,
      env: {
        TEMPO_MODE: "replay", TEMPO_API_TOKEN: TOKEN, WEB_ORIGINS: WEB, PAYMENT_CHECK_AFTER_S: "0",
        CHECKPOINT_DIR: join(data, "checkpoints"), MESH_FILE: join(data, "mesh.json"), DATABASE_URL: "",
      },
      timeout: 60_000,
    },
    {
      command: "pnpm build && pnpm start -p 3010",
      cwd: "../../apps/web",
      url: WEB,
      env: { NEXT_PUBLIC_GATEWAY_URL: GATEWAY, NEXT_PUBLIC_TEMPO_TOKEN: TOKEN, NEXT_TELEMETRY_DISABLED: "1" },
      timeout: 180_000,
    },
  ],
});
