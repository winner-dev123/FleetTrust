import nextPlugin from "@next/eslint-plugin-next";
import { defineConfig } from "eslint/config";

/** Next.js rules (Core Web Vitals). Combine with createBaseConfig() and reactConfig. */
export const nextConfig = defineConfig({
  files: ["**/*.{js,mjs,ts,tsx}"],
  extends: [nextPlugin.configs["core-web-vitals"]],
});
