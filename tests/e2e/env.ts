/**
 * Where the end-to-end run finds Steward. Shared by the Playwright config and the specs, so the two
 * can never disagree. The web app's dev server proxies `/api` and `/ws` to the Steward server.
 *
 * `STEWARD_E2E_SERVER_PORT` and `STEWARD_E2E_WEB_PORT` move the run off 8787 and 5173, so it can
 * run while `pnpm dev` is up without the specs reaching that server and its data. The web port
 * must be one the server accepts as a dev origin (5173 or 4173, `DEV_PORTS` in the server config).
 */

function port(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 && value < 65_536 ? value : fallback;
}

export const WEB_PORT = port("STEWARD_E2E_WEB_PORT", 5173);
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
export const SERVER_PORT = port("STEWARD_E2E_SERVER_PORT", 8787);
export const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;

/** The localStorage key the web app uses to remember that the welcome was seen. */
export const WELCOME_STORAGE_KEY = "steward.welcome";
