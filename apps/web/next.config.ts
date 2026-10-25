import type { NextConfig } from "next";

// The Gateway this build may talk to (and its WebSocket form), for connect-src. Showcase builds
// never call one, but the allowance is harmless and lets `?showcase=1` and live mode share a build.
const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8000";
const gatewayWs = gateway.replace(/^http/, "ws");
const dev = process.env.NODE_ENV === "development";

/** Security headers (SHIPPING.md §7). Next needs inline scripts for hydration, so script-src keeps 'unsafe-inline'. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${gateway} ${gatewayWs}${dev ? " ws: wss:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Frame-Options", value: "DENY" },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default config;
