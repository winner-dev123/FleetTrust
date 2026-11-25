import type { LocationPermission, PushPermission } from "../platform/types";

/**
 * What to tell someone about each permission state, and what the button does. Location is
 * optional everywhere: every screen that uses it also accepts a typed place name.
 */
export interface PermissionAdvice {
  message: string;
  action: "request" | "use" | "settings" | null;
  actionLabel: string | null;
}

export function locationAdvice(permission: LocationPermission): PermissionAdvice {
  switch (permission) {
    case "granted":
      return { message: "", action: "use", actionLabel: "Use my location" };
    case "undetermined":
      return {
        message:
          "FleetTrust uses your location only while you use the app, to find help near you. You can type a place instead.",
        action: "request",
        actionLabel: "Use my location",
      };
    case "denied":
      return {
        message: "Location is off for FleetTrust. Type a place, or allow location and try again.",
        action: "request",
        actionLabel: "Try again",
      };
    case "blocked":
      return {
        message:
          "Location is turned off for FleetTrust in your phone's settings. Type a place, or turn it on in Settings.",
        action: "settings",
        actionLabel: "Open Settings",
      };
  }
}

export function pushAdvice(permission: PushPermission): PermissionAdvice {
  switch (permission) {
    case "granted":
      return { message: "Notifications are on for this phone.", action: null, actionLabel: null };
    case "undetermined":
      return {
        message:
          "Get told about quotes, messages and alerts from people who trust you. You can change which ones in settings.",
        action: "request",
        actionLabel: "Turn on notifications",
      };
    case "denied":
      return {
        message:
          "Notifications are off for FleetTrust. You'll still see everything in the app. To get alerts, turn them on in Settings.",
        action: "settings",
        actionLabel: "Open Settings",
      };
  }
}
