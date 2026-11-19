import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

import { moduleBoundaries } from "../eslint.boundaries.js";

/**
 * Proves the architectural lint rules fire. Only the boundary rules are loaded
 * (no type-aware rules) so fixture files don't need to exist on disk.
 */
const eslint = new ESLint({
  cwd: `${import.meta.dirname}/..`,
  overrideConfigFile: true,
  overrideConfig: [
    { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
    ...moduleBoundaries,
  ],
});

async function lint(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.message);
}

describe("module boundaries", () => {
  it("blocks emergency from importing entitlements (ADR-0010)", async () => {
    const messages = await lint(
      "src/modules/emergency/incident.service.ts",
      'import { QuotaService } from "../entitlements/index.js";\nexport { QuotaService };\n',
    );
    expect(messages.join("\n")).toMatch(/adr\/0010/);
  });

  it.each(["verification", "power-user", "search"])(
    "blocks %s from importing entitlements (ADR-0009)",
    async (moduleName) => {
      const messages = await lint(
        `src/modules/${moduleName}/service.ts`,
        'import { plans } from "../entitlements/index.js";\nexport { plans };\n',
      );
      expect(messages.join("\n")).toMatch(/adr\/0009/);
    },
  );

  it("blocks deep imports into another module's internals (ADR-0002)", async () => {
    const messages = await lint(
      "src/modules/service-requests/request.service.ts",
      'import { repo } from "../providers/provider.repository.js";\nexport { repo };\n',
    );
    expect(messages.join("\n")).toMatch(/adr\/0002/);
  });

  it("allows importing another module through its public index", async () => {
    const messages = await lint(
      "src/modules/service-requests/request.service.ts",
      'import { QuotaService } from "../entitlements/index.js";\nexport { QuotaService };\n',
    );
    expect(messages).toEqual([]);
  });
});
