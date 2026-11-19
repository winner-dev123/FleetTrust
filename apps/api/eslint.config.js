import { createBaseConfig } from "@fleettrust/config/eslint/base";
import { defineConfig } from "eslint/config";

import { moduleBoundaries } from "./eslint.boundaries.js";

export default defineConfig(
  createBaseConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["**/*.ts"],
    rules: {
      // NestJS modules are classes with static factories and no instance members.
      "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }],
      // NestJS declares option bags (e.g. NestApplicationOptions) as classes but expects plain
      // object literals; this rule would flag every documented call.
      "@typescript-eslint/no-unsafe-class-instance-assignment": "off",
    },
  },
  moduleBoundaries,
  {
    // CLI scripts (e.g. the tracing smoke test) report results on stdout.
    files: ["scripts/**/*.mjs"],
    rules: { "no-console": "off" },
  },
);
