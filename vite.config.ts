import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/* One self-contained HTML file, so every checkpoint can be published as a playable link. */
export default defineConfig({
  plugins: [viteSingleFile()],
  worker: { format: "iife" },
  build: { target: "es2022", assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 4000 },
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 120000 },
});
