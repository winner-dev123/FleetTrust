import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "./columns.js";
import { providerProfiles } from "./provider-profiles.js";
import { users } from "./users.js";

/**
 * Saved provider lists (SRS F-101, Prompt 13, ADR-0020). Personal: owned by a user, never by an
 * organization (fleet preferred-provider lists are Prompt 22). Each user has one `favorites`
 * list, created on first use, which can't be renamed, shared or deleted.
 */
export const savedLists = pgTable(
  "saved_lists",
  {
    id: id(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["favorites", "custom"] }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    ...timestamps(),
  },
  (t) => [
    index("saved_lists_owner_idx").on(t.ownerUserId, t.createdAt),
    uniqueIndex("saved_lists_one_favorites")
      .on(t.ownerUserId)
      .where(sql`${t.kind} = 'favorites'`),
    check("saved_lists_kind_valid", sql`${t.kind} IN ('favorites', 'custom')`),
    check("saved_lists_name_length", sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check(
      "saved_lists_description_length",
      sql`${t.description} IS NULL OR char_length(${t.description}) <= 500`,
    ),
  ],
);

/** A provider on a list. Kept when the provider unpublishes (shown as unavailable). */
export const savedListItems = pgTable(
  "saved_list_items",
  {
    listId: uuid("list_id")
      .notNull()
      .references(() => savedLists.id, { onDelete: "cascade" }),
    providerOrganizationId: uuid("provider_organization_id")
      .notNull()
      .references(() => providerProfiles.organizationId, { onDelete: "cascade" }),
    note: text("note"),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    addedAt: timestamp("added_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.providerOrganizationId] }),
    index("saved_list_items_provider_idx").on(t.providerOrganizationId),
    index("saved_list_items_list_added_idx").on(t.listId, t.addedAt),
    check("saved_list_items_note_length", sql`${t.note} IS NULL OR char_length(${t.note}) <= 500`),
  ],
);

/** People a list is shared with. The owner isn't a member row. */
export const savedListMembers = pgTable(
  "saved_list_members",
  {
    listId: uuid("list_id")
      .notNull()
      .references(() => savedLists.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["viewer", "editor"] }).notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.userId] }),
    index("saved_list_members_user_idx").on(t.userId),
    check("saved_list_members_role_valid", sql`${t.role} IN ('viewer', 'editor')`),
  ],
);

/**
 * Invitation links. Only a SHA-256 hash of the token is stored; the token is shown once.
 * Sharing by link avoids looking people up by email (no account enumeration).
 */
export const savedListShareLinks = pgTable(
  "saved_list_share_links",
  {
    id: id(),
    listId: uuid("list_id")
      .notNull()
      .references(() => savedLists.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    role: text("role", { enum: ["viewer", "editor"] }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("saved_list_share_links_token_key").on(t.tokenHash),
    index("saved_list_share_links_list_idx").on(t.listId),
    check("saved_list_share_links_role_valid", sql`${t.role} IN ('viewer', 'editor')`),
  ],
);

export type SavedList = typeof savedLists.$inferSelect;
export type SavedListItem = typeof savedListItems.$inferSelect;
export type SavedListMember = typeof savedListMembers.$inferSelect;
export type SavedListShareLink = typeof savedListShareLinks.$inferSelect;
