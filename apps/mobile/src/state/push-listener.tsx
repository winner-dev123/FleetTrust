import { notificationPath } from "@fleettrust/types";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { Body, Button, Notice } from "../components/ui";
import { parseUrl, webPathToAppPath } from "../lib/links";
import type { PushMessage } from "../platform/types";
import { useSession } from "./session";

/** The screen a push message opens: the record it's about, else the notifications list. */
export function pushTarget(data: Readonly<Record<string, string>>): string {
  const web = notificationPath(data);
  if (web === null) return "/notifications";
  const [path = "/", query = ""] = web.split("?", 2);
  const parsed = parseUrl(`https://app${path}?${query}`);
  return (parsed && webPathToAppPath(parsed.path, parsed.query)) ?? "/notifications";
}

/**
 * Notification behaviour (ADR-0032):
 * - app quit, notification tapped: the app starts on the matching screen;
 * - app in the background, tapped: it comes forward on the matching screen;
 * - app open: the OS shows nothing, so a banner appears at the top with "Open" and "Dismiss".
 * Signed-out taps land on the screen, which asks the person to sign in first.
 */
export function PushListener() {
  const { platform, status } = useSession();
  const router = useRouter();
  const [banner, setBanner] = useState<PushMessage | null>(null);

  useEffect(() => {
    let active = true;
    void platform.push
      .initialNotification()
      .then((message) => {
        if (active && message) router.push(pushTarget(message.data));
      })
      .catch(() => undefined);
    const offOpened = platform.push.onNotificationOpened((message) => {
      router.push(pushTarget(message.data));
    });
    const offForeground = platform.push.onForegroundMessage(setBanner);
    return () => {
      active = false;
      offOpened();
      offForeground();
    };
  }, [platform, router]);

  if (!banner || status !== "signed-in") return null;
  return (
    <View
      style={{ position: "absolute", left: 8, right: 8, top: 56, zIndex: 10 }}
      testID="push-banner"
    >
      <Notice title={banner.title ?? "FleetTrust"} live>
        {banner.body ? <Body>{banner.body}</Body> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button
            label="Open"
            onPress={() => {
              const target = pushTarget(banner.data);
              setBanner(null);
              router.push(target);
            }}
          />
          <Button
            label="Dismiss"
            variant="ghost"
            onPress={() => {
              setBanner(null);
            }}
          />
        </View>
      </Notice>
    </View>
  );
}
