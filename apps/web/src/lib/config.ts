// Where the web app finds its Gateway (plan.md §4.4): build-time env, then runtime overrides
// kept per browser in localStorage (Settings), then `?showcase=1` on the URL. Pages never read
// this themselves; App.tsx resolves it once and passes a Gateway down.

export interface GatewayConfig {
  url: string;
  token: string;
}

export const GATEWAY_KEY = "tempo.gateway";
export const TOKEN_KEY = "tempo.token";
export const SHOWCASE_KEY = "tempo.showcase";

const DEFAULT_URL = "http://127.0.0.1:8000";
const DEFAULT_TOKEN = "devtoken";

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string | null): void {
  try {
    if (value === null || value === "") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private window or locked-down browser: the override lasts until reload */
  }
}

/** Build-time defaults from Vite's env (VITE_GATEWAY_URL, VITE_TEMPO_TOKEN). */
export function envConfig(): GatewayConfig {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return {
    url: (env.VITE_GATEWAY_URL ?? DEFAULT_URL).replace(/\/$/, ""),
    token: env.VITE_TEMPO_TOKEN ?? DEFAULT_TOKEN,
  };
}

/** The Gateway to use now: runtime overrides win over the build's env. */
export function gatewayConfig(): GatewayConfig {
  const env = envConfig();
  if (typeof window === "undefined") return env;
  return {
    url: (stored(GATEWAY_KEY) ?? env.url).replace(/\/$/, ""),
    token: stored(TOKEN_KEY) ?? env.token,
  };
}

export function setGatewayOverride(url: string | null, token: string | null): void {
  store(GATEWAY_KEY, url);
  store(TOKEN_KEY, token);
}

/** Showcase (no Gateway, recorded replies) is on for the build, for this browser, or for this URL. */
export function showcaseEnabled(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  if (env.VITE_TEMPO_SHOWCASE === "1") return true;
  if (typeof window === "undefined") return false;
  if (stored(SHOWCASE_KEY) === "1") return true;
  return new URLSearchParams(window.location.search).get("showcase") === "1";
}

export function setShowcaseOverride(on: boolean | null): void {
  store(SHOWCASE_KEY, on === null ? null : on ? "1" : "0");
}

/** The showcase was forced by the build, so Settings cannot switch it off. */
export function showcaseForcedByBuild(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_TEMPO_SHOWCASE === "1";
}
