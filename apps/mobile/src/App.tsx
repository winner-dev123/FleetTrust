import { colors, spacing, typography } from "@fleettrust/ui";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, useColorScheme, View } from "react-native";

import { mobileEnv } from "./env";

export default function App() {
  const palette = colors[useColorScheme() === "dark" ? "dark" : "light"];

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
        FleetTrust
      </Text>
      <Text style={[styles.body, { color: palette.textMuted }]}>
        Find vehicle services, request quotes and get help on the road.
      </Text>
      <Text style={[styles.body, { color: palette.caution }]}>
        Pre-release foundation build. No features are available yet.
      </Text>
      {mobileEnv.appEnv !== "production" ? (
        <Text style={[styles.small, { color: palette.textMuted }]}>
          Environment: {mobileEnv.appEnv}
        </Text>
      ) : null}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  title: {
    fontSize: typography.fontSize.xl,
    lineHeight: typography.lineHeight.xl,
    fontWeight: typography.fontWeight.bold,
  },
  body: {
    fontSize: typography.fontSize.md,
    lineHeight: typography.lineHeight.md,
  },
  small: {
    fontSize: typography.fontSize.sm,
    lineHeight: typography.lineHeight.sm,
  },
});
