import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { getApp } from "@react-native-firebase/app";
import {
  getToken as getAppCheckToken,
  initializeAppCheck,
  type AppCheck,
} from "@react-native-firebase/app-check";
import {
  connectAuthEmulator,
  getAuth,
  getIdToken,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
} from "@react-native-firebase/auth";
import { getId, getInstallations } from "@react-native-firebase/installations";
import {
  getInitialNotification,
  getMessaging,
  onMessage,
  onNotificationOpenedApp,
  type RemoteMessage,
} from "@react-native-firebase/messaging";
import { randomUUID } from "expo-crypto";
import * as Location from "expo-location";
import { Linking, Platform as RNPlatform } from "react-native";
import {
  checkNotifications,
  type PermissionStatus,
  requestNotifications,
  RESULTS,
} from "react-native-permissions";

import { mobileEnv } from "../env";
import type { Platform, PushMessage, PushPermission } from "./types";

function toPushMessage(message: RemoteMessage): PushMessage {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(message.data ?? {})) {
    if (typeof value === "string") data[key] = value;
  }
  return {
    title: message.notification?.title ?? null,
    body: message.notification?.body ?? null,
    data,
  };
}

/**
 * react-native-permissions statuses: "denied" means the prompt can still be shown (iOS: not
 * asked yet; Android 13+: not granted yet), "blocked" means only Settings can change it.
 * Android 12 and older grant notifications without a prompt.
 */
function toPushPermission(status: PermissionStatus): PushPermission {
  if (status === RESULTS.GRANTED || status === RESULTS.LIMITED) return "granted";
  return status === RESULTS.DENIED ? "undetermined" : "denied";
}

let appCheck: AppCheck | null = null;

/** Real device adapters. Created once, in the root layout. */
export function createNativePlatform(): Platform {
  const auth = getAuth();
  if (mobileEnv.authEmulatorHost) {
    connectAuthEmulator(auth, `http://${mobileEnv.authEmulatorHost}`);
  }
  const messaging = getMessaging();
  // App Check: Play Integrity / App Attest in release builds, the debug provider in local and
  // test builds (its debug token is registered in the Firebase console, never in the app).
  const debug = mobileEnv.appEnv === "local" || mobileEnv.appEnv === "test";
  appCheck ??= initializeAppCheck(getApp(), {
    provider: {
      providerOptions: {
        android: { provider: debug ? "debug" : "playIntegrity" },
        apple: { provider: debug ? "debug" : "appAttestWithDeviceCheckFallback" },
      },
    },
    isTokenAutoRefreshEnabled: true,
  });

  return {
    auth: {
      subscribe: (listener) =>
        onAuthStateChanged(auth, (user) => {
          listener(user ? { uid: user.uid, email: user.email } : null);
        }),
      idToken: async () => (auth.currentUser ? getIdToken(auth.currentUser) : null),
      sendSignInLink: (email, settings) => sendSignInLinkToEmail(auth, email, settings),
      isSignInLink: (url) => isSignInWithEmailLink(auth, url),
      completeSignInLink: async (email, url) => {
        await signInWithEmailLink(auth, email, url);
      },
      signOut: () => signOut(auth),
    },
    push: {
      permission: async () => toPushPermission((await checkNotifications()).status),
      requestPermission: async () =>
        toPushPermission((await requestNotifications(["alert", "sound", "badge"])).status),
      installationId: () => getId(getInstallations()),
      onForegroundMessage: (listener) =>
        onMessage(messaging, (message) => {
          listener(toPushMessage(message));
        }),
      onNotificationOpened: (listener) =>
        onNotificationOpenedApp(messaging, (message) => {
          listener(toPushMessage(message));
        }),
      initialNotification: async () => {
        const message = await getInitialNotification(messaging);
        return message ? toPushMessage(message) : null;
      },
    },
    location: {
      permission: async () => {
        const result = await Location.getForegroundPermissionsAsync();
        if (result.status === Location.PermissionStatus.GRANTED) return "granted";
        if (result.status === Location.PermissionStatus.UNDETERMINED) return "undetermined";
        return result.canAskAgain ? "denied" : "blocked";
      },
      requestPermission: async () => {
        const result = await Location.requestForegroundPermissionsAsync();
        if (result.status === Location.PermissionStatus.GRANTED) return "granted";
        return result.canAskAgain ? "denied" : "blocked";
      },
      current: async () => {
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        return {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        };
      },
    },
    storage: {
      get: (key) => AsyncStorage.getItem(key),
      set: (key, value) => AsyncStorage.setItem(key, value),
      remove: (key) => AsyncStorage.removeItem(key),
      keys: () => AsyncStorage.getAllKeys(),
    },
    network: {
      subscribe: (listener) =>
        NetInfo.addEventListener((state) => {
          // isInternetReachable is null while unknown; only "false" means offline.
          listener(state.isConnected !== false && state.isInternetReachable !== false);
        }),
    },
    device: {
      os: RNPlatform.OS === "ios" ? "ios" : "android",
      openSettings: () => Linking.openSettings(),
      openExternal: async (url) => {
        if (!/^(?:tel:|mailto:|https:)/i.test(url)) return;
        await Linking.openURL(url);
      },
      appCheckToken: async () => {
        if (!appCheck) return null;
        try {
          return (await getAppCheckToken(appCheck)).token;
        } catch {
          // The API rejects requests without a valid token when enforcement is on; the
          // request then fails with a clear error instead of the app crashing here.
          return null;
        }
      },
      randomId: () => randomUUID(),
    },
  };
}
