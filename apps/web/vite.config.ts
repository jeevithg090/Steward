import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

/** Where `pnpm dev` finds the Steward server. Override with STEWARD_SERVER_URL when it runs elsewhere. */
const server = process.env.STEWARD_SERVER_URL ?? "http://127.0.0.1:8787";

/**
 * The REST API, the CopilotKit runtime and the live event stream all sit under `/api`. Two of them
 * stream (the runtime's AG-UI events and `/api/events`), so the proxy must pass bytes straight
 * through: no compression, and a hint to any proxy in front not to buffer.
 *
 * `changeOrigin` stays off: the browser's Host goes through as it is, so the server sees the page's
 * Origin match the Host it was sent to, and trusts no other origin. A page on another port that
 * sends a request through this proxy still carries its own Origin, and is refused.
 */
const api: ProxyOptions = {
  target: server,
  changeOrigin: false,
  configure(proxy) {
    proxy.on("proxyReq", (req) => {
      // Ask for an uncompressed body; a gzip stream would be held until a chunk fills.
      req.setHeader("accept-encoding", "identity");
    });
    proxy.on("proxyRes", (res) => {
      if (String(res.headers["content-type"] ?? "").includes("text/event-stream")) {
        res.headers["cache-control"] = "no-cache, no-transform";
        res.headers["x-accel-buffering"] = "no";
      }
    });
  },
};

/** The computer's live screen: one WebSocket per agent at `/ws/computer/:agentId`. */
const ws: ProxyOptions = { target: server.replace(/^http/, "ws"), ws: true, changeOrigin: false };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": api, "/ws": ws },
  },
  // `vite preview` has no proxy unless it is given one again.
  preview: {
    host: "127.0.0.1",
    port: 4173,
    proxy: { "/api": api, "/ws": ws },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
});
