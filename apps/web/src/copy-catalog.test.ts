import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Product text lives in @fleettrust/copy (SRS §7: strings kept outside code), not in screens.
 * Parses every screen and component and fails on user-visible text written inline:
 * - text between JSX tags;
 * - plain strings in text props (label, title, hint, …);
 * - sentence-like string literals (capitalised, with a space), e.g. messages passed to setError.
 * A line ending in `// copy-allow: <reason>` is exempt (the reason is reviewed).
 */

const root = join(import.meta.dirname, "..");
/** Starts with a capitalised word (FleetTrust included), has a space and a lowercase letter. */
const SENTENCE = /^[A-Z][A-Za-z']+[.,!?:]? [\s\S]*[a-z]/;
const TEXT_PROPS = new Set([
  "label",
  "title",
  "hint",
  "placeholder",
  "reason",
  "accessibilityLabel",
  "accessibilityHint",
  "description",
  "confirmLabel",
  "aria-label",
  "alt",
  "summary",
  "emptyText",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

interface Finding {
  file: string;
  line: number;
  text: string;
}

function inlineText(path: string): Finding[] {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = source.split(/\r?\n/);
  const findings: Finding[] = [];
  const report = (node: ts.Node, text: string) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart()).line;
    if (/\/\/ copy-allow: \S/.test(lines[line] ?? "")) return;
    findings.push({ file: relative(root, path).replaceAll("\\", "/"), line: line + 1, text });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && /[A-Za-z]{2,}/.test(node.text)) report(node, node.text.trim());
    if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      ((TEXT_PROPS.has(node.name.getText()) && /[A-Za-z]{2,}/.test(node.initializer.text)) ||
        SENTENCE.test(node.initializer.text))
    ) {
      report(node, node.initializer.text);
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !ts.isImportDeclaration(node.parent) &&
      !ts.isJsxAttribute(node.parent) &&
      !ts.isExternalModuleReference(node.parent) &&
      SENTENCE.test(node.text)
    ) {
      report(node, node.text);
    }
    if (
      ts.isPropertyAssignment(node) &&
      TEXT_PROPS.has(node.name.getText()) &&
      (ts.isStringLiteral(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer)) &&
      /[A-Za-z]{2,}/.test(node.initializer.text) &&
      !SENTENCE.test(node.initializer.text)
    ) {
      report(node, node.initializer.text);
    }
    if (ts.isTemplateExpression(node) && /^[A-Z][A-Za-z']* /.test(node.head.text)) {
      report(node, node.getText());
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

/**
 * Migrated so far (the website moves slice by slice; each slice adds its folders here).
 * Legal documents and the accessibility statement are whole documents, reviewed and translated
 * as documents (RFC-0006 principle 2), so they stay as pages.
 */
const MIGRATED = [
  "src/app/(site)",
  "src/components",
  "src/app/layout.tsx",
  "src/app/not-found.tsx",
  "src/lib/nav.ts",
  "src/lib/price.ts",
];
const DOCUMENTS = ["src/app/(site)/legal/", "src/app/(site)/accessibility/"];

const files = MIGRATED.flatMap((path) => {
  const full = join(root, path);
  return statSync(full).isDirectory() ? sourceFiles(full) : [full];
}).filter((path) => {
  const rel = relative(root, path).replaceAll("\\", "/");
  return !DOCUMENTS.some((doc) => rel.startsWith(doc));
});

describe("product text comes from @fleettrust/copy", () => {
  it("scans the migrated pages and components", () => {
    expect(files.length).toBeGreaterThan(35);
  });

  it("has no inline user-visible text", () => {
    const findings = files.flatMap(inlineText).map((f) => `${f.file}:${String(f.line)} ${f.text}`);
    expect(findings).toEqual([]);
  });
});
