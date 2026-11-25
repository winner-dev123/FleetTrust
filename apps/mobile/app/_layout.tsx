import { copy } from "@fleettrust/copy";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ConsentGate } from "../src/components/consent-gate";
import { useTheme } from "../src/components/theme";
import { getRuntime } from "../src/platform/runtime";
import { NetworkProvider } from "../src/state/network";
import { PushListener } from "../src/state/push-listener";
import { SessionProvider } from "../src/state/session";

/** Root of the app: device runtime, session, network state, push handling and the stack. */
export default function RootLayout() {
  const [runtime] = useState(getRuntime);
  const theme = useTheme();
  return (
    <SafeAreaProvider>
      <SessionProvider runtime={runtime}>
        <NetworkProvider>
          <Stack
            screenOptions={{
              headerBackTitle: "Back",
              headerStyle: { backgroundColor: theme.color.background },
              headerTintColor: theme.color.primary,
              headerTitleStyle: { color: theme.color.text },
              contentStyle: { backgroundColor: theme.color.background },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="providers/[slug]" options={{ title: copy.screens.provider }} />
            <Stack.Screen name="articles/[slug]" options={{ title: copy.screens.article }} />
            <Stack.Screen name="requests/new" options={{ title: copy.screens.requestQuote }} />
            <Stack.Screen name="requests/[id]" options={{ title: copy.screens.request }} />
            <Stack.Screen name="messages/[id]" options={{ title: copy.screens.conversation }} />
            <Stack.Screen name="notifications" options={{ title: copy.screens.notifications }} />
            <Stack.Screen name="emergency/index" options={{ title: copy.screens.emergency }} />
            <Stack.Screen name="emergency/[id]" options={{ title: copy.screens.yourAlert }} />
            <Stack.Screen
              name="emergency/contacts"
              options={{ title: copy.screens.trustedContacts }}
            />
            <Stack.Screen name="sign-in" options={{ title: copy.screens.signIn }} />
            <Stack.Screen name="auth/finish" options={{ title: copy.screens.signingIn }} />
          </Stack>
          <PushListener />
          <ConsentGate />
          <StatusBar style="auto" />
        </NetworkProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
