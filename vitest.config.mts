import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  // Film rendering at production resolutions is genuinely slow work,
  // not a hang; the default 5s timeout is too tight for export tests.
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 60000 },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
