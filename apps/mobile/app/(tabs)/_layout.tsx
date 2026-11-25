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
      accessibilityLabel="Emergency"
      accessibilityHint="Official emergency guidance and alerts to your trusted contacts"
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
      <Text style={{ color: theme.color.onDanger, fontWeight: "700" }}>Emergency</Text>
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
      <Tabs.Screen name="index" options={{ title: "Find help", tabBarLabel: "Find" }} />
      <Tabs.Screen name="requests" options={{ title: "Requests" }} />
      <Tabs.Screen name="messages" options={{ title: "Messages" }} />
      <Tabs.Screen name="community" options={{ title: "Community" }} />
      <Tabs.Screen name="account" options={{ title: "Account" }} />
    </Tabs>
  );
}
