import { z } from "zod";

import { boundedText, PROVIDER_CATEGORIES } from "./providers.js";

/** Saved provider lists (SRS F-101, ADR-0020). */
export const LIST_ROLES = ["viewer", "editor"] as const;
export const listRoleSchema = z.enum(LIST_ROLES);

export const MAX_LISTS_PER_USER = 50;
export const MAX_ITEMS_PER_LIST = 500;
export const MAX_MEMBERS_PER_LIST = 50;
export const MAX_ACTIVE_SHARE_LINKS = 10;

const listName = boundedText(80).min(1, "Name is required");

export const createListRequestSchema = z
  .object({ name: listName, description: boundedText(500).nullable().default(null) })
  .strict();

export const updateListRequestSchema = z
  .object({ name: listName, description: boundedText(500).nullable() })
  .partial()
  .strict()
  .refine((v) => v.name !== undefined || v.description !== undefined, "Nothing to update");

export const listItemRequestSchema = z
  .object({ note: boundedText(500).nullable().default(null) })
  .strict();

export const createShareLinkRequestSchema = z
  .object({
    role: listRoleSchema.default("viewer"),
    expiresInDays: z.number().int().min(1).max(30).default(7),
  })
  .strict();

export const joinListRequestSchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid link") })
  .strict();

export const memberRoleRequestSchema = z.object({ role: listRoleSchema }).strict();

export const savedListItemSchema = z.object({
  organizationId: z.uuid(),
  /** False when the provider is no longer published or is suspended; details are then hidden. */
  available: z.boolean(),
  slug: z.string().nullable(),
  tradingName: z.string().nullable(),
  categories: z.array(z.enum(PROVIDER_CATEGORIES)),
  locality: z.string().nullable(),
  logoUrl: z.string().nullable(),
  note: z.string().nullable(),
  addedAt: z.iso.datetime(),
});
export type SavedListItemDto = z.infer<typeof savedListItemSchema>;

export const savedListSummarySchema = z.object({
  id: z.uuid(),
  kind: z.enum(["favorites", "custom"]),
  name: z.string(),
  description: z.string().nullable(),
  /** The caller's access. */
  role: z.enum(["owner", "editor", "viewer"]),
  itemCount: z.number().int(),
  memberCount: z.number().int(),
  updatedAt: z.iso.datetime(),
});
export type SavedListSummary = z.infer<typeof savedListSummarySchema>;

export const listMemberSchema = z.object({
  userId: z.uuid(),
  displayName: z.string().nullable(),
  role: listRoleSchema,
  joinedAt: z.iso.datetime(),
});

export const savedListSchema = savedListSummarySchema.extend({
  items: z.array(savedListItemSchema),
  /** Only the owner sees who the list is shared with. */
  members: z.array(listMemberSchema).nullable(),
});
export type SavedListDto = z.infer<typeof savedListSchema>;

export const shareLinkSchema = z.object({
  id: z.uuid(),
  role: listRoleSchema,
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

/** Returned once when a link is created; only a hash of `token` is stored. */
export const createdShareLinkSchema = z.object({
  link: shareLinkSchema,
  token: z.string(),
  /** Web path; the token is in the fragment so it never reaches server logs. */
  joinPath: z.string(),
});

export const listErrorReasonSchema = z.enum([
  "too_many_lists",
  "list_full",
  "too_many_members",
  "too_many_links",
  "favorites_locked",
  "provider_unavailable",
  "link_invalid",
  "owner_cannot_join",
]);
export type ListErrorReason = z.infer<typeof listErrorReasonSchema>;
