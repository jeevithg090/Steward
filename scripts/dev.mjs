#!/usr/bin/env node
// Starts the server and the web app together, with one prefix per process, and says plainly when
// Steward is ready or why it could not start.
// Keys can live outside the repository: STEWARD_ENV_FILE=/path/to/.env pnpm dev
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const HELP = `pnpm dev starts Steward for development: the server and the web app together.

  server    http://127.0.0.1:8787 (STEWARD_PORT), and the phone port 8788 (STEWARD_DEVICE_PORT)
  web app   http://localhost:5173, which passes /api on to the server

Settings come from .env in the repository, or from the file STEWARD_ENV_FILE names.
Every setting is in docs/configuration.md. Stop with Ctrl+C.
`;

// import.meta.main, which the server starts by, arrived in Node 24.2. Older versions would run the
// web app with no server behind it and say nothing.
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major < 24 || (major === 24 && minor < 2)) {
  console.error(
    `Steward needs Node 24.2 or newer, and this is Node ${process.versions.node}. See the README's quick start.`,
  );
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (args.length > 0) {
  console.error(`pnpm dev takes no arguments, only --help (it was given ${args.join(" ")}).`);
  console.error("Settings go in .env: see docs/configuration.md.");
  process.exit(1);
}

const envFile = process.env.STEWARD_ENV_FILE;
if (envFile) {
  if (!existsSync(envFile)) {
    console.error(`STEWARD_ENV_FILE points at ${envFile}, which does not exist.`);
    process.exit(1);
  }
  process.loadEnvFile(envFile);
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");
const plain = (line) => line.replace(ANSI, "");

/** What the children have said so far: the server's address, the web app's, or why it stopped. */
const state = { server: undefined, web: undefined, announced: false };
let waiting;

function watchServer(line) {
  const text = plain(line);
  const ready = /Steward is ready at (\S+)/.exec(text);
  if (ready) {
    state.server = ready[1];
    clearTimeout(waiting);
    announce();
    return;
  }
  const failed = /Steward could not start:?\s*(.*)$/.exec(text);
  if (failed) {
    clearTimeout(waiting);
    state.server = undefined;
    state.announced = false;
    banner([
      "Steward could not start, so the web app has nothing behind it:",
      `  ${failed[1] || "see the server's messages above."}`,
      "Fix that, then press Ctrl+C and run pnpm dev again.",
    ]);
  }
}

function watchWeb(line) {
  const local = /Local:\s+(\S+)/.exec(plain(line));
  if (local) {
    state.web = local[1];
    announce();
  }
}

function announce() {
  if (state.announced || !state.server || !state.web) return;
  state.announced = true;
  banner([`Steward is ready: open ${state.web}`]);
}

function banner(lines) {
  const out = `\n${lines.map((l) => `  ${l}`).join("\n")}\n\n`;
  process.stdout.write(out);
}

const SHELL = process.platform === "win32";

const procs = [
  ["server", ["--filter", "@steward/server", "dev"], "\x1b[36m", watchServer],
  ["web", ["--filter", "@steward/web", "dev"], "\x1b[35m", watchWeb],
].map(([name, pnpmArgs, colour, watch]) => {
  // On Windows pnpm is a .cmd file, which only a shell can start. The arguments are fixed words.
  const child = SHELL
    ? spawn(["pnpm", ...pnpmArgs].join(" "), {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      })
    : spawn("pnpm", pnpmArgs, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const tag = `${colour}${name.padEnd(6)}\x1b[0m│ `;
  const pipe = (stream, out) => {
    // A line can arrive in two chunks; hold the unfinished end until the rest comes.
    let rest = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const line of lines) {
        out.write(`${tag}${line}\n`);
        watch(line);
      }
    });
    stream.on("end", () => {
      if (!rest) return;
      out.write(`${tag}${rest}\n`);
      watch(rest);
      rest = "";
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("error", (err) => {
    if (stopping) return;
    console.error(
      err.code === "ENOENT"
        ? "Could not run pnpm. Install pnpm 10 (see the README's quick start), then run pnpm dev again."
        : `Could not start the ${name}: ${err.message}`,
    );
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.log(`${tag}${signal ? `stopped by ${signal}` : `exited with ${code}`}`);
    // A child that ends on its own, or is killed, ends the run as a failure.
    shutdown(code === 0 ? 0 : 1);
  });
  return child;
});

waiting = setTimeout(() => {
  if (state.server) return;
  banner([
    "The server has not said it is ready after 90 seconds.",
    "Its messages above say what it is doing; the web app will not work until it is ready.",
  ]);
}, 90_000);
waiting.unref();

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  clearTimeout(waiting);
  // Only a child that started has a pid. Never kill one without: that signal would reach this
  // whole process group, the terminal's shell included.
  const running = procs.filter((p) => p.pid && p.exitCode === null && p.signalCode === null);
  for (const p of running) p.kill("SIGTERM");
  // Leave as soon as both children are gone, or after half a second either way.
  setTimeout(() => process.exit(code), 500).unref();
  Promise.all(running.map((p) => new Promise((r) => p.once("exit", r)))).then(() => process.exit(code));
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
