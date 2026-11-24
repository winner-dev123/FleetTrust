import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Next compiles JSX itself (tsconfig "preserve"); tests need the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    // Component tests opt in with `// @vitest-environment jsdom` at the top of the file.
  },
});
