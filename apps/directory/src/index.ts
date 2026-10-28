import { createDirectoryApp, type DirectoryServer } from "./app.ts";
import { ConfigError, describeConfig, isLoopbackHost, loadConfig, REPO_ROOT } from "./config.ts";
import { loadEnvFiles } from "./env.ts";

async function main(): Promise<void> {
  const loaded = loadEnvFiles(REPO_ROOT, process.env);
  let server: DirectoryServer;
  try {
    const config = loadConfig(process.env);
    server = await createDirectoryApp(config);
    const { url } = await server.listen();
    console.log(`The Steward directory is ready at ${url}`);
    for (const line of describeConfig(config)) console.log(`  ${line}`);
    console.log(`  listed    ${server.catalogue.size} bots`);
    if (loaded.length > 0) console.log(`  env       ${loaded.join(", ")}`);
    if (!isLoopbackHost(config.host) && config.siteUrl.startsWith("http://127.0.0.1")) {
      console.warn(
        "\n  Listening beyond this machine: set DIRECTORY_SITE_URL to the public https address.\n",
      );
    }
  } catch (err) {
    console.error(
      `The directory could not start: ${err instanceof ConfigError || err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`\n${signal}: closing the directory…`);
    server
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

if (import.meta.main) void main();
