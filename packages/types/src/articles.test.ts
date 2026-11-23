import { describe, expect, it } from "vitest";

import {
  analyzeArticle,
  articleDocumentSchema,
  createArticleSchema,
  escapeHtml,
  findRatingContent,
  plainTextLinks,
  renderArticleHtml,
  safeHref,
} from "./articles.js";

const text = (value: string, marks?: object[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});

describe("safeHref", () => {
  it("allows absolute http(s) and mailto only", () => {
    expect(safeHref("https://example.org/a b")).toBeNull();
    expect(safeHref("https://example.org/path?q=1")).toBe("https://example.org/path?q=1");
    expect(safeHref("HTTP://EXAMPLE.org")).toBe("http://example.org/");
    expect(safeHref("mailto:help@example.org")).toBe("mailto:help@example.org");
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "java\nscript:alert(1)",
      "\u0000javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "file:///etc/passwd",
      "//example.org",
      "example.org",
      "https://a:b@example.org",
      "mailto:",
    ]) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });
});

describe("findRatingContent", () => {
  it("flags scores and star ratings", () => {
    for (const value of [
      "★★★★☆",
      "⭐⭐⭐",
      "5 stars",
      "a 4.5-star workshop",
      "8 out of 10 stars",
      "rated 2/10",
      "Score: 3 out of 5",
    ]) {
      expect(findRatingContent(value), value).not.toBeNull();
    }
  });

  it("leaves ordinary technical text alone", () => {
    for (const value of [
      "We drove 5 hours to Durban",
      "The trailer was 4/5 full",
      "Starter motor replaced",
      "Load rating 10 tonnes per axle",
      "Check the spare ★ before you leave",
    ]) {
      expect(findRatingContent(value), value).toBeNull();
    }
  });
});

describe("article documents", () => {
  it("accepts the supported nodes and normalises links", () => {
    const doc = articleDocumentSchema.parse({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [text("Brakes")] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    text("See ", []),
                    text("rules", [{ type: "link", attrs: { href: "HTTPS://Gov.example" } }]),
                  ],
                },
              ],
            },
          ],
        },
        { type: "blockquote", content: [{ type: "paragraph", content: [text("Quote")] }] },
        { type: "codeBlock", content: [{ type: "text", text: "line 1\nline 2" }] },
        { type: "horizontalRule" },
        { type: "image", attrs: { imageId: "0196f2a8-6b7c-7d00-9e00-1a2b3c4d5e6f", alt: null } },
      ],
    });
    const analysis = analyzeArticle(doc);
    expect(analysis.links).toEqual(["https://gov.example/"]);
    expect(analysis.imageIds).toEqual(["0196f2a8-6b7c-7d00-9e00-1a2b3c4d5e6f"]);
    expect(analysis.depth).toBe(2);
    expect(analysis.text).toBe("Brakes\nSee rules\nQuote\nline 1\nline 2");
  });

  it("refuses unknown nodes, attributes and duplicate marks", () => {
    for (const content of [
      [{ type: "script", text: "alert(1)" }],
      [{ type: "paragraph", content: [{ type: "text", text: "x", attrs: { class: "y" } }] }],
      [{ type: "paragraph", content: [text("x", [{ type: "bold" }, { type: "bold" }])] }],
      [{ type: "paragraph", content: [text("x", [{ type: "underline" }])] }],
      [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
      [{ type: "paragraph", content: [text("x\u0000")] }],
    ]) {
      expect(articleDocumentSchema.safeParse({ type: "doc", content }).success).toBe(false);
    }
  });

  it("renders escaped HTML and drops images that weren't resolved", () => {
    const doc = articleDocumentSchema.parse({
      type: "doc",
      content: [
        { type: "paragraph", content: [text("<b>&</b>", [{ type: "italic" }])] },
        { type: "image", attrs: { imageId: "0196f2a8-6b7c-7d00-9e00-1a2b3c4d5e6f", alt: "x" } },
      ],
    });
    expect(renderArticleHtml(doc)).toBe("<p><em>&lt;b&gt;&amp;&lt;/b&gt;</em></p>");
    expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
  });
});

describe("createArticleSchema", () => {
  it("normalises tags and refuses unknown fields", () => {
    const parsed = createArticleSchema.parse({
      title: "  Tyres  ",
      tags: ["Tyres", "tyres", "pre-trip"],
    });
    expect(parsed.title).toBe("Tyres");
    expect(parsed.tags).toEqual(["tyres", "pre-trip"]);
    expect(createArticleSchema.safeParse({ title: "x", rating: 5 }).success).toBe(false);
    expect(createArticleSchema.safeParse({ title: "x", tags: ["no spaces"] }).success).toBe(false);
  });

  it("counts plain-text links", () => {
    expect(plainTextLinks("see https://a.example, www.b.example and c.example")).toHaveLength(2);
  });
});
