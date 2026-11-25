import type { NotificationDto } from "./messaging.js";

/**
 * Where a notification leads, as a web path, from the IDs it carries (see the API
 * notifications service). Push messages carry the same `data` without `kind`, so the kind is
 * optional. The mobile app maps these web paths to its own screens.
 */
export function notificationPath(
  data: Readonly<Record<string, string>>,
  kind?: NotificationDto["kind"],
): string | null {
  const id = (key: string) => (data[key] ? encodeURIComponent(data[key]) : null);
  const incident = id("incidentId");
  if (incident) return `/app/emergency/${incident}`;
  const request = id("requestId");
  if (request) return `/app/requests/${request}`;
  const conversation = id("conversationId");
  if (conversation) return `/app/messages/${conversation}`;
  const vehicle = id("vehicleId");
  if (vehicle) return `/app/vehicles/${vehicle}`;
  const job = id("jobId");
  if (job) return `/jobs/${job}`;
  if (id("sanctionId") || id("appealId")) return "/app/appeals";
  if (kind === "account_sanctioned" || kind === "appeal_decided") return "/app/appeals";
  if (kind === "power_user") return "/app/account";
  return null;
}

/** Web notification link for an inbox row. */
export function notificationHref(
  notification: Pick<NotificationDto, "data" | "kind">,
): string | null {
  return notificationPath(notification.data, notification.kind);
}
