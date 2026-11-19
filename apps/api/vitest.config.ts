import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // SWC (instead of the default transformer) emits the decorator metadata NestJS DI relies on.
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["src/**/*.spec.ts", "test/**/*.e2e-spec.ts", "test/**/*.spec.ts"],
    environment: "node",
    // Readiness tests boot an in-process PGlite + PostGIS database.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
