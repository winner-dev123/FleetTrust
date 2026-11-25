import { createBaseConfig } from "@fleettrust/config/eslint/base";
import { defineConfig } from "eslint/config";

export default defineConfig(createBaseConfig({ tsconfigRootDir: import.meta.dirname }), {
  // This package is a CLI: printing to stdout is its job.
  rules: { "no-console": "off" },
});
