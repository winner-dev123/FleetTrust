"use client";

import { use } from "react";

import { ErrorNotice, Loading } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { UsagePanel } from "@/components/usage-panel";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { WithMembership } from "../org";

export default function OrganizationUsagePage(props: PageProps<"/app/o/[orgId]/usage">) {
  const { orgId } = use(props.params);
  const { api } = useSession();
  const usage = useLoad(() => api.organizationEntitlements(orgId), `usage-${orgId}`);
  return (
    <WithMembership orgId={orgId}>
      {(membership) => (
        <>
          <PageHeader
            title={`Plan usage: ${membership.organization.name}`}
            description="Limits shared by everyone in this organization."
          />
          {usage.status === "loading" ? <Loading /> : null}
          {usage.status === "error" ? (
            <ErrorNotice error={usage.error} onRetry={usage.reload} />
          ) : null}
          {usage.status === "ready" ? <UsagePanel usage={usage.data} /> : null}
        </>
      )}
    </WithMembership>
  );
}
