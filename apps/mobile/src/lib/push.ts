import type { ApiClient } from "@fleettrust/sdk";

import type { Platform, PushPermission } from "../platform/types";

/**
 * Push registration (ADR-0024, ADR-0032). The API addresses pushes to the app's Firebase
 * Installation ID (FID). We register it after sign-in only when notifications are allowed,
 * remember it on the device, and unregister it before signing out so the next person to use
 * the phone doesn't get the previous person's notifications.
 *
 * The app never asks for notification permission at launch: only when someone turns
 * notifications on in Account, or after an action that benefits from it.
 */

export const PUSH_FID_KEY = "ft:push:fid";

export type PushRegistration = "registered" | "no-permission" | "failed";

export async function registerPush(platform: Platform, api: ApiClient): Promise<PushRegistration> {
  const permission: PushPermission = await platform.push
    .permission()
    .catch(() => "denied" as const);
  if (permission !== "granted") return "no-permission";
  try {
    const fid = await platform.push.installationId();
    await api.registerDevice({ fid, platform: platform.device.os });
    await platform.storage.set(PUSH_FID_KEY, fid);
    return "registered";
  } catch {
    // Push is a convenience: the inbox still records everything. Retried at next start.
    return "failed";
  }
}

/** Ask for permission (shows the OS prompt at most once), then register. */
export async function enablePush(
  platform: Platform,
  api: ApiClient,
): Promise<{ permission: PushPermission; registration: PushRegistration }> {
  const permission = await platform.push.requestPermission();
  const registration =
    permission === "granted" ? await registerPush(platform, api) : "no-permission";
  return { permission, registration };
}

/** Before sign-out, while the ID token still works. Never blocks signing out. */
export async function unregisterPush(platform: Platform, api: ApiClient): Promise<void> {
  const fid = await platform.storage.get(PUSH_FID_KEY).catch(() => null);
  if (fid === null) return;
  try {
    await api.unregisterDevice(fid);
  } catch {
    // Offline sign-out: the API moves the FID to whoever signs in next on this phone, and
    // FCM reports it gone after uninstall, so a stale registration doesn't linger for long.
  }
  await platform.storage.remove(PUSH_FID_KEY).catch(() => undefined);
}
