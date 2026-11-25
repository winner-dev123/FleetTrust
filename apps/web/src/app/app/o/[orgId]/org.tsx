"use client";

import { copy } from "@fleettrust/copy";
import type { MyOrganization } from "@fleettrust/types";
import type { ReactNode } from "react";

import { Notice } from "@/components/feedback";
import { useMembership } from "@/lib/account";

const t = copy.web.org.membership;

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
      <Notice tone="caution" title={t.notFoundTitle}>
        <p>{t.notFoundBody}</p>
      </Notice>
    );
  }
  return children(membership);
}
