import type { ArticleBlock, ArticleDocument, ArticleInline } from "@fleettrust/types";
import { Text, View } from "react-native";

import { useSession } from "../state/session";
import { useTheme } from "./theme";

/**
 * Renders the article document (a strict ProseMirror subset, validated by the API) with
 * native text. No HTML or web view, so nothing in an article can run code in the app.
 * Links open in the browser and only for https/mailto.
 */
export function ArticleBody({ document }: { document: ArticleDocument }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.md }}>
      {document.content.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </View>
  );
}

function Inline({ nodes }: { nodes: readonly ArticleInline[] | undefined }) {
  const theme = useTheme();
  const { platform } = useSession();
  return (
    <>
      {(nodes ?? []).map((node, index) => {
        if (node.type === "hardBreak") return "\n";
        const marks = node.marks ?? [];
        const link = marks.find((mark) => mark.type === "link");
        const href =
          link?.type === "link" && /^(?:https:|mailto:)/i.test(link.attrs.href)
            ? link.attrs.href
            : null;
        return (
          <Text
            key={index}
            accessibilityRole={href ? "link" : undefined}
            onPress={href ? () => void platform.device.openExternal(href) : undefined}
            style={{
              fontWeight: marks.some((mark) => mark.type === "bold") ? "700" : undefined,
              fontStyle: marks.some((mark) => mark.type === "italic") ? "italic" : undefined,
              fontFamily: marks.some((mark) => mark.type === "code") ? "monospace" : undefined,
              color: href ? theme.color.primary : undefined,
              textDecorationLine: href ? "underline" : undefined,
            }}
          >
            {node.text}
          </Text>
        );
      })}
    </>
  );
}

function Block({ block, prefix }: { block: ArticleBlock; prefix?: string }) {
  const theme = useTheme();
  const text = {
    color: theme.color.text,
    fontSize: theme.type.fontSize.md,
    lineHeight: theme.type.lineHeight.md,
  };
  switch (block.type) {
    case "paragraph":
      return (
        <Text style={text}>
          {prefix}
          <Inline nodes={block.content} />
        </Text>
      );
    case "heading":
      return (
        <Text
          accessibilityRole="header"
          style={{ ...text, fontSize: theme.type.fontSize.lg, fontWeight: "700" }}
        >
          <Inline nodes={block.content} />
        </Text>
      );
    case "bulletList":
    case "orderedList":
      return (
        <View style={{ gap: theme.spacing.xs }}>
          {block.content.map((item, index) =>
            item.content.map((child, childIndex) => (
              <Block
                key={`${String(index)}-${String(childIndex)}`}
                block={child}
                prefix={
                  childIndex === 0
                    ? block.type === "bulletList"
                      ? "• "
                      : `${String(index + 1)}. `
                    : undefined
                }
              />
            )),
          )}
        </View>
      );
    case "blockquote":
      return (
        <View
          style={{
            borderLeftWidth: 3,
            borderLeftColor: theme.color.border,
            paddingLeft: theme.spacing.md,
            gap: theme.spacing.sm,
          }}
        >
          {block.content.map((child, index) => (
            <Block key={index} block={child} />
          ))}
        </View>
      );
    case "codeBlock":
      return (
        <Text
          style={{
            ...text,
            fontFamily: "monospace",
            backgroundColor: theme.color.surface,
            padding: theme.spacing.sm,
          }}
        >
          {(block.content ?? []).map((node) => node.text).join("")}
        </Text>
      );
    case "horizontalRule":
      return <View style={{ height: 1, backgroundColor: theme.color.border }} />;
    case "image":
      return (
        <Text style={{ ...text, color: theme.color.textMuted }}>
          {block.attrs.alt ? `[Image: ${block.attrs.alt}]` : "[Image]"}
        </Text>
      );
  }
}
