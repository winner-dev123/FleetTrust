import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Prompt 30 architecture review, as tests (docs/rfcs/architecture-review.md):
 * - every RFC has the required sections;
 * - every existing event an RFC consumes really exists in the API (the seam is real);
 * - every proposed event has a schema, and appears nowhere in the code (specification only);
 * - no future table named in an RFC exists in a migration or the Drizzle schema.
 */

const repo = path.resolve(import.meta.dirname, "../../..");
const rfcDir = path.join(repo, "docs/rfcs");
const eventsDir = path.join(rfcDir, "events");

const rfcFiles = readdirSync(rfcDir).filter((f) => /^\d{4}-.+\.md$/.test(f));
const rfcs = rfcFiles.map((file) => ({
  file,
  text: readFileSync(path.join(rfcDir, file), "utf8"),
}));

/** Text of a "### heading" section up to the next heading. */
function section(text: string, heading: string): string {
  const start = text.indexOf(heading);
  if (start < 0) return "";
  const rest = text.slice(start + heading.length);
  const end = rest.search(/\n#{2,3} /);
  return end < 0 ? rest : rest.slice(0, end);
}

/** First-column backticked names of a Markdown table. */
function tableNames(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((line) => /^\|\s*`([A-Za-z_]+)`/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

function filesUnder(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full, pattern);
    return pattern.test(name) ? [full] : [];
  });
}

const apiSource = filesUnder(path.join(repo, "apps/api/src"), /\.ts$/)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

/** Code that would carry an implementation: every app and package, and the other tools. */
const codeFiles = [
  ...filesUnder(path.join(repo, "apps"), /\.(ts|tsx|sql|json)$/),
  ...filesUnder(path.join(repo, "packages"), /\.(ts|tsx|sql|json)$/),
  ...filesUnder(path.join(repo, "tools"), /\.(ts|sql)$/).filter(
    (f) => !f.includes(`${path.sep}repo-guards${path.sep}`),
  ),
];
const code = codeFiles.map((f) => readFileSync(f, "utf8")).join("\n");

/** Service request events are named from their type: "quote_accepted" → ServiceRequestQuoteAccepted. */
function existsInApi(event: string): boolean {
  if (apiSource.includes(`"${event}"`)) return true;
  const request = /^ServiceRequest([A-Z]\w*)$/.exec(event)?.[1];
  if (!request) return false;
  const type = request.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  return apiSource.includes(`type: "${type}"`);
}

describe("RFCs (Prompt 30)", () => {
  it("cover the six excluded modules", () => {
    expect(rfcFiles.map((f) => f.slice(0, 4))).toEqual([
      "0001",
      "0002",
      "0003",
      "0004",
      "0005",
      "0006",
    ]);
  });

  it.each(rfcs)("$file has every required section", ({ text }) => {
    for (const heading of [
      "- **Status:** Draft",
      "ADR-0011",
      "## Integration seams",
      "### Consumes (existing events)",
      "### Emits (proposed events",
      "## Event schemas",
      "## Migration path",
      "## Risks",
      "## Exit criteria",
    ]) {
      expect(text, heading).toContain(heading);
    }
  });

  it.each(rfcs)("$file only consumes events that exist in the API today", ({ text }) => {
    const consumed = tableNames(section(text, "### Consumes (existing events)"));
    expect(consumed.length).toBeGreaterThan(0);
    expect(consumed.filter((event) => !existsInApi(event))).toEqual([]);
  });

  it.each(rfcs)(
    "$file: every proposed event has a schema and exists nowhere in the code",
    ({ text }) => {
      const emitted = tableNames(section(text, "### Emits (proposed events"));
      expect(emitted.length).toBeGreaterThan(0);
      for (const event of emitted) {
        const schema = JSON.parse(
          readFileSync(path.join(eventsDir, `${event}.schema.json`), "utf8"),
        ) as {
          title: string;
          type: string;
          additionalProperties: boolean;
          required: string[];
          properties: Record<string, unknown>;
          "x-fleettrust": { status: string };
        };
        expect(schema.title).toBe(event);
        expect(schema["x-fleettrust"].status).toBe("proposed");
        expect(schema.type).toBe("object");
        expect(schema.additionalProperties).toBe(false);
        expect(schema.required.every((key) => key in schema.properties)).toBe(true);
        expect(code.includes(event), `${event} must not appear in code`).toBe(false);
      }
    },
  );

  it("every schema file belongs to an RFC", () => {
    const all = rfcs.map((r) => r.text).join("\n");
    const orphans = readdirSync(eventsDir)
      .map((f) => f.replace(".schema.json", ""))
      .filter((event) => !all.includes(`\`${event}\``));
    expect(orphans).toEqual([]);
  });

  it("no future table named in an RFC exists in a migration or the schema", () => {
    const futureTables = rfcs.flatMap(({ text }) => tableNames(section(text, "| Table (future)")));
    expect(futureTables.length).toBeGreaterThanOrEqual(10);
    const schema = [
      ...filesUnder(path.join(repo, "packages/db/migrations"), /\.sql$/),
      ...filesUnder(path.join(repo, "packages/db/src/schema"), /\.ts$/),
    ]
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    expect(futureTables.filter((table) => schema.includes(`"${table}"`))).toEqual([]);
  });
});
