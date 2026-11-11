/**
 * Runs before every web test file. Web tests never reach a network: a test that needs an answer
 * from the server stubs `fetch` with `mockFetch` (src/lib/testing.tsx). Any other call to `fetch`
 * fails the test that made it, with the method and path, instead of quietly trying a local port.
 */
import { afterEach, beforeEach } from "vitest";

let unmocked: string[] = [];

async function unmockedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const { pathname, search } = new URL(raw, window.location.href);
  const request = `${method} ${pathname}${search}`;
  unmocked.push(request);
  throw new Error(`Unmocked request: ${request}. Stub fetch with mockFetch, or mock the hook that calls it.`);
}

// Set directly rather than with vi.stubGlobal, so a test's vi.unstubAllGlobals() puts this back,
// not happy-dom's real fetch.
globalThis.fetch = unmockedFetch;

beforeEach(() => {
  unmocked = [];
});

afterEach(() => {
  if (unmocked.length === 0) return;
  const requests = unmocked.join(", ");
  unmocked = [];
  throw new Error(`The test called fetch without a stub: ${requests}`);
});
