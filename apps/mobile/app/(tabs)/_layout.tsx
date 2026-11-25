import { copy } from "@fleettrust/copy";
import { useRouter } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { Pressable, Text } from "react-native";

import { useTheme } from "../../src/components/theme";

/** Always one tap away, signed in or not (SRS J3). */
function EmergencyButton() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.tabs.emergency}
      accessibilityHint={copy.tabs.emergencyHint}
      onPress={() => {
        router.push("/emergency");
      }}
      style={{
        minHeight: theme.touchTarget,
        minWidth: theme.touchTarget,
        marginRight: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radii.md,
        backgroundColor: theme.color.danger,
        justifyContent: "center",
      }}
    >
      <Text style={{ color: theme.color.onDanger, fontWeight: "700" }}>{copy.tabs.emergency}</Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerRight: () => <EmergencyButton />,
        headerStyle: { backgroundColor: theme.color.background },
        headerTitleStyle: { color: theme.color.text },
        tabBarStyle: {
          backgroundColor: theme.color.background,
          borderTopColor: theme.color.border,
        },
        tabBarActiveTintColor: theme.color.primary,
        tabBarInactiveTintColor: theme.color.textMuted,
        // Text labels only (no icon font): readable, scalable and announced as-is.
        tabBarIconStyle: { display: "none" },
        tabBarLabelStyle: { fontSize: theme.type.fontSize.sm, fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: copy.tabs.findTitle, tabBarLabel: copy.tabs.find }}
      />
      <Tabs.Screen name="requests" options={{ title: copy.tabs.requests }} />
      <Tabs.Screen name="messages" options={{ title: copy.tabs.messages }} />
      <Tabs.Screen name="community" options={{ title: copy.tabs.community }} />
      <Tabs.Screen name="account" options={{ title: copy.tabs.account }} />
    </Tabs>
  );
}
