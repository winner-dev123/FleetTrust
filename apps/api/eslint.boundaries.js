/**
 * Architectural boundaries between API modules (src/modules/<name>).
 * Kept in its own file so test/module-boundaries.spec.ts can prove the rules fire.
 *
 * - ADR-0002: a module may import another module only through its public index.
 * - ADR-0009: verification, power-user and search never read plan or entitlement data
 *   (neither the entitlements module nor the plan and quota tables).
 * - ADR-0010: emergency never depends on entitlements or quotas.
 */

/** Plan and quota tables: verification, Power User and search never read them. */
const PLAN_TABLES = [
  "plans",
  "planVersions",
  "planVersionLimits",
  "planAssignments",
  "quotaOverrides",
  "quotaCounters",
  "quotaConsumptions",
];

const ENTITLEMENTS = ["**/entitlements", "**/entitlements/**", "**/modules/entitlements*"];

/**
 * Deep imports into a sibling module, e.g. "../billing/billing.repository.js".
 * gitignore semantics, last match wins: "../*\/*" also matches "../../config/…", so the shared
 * kernel outside src/modules (config, database, observability, platform) is re-allowed, then
 * deep paths into src/modules are excluded again.
 */
const crossModuleDeepImport = {
  group: [
    "../*/*",
    "!../*/index.js",
    "!../../**",
    "../../modules/*/*",
    "!../../modules/*/index.js",
  ],
  message:
    "Import other modules only through their public index.js (docs/adr/0002-modular-monolith-api.md).",
};

/** @type {import("eslint").Linter.Config[]} */
export const moduleBoundaries = [
  {
    files: ["src/modules/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [crossModuleDeepImport] }],
    },
  },
  {
    files: [
      "src/modules/verification/**/*.ts",
      "src/modules/power-user/**/*.ts",
      "src/modules/search/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            crossModuleDeepImport,
            {
              group: ENTITLEMENTS,
              message:
                "Trust signals and ranking must not depend on plans or entitlements (docs/adr/0009-trust-independent-of-payment.md).",
            },
          ],
          // Not even the tables: the status can't be computed from what someone pays.
          paths: [
            {
              name: "@fleettrust/db",
              importNames: PLAN_TABLES,
              message:
                "Trust signals and ranking must not read plan or quota tables (docs/adr/0009-trust-independent-of-payment.md).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/modules/emergency/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            crossModuleDeepImport,
            {
              group: ENTITLEMENTS,
              message:
                "Emergency features must never be gated by quotas or plans (docs/adr/0010-emergency-exempt-from-quotas.md).",
            },
          ],
        },
      ],
    },
  },
];
