import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Booting PGlite + PostGIS (WebAssembly) takes several seconds per database.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
