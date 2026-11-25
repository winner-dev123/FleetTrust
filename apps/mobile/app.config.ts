import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Expo app config (ADR-0032). Values that differ per environment come from build-time env:
 *
 * - EXPO_PUBLIC_WEB_URL / EXPO_PUBLIC_LINK_DOMAIN: hosts for universal links (iOS) and
 *   verified app links (Android). Those hosts must serve apple-app-site-association and
 *   assetlinks.json (owner item: Apple Team ID and the Play signing certificate).
 * - GOOGLE_SERVICES_JSON / GOOGLE_SERVICE_INFO_PLIST: paths to the Firebase config files for
 *   the target project (EAS file secrets). They are only read during `expo prebuild`; never
 *   commit them. Defaults point at the git-ignored ./firebase folder.
 *
 * Permissions are kept to what the app uses: foreground location, notifications, network.
 * Background location is blocked on both platforms.
 */

const BUNDLE_ID = "com.fleettrust.app";

/** Paths the app handles; other URLs on the web origin stay in the browser. */
export const APP_LINK_PATHS = [
  "/app",
  "/providers",
  "/articles",
  "/search",
  "/emergency",
  "/auth/finish",
  "/sign-in",
] as const;

function host(url: string | undefined): string | null {
  const match = url ? /^https:\/\/([a-z0-9.-]+)(?::\d+)?\/?$/i.exec(url) : null;
  return match?.[1]?.toLowerCase() ?? null;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const env = process.env as Record<string, string | undefined>;
  const linkHosts = [
    host(env["EXPO_PUBLIC_WEB_URL"]),
    env["EXPO_PUBLIC_LINK_DOMAIN"] ?? null,
  ].filter(
    (value, index, all): value is string =>
      value !== null && value !== "" && all.indexOf(value) === index,
  );

  return {
    ...config,
    name: "FleetTrust",
    slug: "fleettrust",
    scheme: "fleettrust",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    platforms: ["ios", "android"],
    ios: {
      bundleIdentifier: BUNDLE_ID,
      supportsTablet: true,
      googleServicesFile: env["GOOGLE_SERVICE_INFO_PLIST"] ?? "./firebase/GoogleService-Info.plist",
      associatedDomains: linkHosts.map((value) => `applinks:${value}`),
      infoPlist: {
        // Push arrives through FCM/APNs; no other background work.
        UIBackgroundModes: ["remote-notification"],
      },
    },
    android: {
      package: BUNDLE_ID,
      googleServicesFile: env["GOOGLE_SERVICES_JSON"] ?? "./firebase/google-services.json",
      permissions: [
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.POST_NOTIFICATIONS",
      ],
      blockedPermissions: [
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.RECORD_AUDIO",
        "android.permission.SYSTEM_ALERT_WINDOW",
      ],
      intentFilters:
        linkHosts.length === 0
          ? []
          : [
              {
                action: "VIEW",
                autoVerify: true,
                category: ["BROWSABLE", "DEFAULT"],
                data: linkHosts.flatMap((value) =>
                  APP_LINK_PATHS.map((pathPrefix) => ({
                    scheme: "https",
                    host: value,
                    pathPrefix,
                  })),
                ),
              },
            ],
    },
    plugins: [
      "expo-router",
      [
        "expo-location",
        {
          locationWhenInUsePermission:
            "FleetTrust uses your location while you use the app to find help near you and, if you choose, to share it with an emergency alert.",
          locationAlwaysAndWhenInUsePermission: false,
          locationAlwaysPermission: false,
          motionUsagePermission: false,
          isIosBackgroundLocationEnabled: false,
          isAndroidBackgroundLocationEnabled: false,
          isAndroidForegroundServiceEnabled: false,
        },
      ],
      "@react-native-firebase/app",
      "@react-native-firebase/auth",
      "@react-native-firebase/messaging",
      "@react-native-firebase/app-check",
      // Notification permission prompt (iOS); Android 13+ uses POST_NOTIFICATIONS above.
      ["react-native-permissions", { iosPermissions: ["Notifications"] }],
      // React Native Firebase needs static frameworks on iOS.
      ["expo-build-properties", { ios: { useFrameworks: "static" } }],
      "expo-dev-client",
    ],
    experiments: { typedRoutes: false },
  };
};
