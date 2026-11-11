// bootstrap.ts fixes the environment for the CopilotKit runtime before it loads (blank base URLs,
// telemetry off). Reading `.env` can wait until `main`: the runtime reads model settings lazily.
import { createApp, type StewardServer } from "./bootstrap.ts";
import { ConfigError, loadConfig, REPO_ROOT, startupWarnings } from "./config.ts";
import { guardProcess } from "./crash.ts";
import { loadEnvFiles, normaliseEnv } from "./env.ts";

export type { Listening, StewardServer } from "./bootstrap.ts";
export { createApp, LOCAL_ACTOR } from "./bootstrap.ts";
export type { ServerConfig } from "./config.ts";
export { loadConfig } from "./config.ts";

async function main(): Promise<void> {
  // Every script reads `.env` here and nowhere else (Node's --env-file would let a blank key in
  // `.env` hide STEWARD_ENV_FILE's). Values already set win; then blank base URLs go again.
  const loadedEnvFiles = loadEnvFiles(REPO_ROOT, process.env);
  normaliseEnv(process.env);

  let server: StewardServer | undefined;
  let stopping = false;
  /** Closes Steward cleanly, then exits: 0 for a signal, 1 after an error. A second call exits now. */
  const stop = (why: string) => {
    if (stopping) {
      console.error("Stopping now.");
      process.exit(1);
    }
    stopping = true;
    const code = why === "error" ? 1 : 0;
    if (!server) process.exit(code);
    console.log(`\n${why === "error" ? "After that error" : why}: closing Steward…`);
    server
      .close()
      .then(() => process.exit(code))
      .catch((err: unknown) => {
        console.error("Steward did not close cleanly:", err instanceof Error ? err.message : err);
        process.exit(1);
      });
  };
  guardProcess(process, stop);

  try {
    const config = loadConfig(process.env);
    server = await createApp(config);
    const { url, deviceUrl } = await server.listen();
    const model = server.services.models.info;
    const mail = server.services.mail();
    console.log(`Steward is ready at ${url}`);
    console.log(`  data      ${config.dataDir}`);
    console.log(`  tenant    ${config.tenantId}`);
    console.log(
      `  model     ${model.provider} · ${model.model}${model.scripted ? " (scripted demo model)" : ""}${
        model.problem === "no_key" ? " (no key: add one in .env)" : model.problem ? " (could not start)" : ""
      }`,
    );
    console.log(
      `  mail      ${mail ? `${mail.label}${mail.isDemo ? " (made-up mail)" : ""}` : "not connected"}`,
    );
    if (server.servesWebApp) console.log("  web app   served from apps/web/dist");
    console.log(
      `  phones    ${deviceUrl ? `${deviceUrl}/device/ (tunnel this port, never ${config.port})` : "off"}`,
    );
    if (loadedEnvFiles.length > 0) console.log(`  env       ${loadedEnvFiles.join(", ")}`);
    for (const warning of startupWarnings(config)) console.warn(`\n  ${warning}`);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Steward could not start: ${err.message}`);
    } else {
      console.error("Steward could not start:", err);
    }
    process.exit(1);
  }

  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

// Run only when started as a program, not when imported (tests import createApp from bootstrap).
if (import.meta.main) void main();
