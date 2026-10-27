// bootstrap.ts fixes the environment for the CopilotKit runtime before it loads (blank base URLs,
// telemetry off). Reading `.env` can wait until `main`: the runtime reads model settings lazily.
import { createApp, type StewardServer } from "./bootstrap.ts";
import { ConfigError, isLoopbackHost, loadConfig, REPO_ROOT } from "./config.ts";
import { loadEnvFiles, normaliseEnv } from "./env.ts";

export type { Listening, StewardServer } from "./bootstrap.ts";
export { createApp, LOCAL_ACTOR } from "./bootstrap.ts";
export type { ServerConfig } from "./config.ts";
export { loadConfig } from "./config.ts";

async function main(): Promise<void> {
  // Values already in the environment win over the files; then blank base URLs go again.
  const loadedEnvFiles = loadEnvFiles(REPO_ROOT, process.env);
  normaliseEnv(process.env);

  let server: StewardServer;
  try {
    const config = loadConfig(process.env);
    server = await createApp(config);
    const { url } = await server.listen();
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
    if (loadedEnvFiles.length > 0) console.log(`  env       ${loadedEnvFiles.join(", ")}`);
    if (!isLoopbackHost(config.host)) {
      console.warn(
        `\n  Steward is listening on ${config.host}, beyond this machine. It has no sign-in:\n` +
          "  anyone who can reach this address and is allowed by STEWARD_ALLOWED_HOSTS can use it.\n",
      );
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Steward could not start: ${err.message}`);
    } else {
      console.error("Steward could not start:", err);
    }
    process.exit(1);
  }

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) {
      console.error("Stopping now.");
      process.exit(1);
    }
    stopping = true;
    console.log(`\n${signal}: closing Steward…`);
    server
      .close()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        console.error("Steward did not close cleanly:", err);
        process.exit(1);
      });
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

// Run only when started as a program, not when imported (tests import createApp from bootstrap).
if (import.meta.main) void main();
