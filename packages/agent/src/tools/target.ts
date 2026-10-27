import type { Target } from "@steward/shared";

/**
 * Turns what the model wrote into a web address the gateway can judge. Adds `https://` when the
 * model left the scheme out (people say "open bbc.co.uk"). Anything that does not parse is passed
 * on as written, without a host, so the gateway still sees and records it and the tool then fails.
 */
export function urlTarget(raw: string): Target {
  const text = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return { url: url.href, host: url.host };
  } catch {
    return { url: text };
  }
}

/** The page the agent's browser is on now, from its status. Never starts the browser. */
export function pageTarget(url: string | undefined): Target {
  if (!url) return {};
  try {
    return { url, host: new URL(url).host };
  } catch {
    return { url };
  }
}

const ADDRESS = /<([^<>\s]+@[^<>\s]+)>|([^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+)/;

/** `Sam <sam@example.com>` or `sam@example.com` → the bare address and the name, if any. */
export function parseAddress(raw: string): { email: string; name?: string } | undefined {
  const match = ADDRESS.exec(raw);
  const email = (match?.[1] ?? match?.[2])?.toLowerCase();
  if (!email) return undefined;
  const name = raw
    .replace(match?.[0] ?? "", "")
    .replace(/["']/g, "")
    .trim();
  return name ? { email, name } : { email };
}
