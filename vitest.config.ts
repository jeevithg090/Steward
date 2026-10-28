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
          include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
          server: { deps: { inline: [/@copilotkit\//] } },
        },
      },
    ],
  },
});
