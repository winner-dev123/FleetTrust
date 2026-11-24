import type { NotificationDto } from "@fleettrust/types";

/** Where a notification leads, from the IDs it carries (see the API notifications service). */
export function notificationHref(notification: NotificationDto): string | null {
  const data = notification.data;
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
  if (notification.kind === "account_sanctioned" || notification.kind === "appeal_decided") {
    return "/app/appeals";
  }
  if (notification.kind === "power_user") return "/app/account";
  return null;
}
