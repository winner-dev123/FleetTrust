"use client";

import { copy } from "@fleettrust/copy";
import { ErrorNotice, Loading } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { VehicleForm } from "@/components/vehicle-form";
import { VehicleList } from "@/components/vehicle-list";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.app.vehicles;

export default function MyVehiclesPage() {
  const { api } = useSession();
  const vehicles = useLoad(() => api.myVehicles(), "my-vehicles");

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {vehicles.status === "loading" ? <Loading /> : null}
      {vehicles.status === "error" ? (
        <ErrorNotice error={vehicles.error} onRetry={vehicles.reload} />
      ) : null}
      {vehicles.status === "ready" ? <VehicleList vehicles={vehicles.data} /> : null}
      <Card title={t.addTitle}>
        <VehicleForm
          onSubmit={async (vehicle) => {
            await api.createVehicle(vehicle);
            vehicles.reload();
          }}
        />
      </Card>
    </>
  );
}
