import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export const ignores = {
  ignores: [
    "**/dist/**",
    "**/.next/**",
    "**/.expo/**",
    "**/coverage/**",
    "**/.turbo/**",
    "**/node_modules/**",
    "**/next-env.d.ts",
    "**/android/**",
    "**/ios/**",
  ],
};

/**
 * Strict, type-aware base config shared by every workspace.
 *
 * @param {{ tsconfigRootDir: string }} options  Pass `import.meta.dirname` from the workspace's eslint.config.js.
 */
export function createBaseConfig({ tsconfigRootDir }) {
  return defineConfig(
    ignores,
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      linterOptions: { reportUnusedDisableDirectives: "error" },
      rules: {
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { prefer: "type-imports", fixStyle: "inline-type-imports" },
        ],
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
        "no-console": ["error", { allow: ["warn", "error"] }],
        eqeqeq: ["error", "always"],
      },
    },
    {
      // Plain JS config files (eslint.config.js, metro.config.js, ...) are not type-checked.
      files: ["**/*.{js,mjs,cjs}"],
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: { globals: { ...globals.node } },
    },
  );
}
