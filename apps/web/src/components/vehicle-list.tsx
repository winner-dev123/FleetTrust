import { copy, fill } from "@fleettrust/copy";
import { VEHICLE_TYPE_LABELS, type VehicleDto } from "@fleettrust/types";
import Link from "next/link";

import { Badge, EmptyState } from "./feedback";

export function vehicleName(vehicle: VehicleDto): string {
  return (
    vehicle.nickname ??
    ([vehicle.make, vehicle.model].filter(Boolean).join(" ") ||
      VEHICLE_TYPE_LABELS[vehicle.vehicleType])
  );
}

/** Vehicles as cards with maintenance status in words. */
export function VehicleList({ vehicles }: { vehicles: readonly VehicleDto[] }) {
  if (vehicles.length === 0) return <EmptyState title={copy.web.vehicles.empty} />;
  return (
    <ul className="grid list-plain">
      {vehicles.map((vehicle) => (
        <li key={vehicle.id} className="card" style={{ marginTop: 0 }}>
          <h3 className="card__title">
            <Link href={`/app/vehicles/${vehicle.id}`}>{vehicleName(vehicle)}</Link>
          </h3>
          <p className="small muted">
            {VEHICLE_TYPE_LABELS[vehicle.vehicleType]}
            {vehicle.registration ? ` · ${vehicle.registration}` : ""}
            {vehicle.year ? ` · ${String(vehicle.year)}` : ""}
          </p>
          <p style={{ margin: 0 }}>
            {vehicle.maintenance.overdue > 0 ? (
              <Badge tone="danger">
                {fill(copy.web.vehicles.overdue, { count: vehicle.maintenance.overdue })}
              </Badge>
            ) : vehicle.maintenance.dueSoon > 0 ? (
              <Badge tone="caution">
                {fill(copy.web.vehicles.dueSoon, { count: vehicle.maintenance.dueSoon })}
              </Badge>
            ) : (
              <Badge tone="neutral">{copy.web.vehicles.noneDue}</Badge>
            )}
            {vehicle.driver ? (
              <span className="small">
                {" · "}
                {fill(copy.web.vehicles.driver, { name: vehicle.driver.displayName })}
              </span>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}
