import ts from "typescript";

import type { SourceFile, Violation } from "./rules.ts";

/**
 * Catalog drift check (RFC-0006, risk "Catalog drift"): every message in the English catalog
 * (`packages/copy`) must be used by a screen. Unused entries pile up when screens change, and
 * each one would later be translated and legally reviewed for nothing.
 *
 * The catalog is read from its source (the guard runs before any build). Usage is found by
 * following `copy` from `@fleettrust/copy` through aliases (`const t = copy.web.home;`),
 * property access (`t.title`), literal indexing (`t["title"]`) and destructuring. A group used
 * as a whole, for example `plural(n, t.items)` or `DAY_NAMES[day]`, counts for every message in it.
 * A catalog line ending in `// copy-unused: <reason>` is exempt (the reason is reviewed).
 */

export interface CatalogKey {
  key: string;
  path: string;
  line: number;
}

const unwrap = (node: ts.Expression): ts.Expression => {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};

const parse = (file: SourceFile) =>
  ts.createSourceFile(
    file.path,
    file.content,
    ts.ScriptTarget.Latest,
    true,
    file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

/** Every message in the catalog, starting from `export const en`, with where it is defined. */
export function catalogKeys(files: readonly SourceFile[], rootName = "en"): CatalogKey[] {
  const objects = new Map<
    string,
    { node: ts.ObjectLiteralExpression; file: ts.SourceFile; lines: string[] }
  >();
  for (const file of files) {
    const source = parse(file);
    const lines = file.content.split(/\r?\n/);
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const value = unwrap(decl.initializer);
        if (ts.isObjectLiteralExpression(value)) {
          objects.set(decl.name.text, { node: value, file: source, lines });
        }
      }
    }
  }

  const keys: CatalogKey[] = [];
  const walk = (name: string, prefix: string) => {
    const entry = objects.get(name);
    if (!entry) throw new Error(`Catalog object "${name}" not found in packages/copy/src.`);
    const { node, file, lines } = entry;
    for (const property of node.properties) {
      let key: string;
      let value: ts.Expression;
      if (ts.isShorthandPropertyAssignment(property)) {
        key = property.name.text;
        value = property.name;
      } else if (
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      ) {
        key = property.name.text;
        value = unwrap(property.initializer);
      } else {
        throw new Error(`Unsupported catalog entry in ${file.fileName}: ${property.getText()}`);
      }
      const full = prefix ? `${prefix}.${key}` : key;
      if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
        const line = file.getLineAndCharacterOfPosition(property.getStart()).line;
        if (/\/\/ copy-unused: \S/.test(lines[line] ?? "")) continue;
        keys.push({ key: full, path: file.fileName, line: line + 1 });
      } else if (ts.isObjectLiteralExpression(value)) {
        objects.set(full, { node: value, file, lines });
        walk(full, full);
      } else if (ts.isIdentifier(value)) {
        walk(value.text, full);
      } else {
        throw new Error(`Unsupported catalog value for "${full}" in ${file.fileName}.`);
      }
    }
  };
  walk(rootName, "");
  return keys;
}

/** Positions where an identifier is a name, not a value read. */
function isNamePosition(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isJsxAttribute(parent) ||
    ts.isTypeReferenceNode(parent) ||
    ts.isQualifiedName(parent)
  );
}

/** Catalog paths a source file reads ("" means the whole catalog). */
export function usedPaths(file: SourceFile): string[] {
  const source = parse(file);
  const aliases = new Map<string, string>();
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "@fleettrust/copy" &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const spec of statement.importClause.namedBindings.elements) {
        const imported = (spec.propertyName ?? spec.name).text;
        if (imported === "copy" || imported === "en") aliases.set(spec.name.text, "");
      }
    }
  }
  if (aliases.size === 0) return [];

  const resolve = (node: ts.Expression): string | undefined => {
    const expr = unwrap(node);
    if (ts.isIdentifier(expr)) return aliases.get(expr.text);
    if (ts.isPropertyAccessExpression(expr)) {
      const base = resolve(expr.expression);
      return base === undefined ? undefined : join(base, expr.name.text);
    }
    if (
      ts.isElementAccessExpression(expr) &&
      (ts.isStringLiteral(expr.argumentExpression) ||
        ts.isNoSubstitutionTemplateLiteral(expr.argumentExpression))
    ) {
      const base = resolve(expr.expression);
      return base === undefined ? undefined : join(base, expr.argumentExpression.text);
    }
    return undefined;
  };

  // Aliases: `const t = copy.web.home;` (repeated so aliases of aliases resolve).
  const aliasDecls = new Set<ts.Node>();
  for (let changed = true; changed;) {
    changed = false;
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        !aliases.has(node.name.text) &&
        !isExported(node)
      ) {
        const path = resolve(node.initializer);
        if (path !== undefined) {
          aliases.set(node.name.text, path);
          aliasDecls.add(node);
          changed = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const used: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isTypeQueryNode(node) || ts.isImportDeclaration(node)) return;
    // The alias itself is not a read; its uses are.
    if (aliasDecls.has(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer
    ) {
      const base = resolve(node.initializer);
      if (base !== undefined) {
        for (const element of node.name.elements) {
          const key = element.propertyName ?? element.name;
          if (element.dotDotDotToken || !ts.isIdentifier(key)) used.push(base);
          else used.push(join(base, key.text));
        }
        return;
      }
    }
    if (
      (ts.isIdentifier(node) && !isNamePosition(node)) ||
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const path = resolve(node);
      if (path !== undefined && !extendsPath(node)) {
        used.push(path);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return used;
}

const join = (base: string, key: string) => (base ? `${base}.${key}` : key);

/** `export const x = …`: the value leaves the file, so it counts as read where it is defined. */
function isExported(decl: ts.VariableDeclaration): boolean {
  const statement = decl.parent.parent;
  return (
    ts.isVariableStatement(statement) &&
    (statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)
  );
}

/** True when the parent reads a longer catalog path from this node (`t` in `t.title`). */
function extendsPath(node: ts.Node): boolean {
  let child = node;
  let parent = node.parent;
  while (
    ts.isParenthesizedExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isAsExpression(parent)
  ) {
    child = parent;
    parent = parent.parent;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.expression === child) return true;
  return (
    ts.isElementAccessExpression(parent) &&
    parent.expression === child &&
    (ts.isStringLiteral(parent.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(parent.argumentExpression))
  );
}

/** Catalog messages that no screen reads. */
export function checkCopyUsage(
  catalogFiles: readonly SourceFile[],
  sources: readonly SourceFile[],
): Violation[] {
  const used = new Set(sources.flatMap(usedPaths));
  // A read beyond a message (`t.title.length`) still uses the message.
  const extended = new Set(
    [...used].flatMap((path) => {
      const parts = path.split(".");
      return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("."));
    }),
  );
  const covers = (key: string) => {
    if (used.has("") || extended.has(key)) return true;
    const parts = key.split(".");
    for (let i = parts.length; i > 0; i--) if (used.has(parts.slice(0, i).join("."))) return true;
    return false;
  };
  return catalogKeys(catalogFiles)
    .filter(({ key }) => !covers(key))
    .map(({ key, path, line }) => ({
      path,
      line,
      rule: "copy-unused",
      detail: `copy.${key} is not used by any screen`,
    }));
}
