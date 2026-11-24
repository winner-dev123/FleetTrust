"use client";

import { use } from "react";

import { ErrorNotice, Loading } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { VehicleForm } from "@/components/vehicle-form";
import { VehicleList } from "@/components/vehicle-list";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

export default function FleetVehiclesPage(props: PageProps<"/app/o/[orgId]/vehicles">) {
  const { orgId } = use(props.params);
  const { api } = useSession();
  const vehicles = useLoad(() => api.fleetVehicles(orgId), `fleet-vehicles-${orgId}`);
  return (
    <>
      <PageHeader title="Fleet vehicles" />
      {vehicles.status === "loading" ? <Loading /> : null}
      {vehicles.status === "error" ? (
        <ErrorNotice error={vehicles.error} onRetry={vehicles.reload} />
      ) : null}
      {vehicles.status === "ready" ? <VehicleList vehicles={vehicles.data} /> : null}
      <Card title="Add a vehicle">
        <VehicleForm
          onSubmit={async (vehicle) => {
            await api.createFleetVehicle(orgId, vehicle);
            vehicles.reload();
          }}
        />
      </Card>
    </>
  );
}
