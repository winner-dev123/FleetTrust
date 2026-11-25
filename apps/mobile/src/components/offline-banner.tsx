import { Text, View } from "react-native";

import { useOnline } from "../state/network";
import { useTheme } from "./theme";

/** A slim bar shown on every screen while the phone is offline. */
export function OfflineBanner() {
  const online = useOnline();
  const theme = useTheme();
  if (online) return null;
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: theme.color.surface,
        borderBottomWidth: 3,
        borderBottomColor: theme.color.caution,
        paddingVertical: 6,
        paddingHorizontal: theme.spacing.lg,
      }}
      testID="offline-banner"
    >
      <Text style={{ color: theme.color.text, fontSize: theme.type.fontSize.sm }}>
        You&apos;re offline. Drafts are saved and messages will send when you&apos;re back.
      </Text>
    </View>
  );
}
