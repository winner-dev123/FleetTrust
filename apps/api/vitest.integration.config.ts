import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

/**
 * Integration tests against real services (Redis, Firebase Auth emulator). Run by CI's
 * `local-infra` job with REQUIRE_INTEGRATION=1; locally: `pnpm infra:up`, `pnpm emulators`,
 * then `pnpm --filter @fleettrust/api test:integration`.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["test/integration/**/*.int-spec.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // One process talks to the shared emulator and Redis at a time.
    fileParallelism: false,
  },
});
