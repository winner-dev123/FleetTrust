"use client";

import type { MyOrganization } from "@fleettrust/types";
import Link from "next/link";

import { ButtonLink } from "@/components/button";
import { Badge, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader, Stat } from "@/components/layout";
import { formatDate, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

/** Fleet dashboard: vehicles, maintenance, documents, incidents, requests and recorded spending. */
export function FleetOverview({ membership }: { membership: MyOrganization }) {
  const { api } = useSession();
  const orgId = membership.organization.id;
  const dashboard = useLoad(() => api.fleetDashboard(orgId), `fleet-${orgId}`);

  return (
    <>
      <PageHeader
        title={membership.organization.name}
        description="Fleet dashboard"
        actions={
          membership.permissions.includes("vehicles.manage") ? (
            <ButtonLink href={`/app/o/${orgId}/vehicles`}>Vehicles</ButtonLink>
          ) : null
        }
      />
      {dashboard.status === "loading" ? <Loading /> : null}
      {dashboard.status === "error" ? (
        <ErrorNotice error={dashboard.error} onRetry={dashboard.reload} />
      ) : null}
      {dashboard.status === "ready" ? (
        <>
          <p className="small muted">
            Last {dashboard.data.window.days} days ({formatDate(dashboard.data.window.from)} to{" "}
            {formatDate(dashboard.data.window.to)})
            {dashboard.data.branchId ? " · your branch only" : ""}
          </p>
          <div className="grid">
            <Card title="Vehicles">
              <Stat label="active" value={dashboard.data.vehicles.active} />
              <Stat label="with a driver" value={dashboard.data.vehicles.withDriver} />
            </Card>
            <Card title="Maintenance">
              <Stat label="overdue" value={dashboard.data.maintenance.overdue} />
              <Stat label="due soon" value={dashboard.data.maintenance.dueSoon} />
            </Card>
            <Card title="Documents">
              <Stat label="expired" value={dashboard.data.documents.expired} />
              <Stat
                label="expiring within 30 days"
                value={dashboard.data.documents.expiringWithin30Days}
              />
            </Card>
            <Card title="Incidents">
              <Stat label="open" value={dashboard.data.incidents.open} />
              <Stat label="high severity, open" value={dashboard.data.incidents.highSeverityOpen} />
              <p style={{ marginBottom: 0 }}>
                <Link href={`/app/o/${orgId}/incidents`}>See incidents</Link>
              </p>
            </Card>
            <Card title="Service requests">
              <Stat label="open" value={dashboard.data.serviceRequests.open} />
              <Stat label="accepted" value={dashboard.data.serviceRequests.accepted} />
            </Card>
          </div>

          {dashboard.data.maintenance.items.length > 0 ? (
            <Card title="Maintenance needing attention">
              <div
                className="table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Maintenance needing attention"
              >
                <table className="table">
                  <caption className="visually-hidden">Maintenance needing attention</caption>
                  <thead>
                    <tr>
                      <th scope="col">Vehicle</th>
                      <th scope="col">Item</th>
                      <th scope="col">Due</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.data.maintenance.items.map((item) => (
                      <tr key={item.scheduleId}>
                        <td>
                          <Link href={`/app/vehicles/${item.vehicle.id}`}>{item.vehicle.name}</Link>
                        </td>
                        <td>{item.title}</td>
                        <td>
                          {[
                            item.nextDueOn ? formatDate(item.nextDueOn) : null,
                            item.nextDueKm !== null ? `${String(item.nextDueKm)} km` : null,
                          ]
                            .filter(Boolean)
                            .join(" or ") || "—"}
                        </td>
                        <td>
                          <Badge tone={item.status === "overdue" ? "danger" : "caution"}>
                            {item.status === "overdue" ? "Overdue" : "Due soon"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          <Card title="Recorded spending">
            <Notice tone="caution">
              <p className="small">{dashboard.data.spending.disclaimer}</p>
            </Notice>
            {dashboard.data.spending.lines.length === 0 ? (
              <p className="muted">Nothing recorded in this period.</p>
            ) : (
              <ul className="list-plain" style={{ marginTop: 12 }}>
                {dashboard.data.spending.lines.map((line) => (
                  <li key={line.currency}>
                    <strong>
                      {line.currency} {line.total}
                    </strong>{" "}
                    <span className="small muted">
                      (expenses {line.bySource.expenses}, service records{" "}
                      {line.bySource.serviceRecords})
                    </span>
                    <span className="small" style={{ display: "block" }}>
                      {line.byCategory
                        .map((entry) => `${titleCase(entry.category)}: ${entry.total}`)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </>
  );
}
