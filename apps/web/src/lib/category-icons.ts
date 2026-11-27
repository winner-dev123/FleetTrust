import type { ProviderCategory } from "@fleettrust/types";

import type { IconName } from "@/components/icon";

/** Icon shown for each provider category (Figma Make provider tiles). */
export const CATEGORY_ICONS: Readonly<Record<ProviderCategory, IconName>> = {
  workshop: "tools",
  fuel_station: "fuel",
  towing: "tow",
  tyres: "tyre",
  parts: "wrench",
  parking: "car",
  mobile_mechanic: "wrench",
};
