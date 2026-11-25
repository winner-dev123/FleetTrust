import { copy } from "@fleettrust/copy";
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
      return { message: "", action: "use", actionLabel: copy.location.useMyLocation };
    case "undetermined":
      return {
        message: copy.location.askFirst,
        action: "request",
        actionLabel: copy.location.useMyLocation,
      };
    case "denied":
      return {
        message: copy.location.denied,
        action: "request",
        actionLabel: copy.common.tryAgain,
      };
    case "blocked":
      return {
        message: copy.location.blocked,
        action: "settings",
        actionLabel: copy.location.openSettings,
      };
  }
}

export function pushAdvice(permission: PushPermission): PermissionAdvice {
  switch (permission) {
    case "granted":
      return { message: copy.push.on, action: null, actionLabel: null };
    case "undetermined":
      return {
        message: copy.push.askFirst,
        action: "request",
        actionLabel: copy.push.turnOn,
      };
    case "denied":
      return {
        message: copy.push.off,
        action: "settings",
        actionLabel: copy.push.openSettings,
      };
  }
}
