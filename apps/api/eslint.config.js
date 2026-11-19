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
    },
  },
  moduleBoundaries,
);
