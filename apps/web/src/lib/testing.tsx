import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderResult, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";

/**
 * Test helpers: a fake `fetch` that answers by method and path, and a render wrapped in the
 * providers every page needs. Only test files import this.
 */

export interface FakeRequest {
  method: string;
  /** Path and query, e.g. `/api/tasks?state=suggested`. */
  url: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export type FakeResponse = { status?: number; body?: unknown } | undefined;

/** Stubs global fetch. The handler returns `{ status, body }`; returning nothing gives a 404. */
export function mockFetch(handler: (req: FakeRequest) => FakeResponse | Promise<FakeResponse>) {
  const calls: FakeRequest[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(raw, "http://steward.test");
    const req: FakeRequest = {
      method: (init?.method ?? "GET").toUpperCase(),
      url: parsed.pathname + parsed.search,
      path: parsed.pathname,
      query: parsed.searchParams,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(req);
    const res = (await handler(req)) ?? { status: 404, body: { error: "Not found in the test." } };
    const status = res.status ?? 200;
    const text =
      res.body === undefined ? "" : typeof res.body === "string" ? res.body : JSON.stringify(res.body);
    return new Response(status === 204 ? null : text, {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  opts: { route?: string; client?: QueryClient; wrap?: (children: ReactNode) => ReactNode } = {},
): RenderResult & { client: QueryClient } {
  const client = opts.client ?? testQueryClient();
  const inner = opts.wrap ? opts.wrap(ui) : ui;
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts.route ?? "/"]}>{inner}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}
