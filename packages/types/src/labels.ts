import type { BadgeType } from "./verification.js";
import type { OpeningStatus } from "./opening-hours.js";
import type { ProviderCategory, VEHICLE_TYPES } from "./providers.js";

type VehicleType = (typeof VEHICLE_TYPES)[number];

/**
 * Display labels shared by web and mobile (English; i18n can replace these maps). Labels state
 * what was checked and never suggest an endorsement (SRS §8.1).
 */
export const CATEGORY_LABELS: Readonly<Record<ProviderCategory, string>> = {
  workshop: "Workshop",
  fuel_station: "Fuel station",
  towing: "Towing",
  tyres: "Tyres",
  parts: "Parts",
  parking: "Parking",
  mobile_mechanic: "Mobile mechanic",
};

export const VEHICLE_TYPE_LABELS: Readonly<Record<VehicleType, string>> = {
  car: "Car",
  van: "Van",
  light_truck: "Light truck",
  heavy_truck: "Heavy truck",
  trailer: "Trailer",
  bus: "Bus",
  motorcycle: "Motorcycle",
  agricultural: "Agricultural",
};

const BADGE_NAMES: Readonly<Record<BadgeType, string>> = {
  driver: "Identity (driver)",
  business: "Business registration",
  location: "Business location",
};

/** "Business registration: verified" / "Business location: not verified". */
export function verificationLabel(badgeType: BadgeType, status: "verified" | "unverified"): string {
  return `${BADGE_NAMES[badgeType]}: ${status === "verified" ? "verified" : "not verified"}`;
}

function clock(localDateTime: string): string {
  return localDateTime.slice(11, 16);
}

/**
 * Opening status in words: "Open until 17:00", "Open 24 hours", "Closed (opens Mon 08:00)",
 * "Hours not provided" (never "Closed" when hours are unknown).
 */
export function openingStatusLabel(status: OpeningStatus): string {
  if (!status.known) return "Hours not provided";
  const suffix = status.exception ? ` · ${status.exception}` : "";
  if (status.isOpen) {
    return (status.closesAt ? `Open until ${clock(status.closesAt)}` : "Open 24 hours") + suffix;
  }
  if (!status.opensAt) return `Closed${suffix}`;
  const sameDay = status.opensAt.slice(0, 10) === status.localTime.slice(0, 10);
  const day = new Date(`${status.opensAt.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en", {
    weekday: "short",
    timeZone: "UTC",
  });
  return `Closed (opens ${sameDay ? "" : `${day} `}${clock(status.opensAt)})${suffix}`;
}
