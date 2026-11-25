import { PROVIDER_CATEGORIES, VEHICLE_TYPES } from "@fleettrust/types";
import { z } from "zod";

/** The single unsent service request kept on the phone (see drafts.ts). */
export const REQUEST_DRAFT_ID = "new";

export const requestDraftSchema = z.object({
  /** Kept with the draft: resending after a dropped connection returns the same request. */
  clientRequestId: z.string().min(1),
  category: z.enum(PROVIDER_CATEGORIES),
  vehicleType: z.enum(VEHICLE_TYPES),
  make: z.string().max(60),
  model: z.string().max(60),
  registration: z.string().max(20),
  description: z.string().max(2000),
  urgency: z.enum(["routine", "soon", "urgent"]),
  providerSlug: z.string().max(100).nullable(),
  location: z
    .object({
      lat: z.number(),
      lng: z.number(),
      label: z.string().max(200),
      accuracyM: z.number().nullable(),
    })
    .nullable(),
});
export type RequestDraft = z.infer<typeof requestDraftSchema>;

export const emptyRequestDraft = (clientRequestId: string): RequestDraft => ({
  clientRequestId,
  category: "workshop",
  vehicleType: "car",
  make: "",
  model: "",
  registration: "",
  description: "",
  urgency: "routine",
  providerSlug: null,
  location: null,
});
