import { createBaseConfig } from "@fleettrust/config/eslint/base";
import { defineConfig } from "eslint/config";

export default defineConfig(createBaseConfig({ tsconfigRootDir: import.meta.dirname }), {
  // CLI entry points report progress on stderr via console.warn/console.error.
  files: ["src/cli/**/*.ts"],
  rules: { "no-console": ["error", { allow: ["warn", "error"] }] },
});
