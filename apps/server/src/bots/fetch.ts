import { createGuardedFetch } from "@steward/connectors";
import { isRemoteDirectory } from "../config.ts";

/**
 * How the server reads the bot directory, packs and install counts from the web. A pack address
 * can come from a link (`/bots/add?pack=`), so every address but the configured directory's own
 * origin goes through the guarded fetch: no loopback, private ranges or cloud metadata (plan §4,
 * decision 9), unless STEWARD_ALLOW_PRIVATE_HOSTS is on. The configured directory may itself be on
 * this machine (`http://127.0.0.1:8790/index.json`): the owner chose it.
 */
export function directoryFetch(opts: {
  directoryUrl: string;
  allowPrivateHosts: boolean;
  /** The fetch for the configured directory's own origin. */
  fetch?: typeof fetch;
}): typeof fetch {
  const trusted = isRemoteDirectory(opts.directoryUrl) ? new URL(opts.directoryUrl).origin : undefined;
  const guarded = createGuardedFetch({ allowPrivateHosts: opts.allowPrivateHosts });
  const plain = opts.fetch ?? globalThis.fetch;
  return ((input: string | URL | Request, init?: RequestInit) => {
    const href = input instanceof Request ? input.url : String(input);
    let origin: string | undefined;
    try {
      origin = new URL(href).origin;
    } catch {
      origin = undefined;
    }
    return trusted !== undefined && origin === trusted ? plain(input, init) : guarded(input, init);
  }) as typeof fetch;
}
