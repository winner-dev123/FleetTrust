import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { OfflineBanner } from "./offline-banner";
import { useTheme } from "./theme";

/**
 * Mobile design system (ADR-0032), built on the shared tokens. Accessibility is built in:
 * every control has a role and a name, touch targets are at least 44 dp, text scales with
 * the system font size, and state (busy, selected, disabled) is announced.
 */

export function Screen({
  children,
  scroll = true,
  testID,
}: {
  children: ReactNode;
  scroll?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  const content = (
    <View style={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}>{children}</View>
  );
  return (
    <SafeAreaView
      edges={["left", "right"]}
      style={{ flex: 1, backgroundColor: theme.color.background }}
      testID={testID}
    >
      <OfflineBanner />
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled">{content}</ScrollView> : content}
    </SafeAreaView>
  );
}

export function Heading({ children, level = 1 }: { children: ReactNode; level?: 1 | 2 }) {
  const theme = useTheme();
  const size = level === 1 ? "xl" : "lg";
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: theme.color.text,
        fontSize: theme.type.fontSize[size],
        lineHeight: theme.type.lineHeight[size],
        fontWeight: theme.type.fontWeight.bold,
      }}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted = false,
  small = false,
  tone,
}: {
  children: ReactNode;
  muted?: boolean;
  small?: boolean;
  tone?: "danger" | "caution" | "verified";
}) {
  const theme = useTheme();
  const size = small ? "sm" : "md";
  const color = tone ? theme.color[tone] : muted ? theme.color.textMuted : theme.color.text;
  return (
    <Text
      style={{
        color,
        fontSize: theme.type.fontSize[size],
        lineHeight: theme.type.lineHeight[size],
      }}
    >
      {children}
    </Text>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  label,
  onPress,
  variant = "primary",
  busy = false,
  disabled = false,
  hint,
  large = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  busy?: boolean;
  disabled?: boolean;
  /** Read by screen readers after the label, e.g. what happens next. */
  hint?: string;
  large?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  const inactive = disabled || busy;
  const background =
    variant === "primary"
      ? theme.color.primary
      : variant === "danger"
        ? theme.color.danger
        : "transparent";
  const foreground =
    variant === "primary"
      ? theme.color.onPrimary
      : variant === "danger"
        ? theme.color.onDanger
        : theme.color.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: large ? 56 : theme.touchTarget,
        minWidth: theme.touchTarget,
        paddingHorizontal: theme.spacing.lg,
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "row",
        gap: theme.spacing.sm,
        borderRadius: theme.radii.md,
        backgroundColor: background,
        borderWidth: variant === "secondary" ? 2 : 0,
        borderColor: theme.color.primary,
        opacity: inactive ? 0.6 : pressed ? 0.85 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={foreground} /> : null}
      <Text
        style={{
          color: foreground,
          fontSize: theme.type.fontSize[large ? "lg" : "md"],
          fontWeight: theme.type.fontWeight.bold,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function TextField({
  label,
  hint,
  error,
  optional = false,
  ...input
}: Omit<TextInputProps, "accessibilityLabel" | "style"> & {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text
        style={{
          color: theme.color.text,
          fontWeight: theme.type.fontWeight.bold,
          fontSize: theme.type.fontSize.md,
        }}
      >
        {label}
        {optional ? " (optional)" : ""}
      </Text>
      {hint ? (
        <Body small muted>
          {hint}
        </Body>
      ) : null}
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={[hint, error].filter(Boolean).join(". ") || undefined}
        placeholderTextColor={theme.color.textMuted}
        style={{
          minHeight: input.multiline ? 96 : theme.touchTarget,
          borderWidth: 2,
          borderColor: error ? theme.color.danger : theme.color.borderStrong,
          borderRadius: theme.radii.md,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          color: theme.color.text,
          backgroundColor: theme.color.background,
          fontSize: theme.type.fontSize.md,
          textAlignVertical: input.multiline ? "top" : "center",
        }}
        {...input}
      />
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: theme.color.danger, fontSize: theme.type.fontSize.sm }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** A single-choice list (radio group) with large rows. */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ gap: theme.spacing.sm }}
    >
      <Text
        style={{
          color: theme.color.text,
          fontWeight: theme.type.fontWeight.bold,
          fontSize: theme.type.fontSize.md,
        }}
      >
        {label}
      </Text>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            onPress={() => {
              onChange(option.value);
            }}
            style={{
              minHeight: theme.touchTarget,
              flexDirection: "row",
              alignItems: "center",
              gap: theme.spacing.md,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radii.md,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? theme.color.primary : theme.color.border,
              backgroundColor: theme.color.surface,
            }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                borderWidth: 2,
                borderColor: theme.color.borderStrong,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {selected ? (
                <View
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: theme.color.primary,
                  }}
                />
              ) : null}
            </View>
            <Body>{option.label}</Body>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value }}
      onPress={() => {
        onChange(!value);
      }}
      style={{
        minHeight: theme.touchTarget,
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.md,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: theme.radii.sm,
          borderWidth: 2,
          borderColor: theme.color.borderStrong,
          backgroundColor: value ? theme.color.primary : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {value ? <Text style={{ color: theme.color.onPrimary, fontWeight: "700" }}>✓</Text> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Body>{label}</Body>
        {hint ? (
          <Body small muted>
            {hint}
          </Body>
        ) : null}
      </View>
    </Pressable>
  );
}

type NoticeTone = "info" | "danger" | "caution" | "success";

/** A message box. `live` notices are announced by screen readers when they appear. */
export function Notice({
  title,
  children,
  tone = "info",
  live = false,
}: {
  title?: string;
  children?: ReactNode;
  tone?: NoticeTone;
  live?: boolean;
}) {
  const theme = useTheme();
  const accent =
    tone === "danger"
      ? theme.color.danger
      : tone === "caution"
        ? theme.color.caution
        : tone === "success"
          ? theme.color.verified
          : theme.color.primary;
  return (
    <View
      accessible={live}
      accessibilityRole={live ? (tone === "danger" ? "alert" : "summary") : undefined}
      accessibilityLiveRegion={live ? (tone === "danger" ? "assertive" : "polite") : "none"}
      style={{
        borderLeftWidth: 4,
        borderLeftColor: accent,
        backgroundColor: theme.color.surface,
        padding: theme.spacing.md,
        borderRadius: theme.radii.md,
        gap: theme.spacing.xs,
      }}
    >
      {title ? (
        <Text
          style={{
            color: theme.color.text,
            fontWeight: theme.type.fontWeight.bold,
            fontSize: theme.type.fontSize.md,
          }}
        >
          {title}
        </Text>
      ) : null}
      {typeof children === "string" ? <Body>{children}</Body> : children}
    </View>
  );
}

export function Card({ children, title }: { children: ReactNode; title?: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.color.surface,
        borderColor: theme.color.border,
        borderWidth: 1,
        borderRadius: theme.radii.lg,
        padding: theme.spacing.lg,
        gap: theme.spacing.sm,
      }}
    >
      {title ? <Heading level={2}>{title}</Heading> : null}
      {children}
    </View>
  );
}

