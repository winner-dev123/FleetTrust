"use client";

import { use } from "react";

import { FleetOverview } from "./fleet-overview";
import { WithMembership } from "./org";
import { ProviderOverview } from "./provider-overview";

export default function OrganizationPage(props: PageProps<"/app/o/[orgId]">) {
  const { orgId } = use(props.params);
  return (
    <WithMembership orgId={orgId}>
      {(membership) =>
        membership.organization.kind === "provider" ? (
          <ProviderOverview membership={membership} />
        ) : (
          <FleetOverview membership={membership} />
        )
      }
    </WithMembership>
  );
}
