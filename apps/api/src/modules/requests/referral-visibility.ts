import {
  and,
  eq,
  type Executor,
  organizations,
  providerProfiles,
  providerReferrals,
} from "@fleettrust/db";
import { type InquiryDto, REFERRAL_RELATIONSHIP_LABELS } from "@fleettrust/types";

/**
 * The consented referral an inquiry came from, if any (ADR-0028). Its sharing choices limit what
 * the receiving provider sees: without photo consent, the requester's photos stay hidden.
 */
export async function referralOfRecipient(
  executor: Executor,
  recipientId: string,
): Promise<NonNullable<InquiryDto["referredBy"]> | null> {
  const [row] = await executor
    .select({
      referral: providerReferrals,
      name: organizations.name,
      slug: providerProfiles.slug,
      snapshot: providerProfiles.publishedSnapshot,
    })
    .from(providerReferrals)
    .innerJoin(organizations, eq(organizations.id, providerReferrals.fromOrganizationId))
    .innerJoin(
      providerProfiles,
      eq(providerProfiles.organizationId, providerReferrals.fromOrganizationId),
    )
    .where(
      and(
        eq(providerReferrals.recipientId, recipientId),
        eq(providerReferrals.status, "consented"),
      ),
    );
  if (!row) return null;
  const { referral } = row;
  return {
    referralId: referral.id,
    organizationId: referral.fromOrganizationId,
    name: (row.snapshot as { tradingName?: string } | null)?.tradingName ?? row.name,
    slug: row.slug,
    message: referral.message,
    relationship: referral.relationship,
    relationshipLabel: REFERRAL_RELATIONSHIP_LABELS[referral.relationship],
    relationshipDetails: referral.relationshipDetails,
    photosShared: referral.sharePhotos,
  };
}
