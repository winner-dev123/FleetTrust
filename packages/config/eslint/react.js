import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";

/** React rules shared by web and mobile. Combine with createBaseConfig(). */
export const reactConfig = defineConfig({
  files: ["**/*.{ts,tsx}"],
  extends: [reactHooks.configs.flat["recommended-latest"]],
});
