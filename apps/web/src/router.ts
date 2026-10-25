// Hash routing (plan.md §1.4, §4.6): no dependency, works as a static file, in `vite preview`
// and inside Tauri. Routes are matched by pattern; `:id` segments become params.
import { useEffect, useState, type MouseEvent } from "react";

export interface Route {
  /** The path after `#`, always starting with `/` (e.g. `/missions/abc`). */
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
}

export const ROUTES = [
  "/chat", "/missions", "/missions/:id", "/memory", "/profiles", "/profiles/import", "/profiles/:id",
  "/skills", "/shield", "/read", "/owed", "/callers", "/privacy", "/story", "/settings", "/devices", "/pair", "/connectors",
] as const;

export function parseHash(hash: string): { path: string; query: URLSearchParams } {
  const raw = hash.replace(/^#/, "") || "/chat";
  const [pathPart, queryPart] = raw.split("?");
  const path = pathPart && pathPart.startsWith("/") ? pathPart : `/${pathPart ?? ""}`;
  return { path: path === "/" ? "/chat" : path.replace(/\/+$/, "") || "/chat", query: new URLSearchParams(queryPart ?? "") };
}

/** `match("/missions/:id", "/missions/abc")` → `{id: "abc"}`; null when it does not match. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(s[i]!);
    else if (seg !== s[i]) return null;
  }
  return params;
}

export function currentRoute(): Route {
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  // A Tempo Mesh pairing link from the QR code: <origin>/#pair=<id>.<secret> (tempo_gateway.mesh).
  if (hash.startsWith("#pair=")) {
    return { path: "/pair", params: { link: window.location.href }, query: new URLSearchParams() };
  }
  const { path, query } = parseHash(hash);
  for (const pattern of ROUTES) {
    const params = match(pattern, path);
    if (params) return { path, params, query };
  }
  return { path, params: {}, query };
}

/** Which pattern a path belongs to, for highlighting the sidebar (`/missions/abc` → `/missions`). */
export function section(path: string): string {
  const first = path.split("/").filter(Boolean)[0];
  return first ? `/${first}` : "/chat";
}

export function navigate(to: string): void {
  const target = to.startsWith("#") ? to : `#${to.startsWith("/") ? to : `/${to}`}`;
  if (window.location.hash === target) return;
  window.location.hash = target;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute);
  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** Props for an `<a>` that navigates by hash without a full reload (it is one anyway). */
export function linkProps(to: string): { href: string; onClick: (e: MouseEvent<HTMLAnchorElement>) => void } {
  const href = to.startsWith("#") ? to : `#${to}`;
  return {
    href,
    onClick: (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(href);
    },
  };
}
