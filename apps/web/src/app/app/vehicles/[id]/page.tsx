"use client";

import { copy, fill } from "@fleettrust/copy";
import { VEHICLE_TYPE_LABELS } from "@fleettrust/types";
import { use } from "react";

import { Badge, EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { vehicleName } from "@/components/vehicle-list";
import { formatDate, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.app.vehicle;

const STATUS_TONE = {
  ok: "verified",
  due_soon: "caution",
  overdue: "danger",
  unknown: "neutral",
} as const;
const STATUS_TEXT = {
  ok: t.statusOk,
  due_soon: t.statusDueSoon,
  overdue: t.statusOverdue,
  unknown: t.statusUnknown,
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
      <Card title={t.details}>
        <dl className="grid" style={{ gap: 8 }}>
          {(
            [
              [t.type, VEHICLE_TYPE_LABELS[vehicle.vehicleType]],
              [t.makeModel, [vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"],
              [t.year, vehicle.year ? String(vehicle.year) : "—"],
              [t.registration, vehicle.registration ?? "—"],
              [
                t.odometer,
                vehicle.odometerKm !== null
                  ? fill(t.odometerValue, {
                      km: vehicle.odometerKm,
                      date: formatDate(vehicle.odometerUpdatedAt),
                    })
                  : "—",
              ],
              [t.driver, vehicle.driver?.displayName ?? "—"],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="small muted">{label}</dt>
              <dd style={{ margin: 0 }}>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title={t.maintenance}>
        {schedules.length === 0 ? (
          <EmptyState title={t.noReminders} />
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t.schedule}>
            <table className="table">
              <caption className="visually-hidden">{t.schedule}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.item}</th>
                  <th scope="col">{t.nextDue}</th>
                  <th scope="col">{t.status}</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((schedule) => (
                  <tr key={schedule.id}>
                    <td>{schedule.title}</td>
                    <td>
                      {[
                        schedule.nextDueOn ? formatDate(schedule.nextDueOn) : null,
                        schedule.nextDueKm !== null ? fill(t.km, { km: schedule.nextDueKm }) : null,
                      ]
                        .filter(Boolean)
                        .join(` ${t.or} `) || "—"}
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

      <Card title={t.history}>
        <Notice>
          <p className="small">{history.notice}</p>
        </Notice>
        {history.items.length === 0 ? (
          <p className="muted">{t.noHistory}</p>
        ) : (
          <ul className="list-plain" style={{ marginTop: 12 }}>
            {history.items.map((record) => (
              <li key={record.id}>
                <strong>{record.title}</strong>{" "}
                <span className="small muted">
                  {formatDate(record.performedOn)} · {titleCase(record.category)}
                  {record.odometerKm !== null ? ` · ${fill(t.km, { km: record.odometerKm })}` : ""}
                </span>
                <span className="small" style={{ display: "block" }}>
                  {record.sourceLabel}
                  {record.cost
                    ? ` · ${fill(t.cost, { currency: record.cost.currency, amount: record.cost.amount })}`
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
