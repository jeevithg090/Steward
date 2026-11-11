import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: [
            "packages/*/test/**/*.test.ts",
            "apps/server/test/**/*.test.ts",
            "apps/relay/test/**/*.test.ts",
            "apps/directory/test/**/*.test.ts",
            "tenants/*.test.ts",
          ],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: "./apps/web/vite.config.ts",
        test: {
          name: "web",
          root: "./apps/web",
          environment: "happy-dom",
          // Not happy-dom's default http://localhost:3000, so a stray request can never reach a
          // server that happens to run there. test/setup.ts fails any fetch a test did not stub.
          environmentOptions: { happyDOM: { url: "http://steward.test/" } },
          setupFiles: ["./test/setup.ts"],
          include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
          // Rendering a page on a busy machine can take seconds; Vitest's 5 s and 10 s defaults
          // fail tests that pass on their own.
          testTimeout: 20_000,
          hookTimeout: 30_000,
          server: { deps: { inline: [/@copilotkit\//] } },
        },
      },
    ],
  },
});
