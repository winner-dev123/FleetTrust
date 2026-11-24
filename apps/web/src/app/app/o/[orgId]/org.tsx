"use client";

import type { MyOrganization } from "@fleettrust/types";
import type { ReactNode } from "react";

import { Notice } from "@/components/feedback";
import { useMembership } from "@/lib/account";

/**
 * Renders `children` with the membership for `orgId`, or a not-found message: organizations you
 * don't belong to look the same as ones that don't exist (the API answers 404 too).
 */
export function WithMembership({
  orgId,
  children,
}: {
  orgId: string;
  children: (membership: MyOrganization) => ReactNode;
}) {
  const membership = useMembership(orgId);
  if (!membership) {
    return (
      <Notice tone="caution" title="Organization not found">
        <p>It doesn&apos;t exist, or you&apos;re not a member.</p>
      </Notice>
    );
  }
  return children(membership);
}
