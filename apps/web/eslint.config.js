import { createBaseConfig } from "@fleettrust/config/eslint/base";
import { nextConfig } from "@fleettrust/config/eslint/next";
import { reactConfig } from "@fleettrust/config/eslint/react";
import { defineConfig } from "eslint/config";

export default defineConfig(
  createBaseConfig({ tsconfigRootDir: import.meta.dirname }),
  reactConfig,
  nextConfig,
);