export function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "verified" | "caution" | "danger" | "neutral";
}) {
  const theme = useTheme();
  const color =
    tone === "verified"
      ? theme.color.verified
      : tone === "caution"
        ? theme.color.caution
        : tone === "danger"
          ? theme.color.danger
          : theme.color.textMuted;
  return (
    <View
      style={{
        alignSelf: "flex-start",
        borderWidth: 1,
        borderColor: color,
        borderRadius: theme.radii.pill,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 2,
      }}
    >
      <Text
        style={{
          color,
          fontSize: theme.type.fontSize.sm,
          fontWeight: theme.type.fontWeight.medium,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ padding: theme.spacing.xl, alignItems: "center", gap: theme.spacing.sm }}
    >
      <ActivityIndicator color={theme.color.primary} />
      <Body muted>{label}</Body>
    </View>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm, alignItems: "flex-start" }}>
      <Heading level={2}>{title}</Heading>
      {typeof children === "string" ? <Body muted>{children}</Body> : children}
    </View>
  );
}

/** A tappable row that opens something (a result, a conversation, a request). */
export function ListRow({
  title,
  subtitle,
  detail,
  onPress,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string | null;
  detail?: ReactNode;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(", ")}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.touchTarget,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radii.md,
        backgroundColor: pressed ? theme.color.border : theme.color.surface,
        gap: theme.spacing.xs,
      })}
    >
      <Text
        style={{
          color: theme.color.text,
          fontSize: theme.type.fontSize.md,
          fontWeight: theme.type.fontWeight.bold,
        }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Body small muted>
          {subtitle}
        </Body>
      ) : null}
      {detail}
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
});
