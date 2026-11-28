import type { ArticleCategory } from "@fleettrust/types";
import type { StaticImageData } from "next/image";

import coastalDriver from "../../public/images/coastal-driver.webp";
import dashboardLights from "../../public/images/dashboard-lights.webp";
import roadsideKit from "../../public/images/roadside-kit.webp";
import safePullout from "../../public/images/safe-pullout.webp";
import serviceEstimate from "../../public/images/service-estimate.webp";
import tyrePressure from "../../public/images/tyre-pressure.webp";
import workshopOwner from "../../public/images/workshop-owner.webp";
import workshopTeam from "../../public/images/workshop-team.webp";

/** Editorial photos from the Figma Make design (public/images, re-encoded WebP). */
export const PHOTOS = {
  coastalDriver,
  dashboardLights,
  roadsideKit,
  safePullout,
  serviceEstimate,
  tyrePressure,
  workshopOwner,
  workshopTeam,
} as const;

/**
 * Cover photo per article topic. Articles are written by the community and have no photo of
 * their own, so the cover illustrates the topic only; it is decorative (empty alt text).
 */
export const ARTICLE_COVERS: Readonly<Record<ArticleCategory, StaticImageData>> = {
  maintenance: tyrePressure,
  safety: roadsideKit,
  regulations: serviceEstimate,
  routes: coastalDriver,
  fuel_efficiency: dashboardLights,
  business: workshopTeam,
  technology: dashboardLights,
  driver_wellbeing: safePullout,
  other: workshopTeam,
};
