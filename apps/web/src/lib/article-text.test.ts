import { articleDocumentSchema } from "@fleettrust/types";
import { describe, expect, it } from "vitest";

import { textToDocument } from "./article-text";

describe("textToDocument", () => {
  it("turns blank-line paragraphs into a valid article document", () => {
    const doc = textToDocument(
      "Check tyre pressure monthly.\nCold tyres read lower.\n\n\nRotate every 10 000 km.",
    );
    expect(doc.content).toHaveLength(2);
    expect(doc.content[0]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "Check tyre pressure monthly." },
        { type: "hardBreak" },
        { type: "text", text: "Cold tyres read lower." },
      ],
    });
    expect(articleDocumentSchema.safeParse(doc).success).toBe(true);
  });
});
