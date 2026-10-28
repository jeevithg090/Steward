import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The phone app (docs/plans/phone-and-shortcuts.md §5): a separate build of apps/web, served by the
 * relay from its own https origin. `pnpm --filter @steward/web build:phone` writes `dist-phone/`.
 */
export default defineConfig({
  root: fileURLToPath(new URL("./phone", import.meta.url)),
  publicDir: fileURLToPath(new URL("./phone-public", import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL("./dist-phone", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
  },
});
