/**
 * What happens to every database reference to a person when they delete their account
 * (right to erasure, docs/security/privacy.md). Deletion keeps the `users` row as an anonymous
 * tombstone (no email, name or sign-in), so foreign-key cascades never fire: every column that
 * references `users` must be handled on purpose.
 *
 * - `erased`: the rows are deleted (PrivacyService.deleteAccount, directly or through a deleted
 *   parent row). Tested: none remain for the deleted person.
 * - `withdrawn`: the row stays, its personal content is removed (writing withdrawn, files purged).
 * - `kept`: the row stays and points to the tombstone, because it belongs to someone else's
 *   record, to an organization, or to the audit trail. The tombstone carries no personal data.
 *
 * A test reads every foreign key to `users` from the migrated database and fails if a column is
 * missing here, so a new feature can't add personal data without deciding how erasure treats it.
 */

export type ErasureHandling = "erased" | "withdrawn" | "kept";

export interface UserReference {
  handling: ErasureHandling;
  why: string;
}

const own = (why: string): UserReference => ({ handling: "erased", why });
const withdrawn = (why: string): UserReference => ({ handling: "withdrawn", why });
const kept = (why: string): UserReference => ({ handling: "kept", why });

const ACTOR = kept(
  "Records who did something in an organization or as staff; the record belongs to them, the tombstone has no personal data",
);
const OTHERS = kept("Part of other people's records (their conversation, request or incident)");
const AUDIT = kept("Audit and moderation history must be kept (docs/security/data-retention.md)");
const BILLING = kept("Plan and quota records are kept for billing history (ADR-0008)");

