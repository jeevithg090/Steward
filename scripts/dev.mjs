#!/usr/bin/env node
// Starts the server and the web app together, with one prefix per process.
// Keys can live outside the repository: STEWARD_ENV_FILE=/path/to/.env pnpm dev
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const envFile = process.env.STEWARD_ENV_FILE;
if (envFile) {
  if (!existsSync(envFile)) {
    console.error(`STEWARD_ENV_FILE points at ${envFile}, which does not exist.`);
    process.exit(1);
  }
  process.loadEnvFile(envFile);
}

const procs = [
  ["server", ["--filter", "@steward/server", "dev"], "\x1b[36m"],
  ["web", ["--filter", "@steward/web", "dev"], "\x1b[35m"],
].map(([name, args, colour]) => {
  const child = spawn("pnpm", args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const tag = `${colour}${name.padEnd(6)}\x1b[0m│ `;
  const pipe = (stream, out) =>
    stream.on("data", (buf) => {
      for (const line of buf.toString().split("\n")) if (line.trim()) out.write(tag + line + "\n");
    });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${tag}exited with ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
