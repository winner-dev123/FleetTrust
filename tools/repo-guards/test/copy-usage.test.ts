import { describe, expect, it } from "vitest";

import { catalogKeys, checkCopyUsage, usedPaths } from "../src/copy-usage.ts";

const catalog = [
  {
    path: "packages/copy/src/web.ts",
    content: [
      "export const web = {",
      "  home: { title: 'Home', intro: 'Welcome' },",
      "  days: { mon: 'Monday', tue: 'Tuesday' },",
      "} as const;",
    ].join("\n"),
  },
  {
    path: "packages/copy/src/en.ts",
    content: [
      'import { web } from "./web.js";',
      "export const en = {",
      "  common: { save: 'Save', cancel: 'Cancel' },",
      "  items: { one: '{count} item', other: '{count} items' },",
      "  legacy: 'Kept', // copy-unused: read by the old app until 2027",
      "  web,",
      "} as const;",
    ].join("\n"),
  },
];

const screen = (content: string) => ({
  path: "apps/web/src/page.tsx",
  content: `import { copy, plural } from "@fleettrust/copy";\n${content}`,
});

describe("catalogKeys", () => {
  it("lists every message, following composed objects, and honours copy-unused", () => {
    expect(catalogKeys(catalog).map((k) => k.key)).toEqual([
      "common.save",
      "common.cancel",
      "items.one",
      "items.other",
      "web.home.title",
      "web.home.intro",
      "web.days.mon",
      "web.days.tue",
    ]);
  });

  it("points at the line that defines the message", () => {
    expect(catalogKeys(catalog).find((k) => k.key === "web.home.intro")).toMatchObject({
      path: "packages/copy/src/web.ts",
      line: 2,
    });
  });
});

describe("usedPaths", () => {
  it("follows aliases, aliases of aliases, literal indexing and destructuring", () => {
    const paths = usedPaths(
      screen(
        [
          "const t = copy.web;",
          "const h = t.home;",
          "export const a = h.title;",
          'export const b = copy["common"]["cancel"];',
          "const { save } = copy.common;",
          "export const c = save;",
        ].join("\n"),
      ),
    );
    expect(paths.sort()).toEqual(["common.cancel", "common.save", "web.home.title"]);
  });

  it("counts a group read as a whole (plural, dynamic index)", () => {
    const paths = usedPaths(
      screen(
        [
          "const DAYS = copy.web.days;",
          "export const a = (d: 'mon') => DAYS[d];",
          "export const b = (n: number) => plural(n, copy.items);",
        ].join("\n"),
      ),
    );
    expect(paths.sort()).toEqual(["items", "web.days"]);
  });

  it("ignores types, property names and files that don't import the catalog", () => {
    expect(
      usedPaths(screen("type T = typeof copy.web.home;\nexport const x = { copy: 1 }.copy;")),
    ).toEqual([]);
    expect(
      usedPaths({ path: "apps/api/src/x.ts", content: "const copy = { a: 1 }; copy.a;" }),
    ).toEqual([]);
  });
});

describe("checkCopyUsage", () => {
  it("reports messages no screen reads", () => {
    const sources = [
      screen(
        [
          "const t = copy.web.home;",
          "export const a = t.title.toUpperCase();",
          "export const b = (n: number) => plural(n, copy.items);",
          "export const c = copy.web.days;",
          "export const d = copy.common.cancel;",
        ].join("\n"),
      ),
    ];
    expect(
      checkCopyUsage(catalog, sources).map((v) => `${v.path}:${String(v.line)} ${v.detail}`),
    ).toEqual([
      "packages/copy/src/en.ts:3 copy.common.save is not used by any screen",
      "packages/copy/src/web.ts:2 copy.web.home.intro is not used by any screen",
    ]);
  });

  it("passes when everything is read", () => {
    const sources = [screen("export const all = copy;")];
    expect(checkCopyUsage(catalog, sources)).toEqual([]);
  });
});
