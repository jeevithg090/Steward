/**
 * Where the end-to-end run finds Steward. Shared by the Playwright config and the specs, so the two
 * can never disagree. The web app's dev server proxies `/api` and `/ws` to the Steward server.
 */

export const WEB_URL = "http://127.0.0.1:5173";
export const SERVER_PORT = 8787;
export const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;

/** The localStorage key the web app uses to remember that the welcome was seen. */
export const WELCOME_STORAGE_KEY = "steward.welcome";