export const USER_REFERENCES: Readonly<Record<string, UserReference>> = {
  // --- Erased: data only this person uses ---------------------------------------------------
  "article_bookmarks.user_id": own("Their bookmarks"),
  "article_images.uploaded_by": own("Their uploaded article images, files deleted too"),
  "community_group_members.user_id": own("Their group memberships"),
  "consents.user_id": own("Their consent history"),
  "conversation_states.user_id": own("Their read and mute state"),
  "emergency_incidents.owner_user_id": own("Their emergency incidents (with deliveries)"),
  "friend_requests.recipient_id": own("Friend requests to them"),
  "friend_requests.sender_id": own("Friend requests from them"),
  "friendships.user_a_id": own("Their friendships"),
  "friendships.user_b_id": own("Their friendships"),
  "incident_recipients.user_id": own("Their place in other people's alert lists"),
  "job_applications.applicant_user_id": own("Their job applications"),
  "memberships.user_id": own("Their organization memberships (sole owners are refused first)"),
  "messaging_preferences.user_id": own("Their messaging preferences"),
  "moderation_appeals.user_id": own("Their appeals"),
  "notifications.user_id": own("Their inbox"),
  "platform_staff.user_id": own("Their staff roles"),
  "power_user_status.user_id": own("Their Power User status"),
  "push_devices.user_id": own("Their devices"),
  "saved_list_members.user_id": own("Their access to shared lists"),
  "saved_lists.owner_user_id": own("Their saved lists"),
  "social_settings.user_id": own("Their social settings"),
  "staff_availability.user_id": own("Their working hours"),
  "staff_time_off.user_id": own("Their time off"),
  "trusted_contacts.contact_user_id": own("Trusted-contact links to them"),
  "trusted_contacts.owner_user_id": own("Their trusted contacts"),
  "user_blocks.blocked_id": own("Blocks of them"),
  "user_blocks.blocker_id": own("Their blocks"),
  "vehicles.owner_user_id": own("Their personal vehicles, with documents and files"),

  // --- Withdrawn: the row stays, the personal content goes -------------------------------------
  "article_comments.author_user_id": withdrawn("Comments marked deleted; replies stay in place"),
  "articles.author_user_id": withdrawn("Articles unpublished and emptied"),
  "service_requests.requester_user_id": withdrawn(
    "Requests stay for the providers' records, without the free-text location note",
  ),
  "verification_cases.user_id": withdrawn("Decision history stays; identity documents are purged"),
  "verification_documents.uploaded_by": withdrawn("Files deleted, rows marked purged"),

  // --- Kept: other people's records ---------------------------------------------------------------
  "conversations.direct_user_a": OTHERS,
  "conversations.direct_user_b": OTHERS,
  "incident_deliveries.user_id": OTHERS,
  "message_attachments.uploaded_by": OTHERS,
  "messages.sender_user_id": OTHERS,
  "part_inquiries.requester_user_id": OTHERS,
  "service_request_attachments.uploaded_by": OTHERS,
  "saved_list_share_links.created_by": kept(
    "Links on lists owned by someone else (links on their own lists go with the lists)",
  ),
  "vehicle_assignments.user_id": kept("The fleet's record of who drove a vehicle"),

  // --- Kept: audit, moderation and billing history -------------------------------------------------
  "audit_events.actor_id": AUDIT,
  "content_reports.reporter_user_id": AUDIT,
  "member_sanctions.user_id": AUDIT,
  "support_cases.user_id": AUDIT,
  "verification_badges.user_id": AUDIT,
  "plan_assignments.user_id": BILLING,
  "quota_overrides.user_id": BILLING,

  // --- Kept: actor columns (who did something for an organization or as staff) ----------------------
  "appointments.created_by": ACTOR,
  "appointments.staff_user_id": ACTOR,
  "community_group_members.decided_by": ACTOR,
  "community_groups.created_by": ACTOR,
  "content_reports.resolved_by": ACTOR,
  "crm_inquiry_notes.author_user_id": ACTOR,
  "crm_inquiry_states.assignee_user_id": ACTOR,
  "crm_tasks.assignee_user_id": ACTOR,
  "crm_tasks.completed_by": ACTOR,
  "crm_tasks.created_by": ACTOR,
  "document_access_grants.reviewer_id": ACTOR,
  "feature_settings.updated_by": ACTOR,
  "fleet_expenses.entered_by": ACTOR,
  "fleet_incidents.reported_by": ACTOR,
  "fleet_incidents.resolved_by": ACTOR,
  "fleet_preferred_providers.added_by": ACTOR,
  "invitations.accepted_by": ACTOR,
  "invitations.invited_by": ACTOR,
  "invitations.revoked_by": ACTOR,
  "jobs.created_by": ACTOR,
  "maintenance_schedules.created_by": ACTOR,
  "member_sanctions.created_by": ACTOR,
  "member_sanctions.lifted_by": ACTOR,
  "moderation_actions.moderator_user_id": ACTOR,
  "moderation_appeals.decided_by": ACTOR,
  "organizations.created_by": ACTOR,
  "part_inquiries.answered_by": ACTOR,
  "part_inquiries.created_by": ACTOR,
  "parts.created_by": ACTOR,
  "parts.stock_confirmed_by": ACTOR,
  "plan_assignments.assigned_by": ACTOR,
  "plan_assignments.ended_by": ACTOR,
  "power_user_status.revoked_by": ACTOR,
  "provider_emergency_settings.updated_by": ACTOR,
  "provider_media.uploaded_by": ACTOR,
  "provider_profiles.published_by": ACTOR,
  "provider_referrals.created_by": ACTOR,
  "provider_referrals.decided_by": ACTOR,
  "quota_overrides.created_by": ACTOR,
  "quota_overrides.revoked_by": ACTOR,
  "saved_list_items.added_by": ACTOR,
  "service_category_settings.updated_by": ACTOR,
  "service_quotes.created_by": ACTOR,
  "service_records.entered_by": ACTOR,
  "service_request_events.actor_user_id": ACTOR,
  "service_requests.created_by": ACTOR,
  "staff_time_off.created_by": ACTOR,
  "support_cases.closed_by": ACTOR,
  "support_cases.opened_by": ACTOR,
  "vehicle_assignments.assigned_by": ACTOR,
  "vehicle_document_shares.created_by": ACTOR,
  "vehicle_documents.uploaded_by": ACTOR,
  "vehicles.created_by": ACTOR,
  "verification_appeals.decided_by": ACTOR,
  "verification_appeals.filed_by": ACTOR,
  "verification_badges.ended_by": ACTOR,
  "verification_badges.granted_by": ACTOR,
  "verification_cases.decided_by": ACTOR,
  "verification_cases.opened_by": ACTOR,
};
