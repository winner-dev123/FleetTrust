"use client";

import { VEHICLE_TYPE_LABELS } from "@fleettrust/types";
import { use } from "react";

import { Badge, EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { vehicleName } from "@/components/vehicle-list";
import { formatDate, titleCase } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const STATUS_TONE = {
  ok: "verified",
  due_soon: "caution",
  overdue: "danger",
  unknown: "neutral",
} as const;
const STATUS_TEXT = {
  ok: "OK",
  due_soon: "Due soon",
  overdue: "Overdue",
  unknown: "Not enough data",
} as const;

/** A vehicle: details, maintenance schedule and service history. */
export default function VehiclePage(props: PageProps<"/app/vehicles/[id]">) {
  const { id } = use(props.params);
  const { api } = useSession();
  const data = useLoad(async () => {
    const [vehicle, schedules, history] = await Promise.all([
      api.vehicle(id),
      api.maintenanceSchedules(id),
      api.serviceHistory(id),
    ]);
    return { vehicle, schedules, history };
  }, `vehicle-${id}`);

  if (data.status === "loading") return <Loading />;
  if (data.status === "error") return <ErrorNotice error={data.error} onRetry={data.reload} />;
  const { vehicle, schedules, history } = data.data;

  return (
    <>
      <PageHeader title={vehicleName(vehicle)} />
      <Card title="Details">
        <dl className="grid" style={{ gap: 8 }}>
          {(
            [
              ["Type", VEHICLE_TYPE_LABELS[vehicle.vehicleType]],
              ["Make and model", [vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"],
              ["Year", vehicle.year ? String(vehicle.year) : "—"],
              ["Registration", vehicle.registration ?? "—"],
              [
                "Odometer",
                vehicle.odometerKm !== null
                  ? `${String(vehicle.odometerKm)} km (${formatDate(vehicle.odometerUpdatedAt)})`
                  : "—",
              ],
              ["Driver", vehicle.driver?.displayName ?? "—"],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="small muted">{label}</dt>
              <dd style={{ margin: 0 }}>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Maintenance">
        {schedules.length === 0 ? (
          <EmptyState title="No reminders set" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">Maintenance schedule</caption>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Next due</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((schedule) => (
                  <tr key={schedule.id}>
                    <td>{schedule.title}</td>
                    <td>
                      {[
                        schedule.nextDueOn ? formatDate(schedule.nextDueOn) : null,
                        schedule.nextDueKm !== null ? `${String(schedule.nextDueKm)} km` : null,
                      ]
                        .filter(Boolean)
                        .join(" or ") || "—"}
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[schedule.status]}>
                        {STATUS_TEXT[schedule.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Service history">
        <Notice>
          <p className="small">{history.notice}</p>
        </Notice>
        {history.items.length === 0 ? (
          <p className="muted">No service records yet.</p>
        ) : (
          <ul className="list-plain" style={{ marginTop: 12 }}>
            {history.items.map((record) => (
              <li key={record.id}>
                <strong>{record.title}</strong>{" "}
                <span className="small muted">
                  {formatDate(record.performedOn)} · {titleCase(record.category)}
                  {record.odometerKm !== null ? ` · ${String(record.odometerKm)} km` : ""}
                </span>
                <span className="small" style={{ display: "block" }}>
                  {record.sourceLabel}
                  {record.cost
                    ? ` · ${record.cost.currency} ${record.cost.amount} (as entered)`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
