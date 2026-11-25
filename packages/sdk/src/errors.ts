import { ApiError, type ApiErrorReason } from "./client.js";

/** Plain-language messages for the error reasons people meet most often. */
const REASON_MESSAGES: Partial<Record<ApiErrorReason, string>> = {
  quota_exceeded:
    "You've reached your plan's limit for this. It resets as shown on your usage page, or FleetTrust staff can change your plan.",
  account_suspended:
    "Your account is suspended. You can still see the reason and appeal from your account page.",
  profile_incomplete: "Add a display name on your account page first.",
  insufficient_permission: "Your role in this organization doesn't allow this.",
  organization_suspended: "This organization is suspended.",
  expired_token: "Your session has ended. Please sign in again.",
  revoked_token: "Your session has ended. Please sign in again.",
  invalid_token: "Your session has ended. Please sign in again.",
  missing_token: "Please sign in to continue.",
  reauthentication_required: "For your security, please sign in again.",
};

/** One sentence explaining an API failure, safe to show to anyone (never raw server text). */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong. Please try again.";
  if (error.reason !== undefined) {
    const known = REASON_MESSAGES[error.reason];
    if (known !== undefined) return known;
  }
  if (error.code === "network_error") {
    return "We couldn't reach FleetTrust. Check your connection and try again.";
  }
  switch (error.status) {
    case 400:
      return "Some details aren't valid. Check the form and try again.";
    case 401:
      return "Please sign in to continue.";
    case 403:
      return "You don't have access to this.";
    case 404:
      return "We couldn't find that. It may have been removed, or you may not have access.";
    case 409:
      return error.reason === undefined
        ? "That can't be done right now."
        : `That can't be done right now (${error.reason.replaceAll("_", " ")}).`;
    case 429: {
      const wait = error.retryAfterSeconds;
      return wait === undefined
        ? "Too many attempts. Please wait a moment."
        : `Too many attempts. Please try again in ${String(wait)} seconds.`;
    }
    default:
      return "Something went wrong on our side. Please try again.";
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** True when the request never reached FleetTrust (offline, DNS, timeout), so a retry may work. */
export function isOffline(error: unknown): boolean {
  return error instanceof ApiError && error.code === "network_error";
}
