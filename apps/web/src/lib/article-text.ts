import type { ArticleDocument } from "@fleettrust/types";

/** Plain text to an article document: blank lines separate paragraphs. */
export function textToDocument(text: string): ArticleDocument {
  return {
    type: "doc",
    content: text
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => ({
        type: "paragraph" as const,
        content: paragraph
          .split("\n")
          .flatMap((line, index) =>
            index === 0
              ? [{ type: "text" as const, text: line }]
              : [{ type: "hardBreak" as const }, { type: "text" as const, text: line }],
          )
          .filter((node) => node.type !== "text" || node.text !== ""),
      })),
  };
}
