/**
 * Runs the relay: `pnpm --filter @steward/relay start`.
 *
 *   RELAY_MACHINE_TOKEN   the token Steward presents (set STEWARD_RELAY_TOKEN to the same value)
 *   RELAY_PUBLIC_URL      the relay's https address, e.g. https://relay.example.com
 *   RELAY_PORT            default 8790; RELAY_HOST default 127.0.0.1 (put a TLS proxy in front)
 *   RELAY_DATA_DIR        default ./relay-data
 *   RELAY_STATIC_DIR      the built phone app, default apps/web/dist-phone
 *   RELAY_VAPID_SUBJECT   a mailto: or https: contact for push services
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRelay } from "./relay.ts";

const env = process.env;
const token = env.RELAY_MACHINE_TOKEN?.trim() ?? "";
const publicUrl = env.RELAY_PUBLIC_URL?.trim() ?? "";
if (token.length < 24 || !publicUrl) {
  console.error(
    "Set RELAY_MACHINE_TOKEN (24+ characters, e.g. `openssl rand -base64 32`) and RELAY_PUBLIC_URL.",
  );
  process.exit(1);
}
const dataDir = resolve(env.RELAY_DATA_DIR?.trim() || "relay-data");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const relay = createRelay({
  dbPath: join(dataDir, "relay.db"),
  machineToken: token,
  publicUrl,
  staticDir: env.RELAY_STATIC_DIR?.trim() || fileURLToPath(new URL("../../web/dist-phone", import.meta.url)),
  ...(env.RELAY_VAPID_SUBJECT ? { vapidSubject: env.RELAY_VAPID_SUBJECT } : {}),
});
const { url } = await relay.listen(Number(env.RELAY_PORT ?? 8790), env.RELAY_HOST?.trim() || "127.0.0.1");
console.log(`Steward relay at ${url} (public ${publicUrl}). It stores ciphertext and ids only.`);
const stop = () => void relay.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
