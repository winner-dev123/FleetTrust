"use client";

import { copy, fill } from "@fleettrust/copy";
import type { MyOrganization } from "@fleettrust/types";
import Link from "next/link";

import { ButtonLink } from "@/components/button";
import { Badge, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader, Stat } from "@/components/layout";
import { formatDate, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.org.fleet;

/** Fleet dashboard: vehicles, maintenance, documents, incidents, requests and recorded spending. */
export function FleetOverview({ membership }: { membership: MyOrganization }) {
  const { api } = useSession();
  const orgId = membership.organization.id;
  const dashboard = useLoad(() => api.fleetDashboard(orgId), `fleet-${orgId}`);

  return (
    <>
      <PageHeader
        title={membership.organization.name}
        description={t.description}
        actions={
          membership.permissions.includes("vehicles.manage") ? (
            <ButtonLink href={`/app/o/${orgId}/vehicles`}>{t.vehiclesAction}</ButtonLink>
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
            {fill(t.window, {
              days: dashboard.data.window.days,
              from: formatDate(dashboard.data.window.from),
              to: formatDate(dashboard.data.window.to),
            })}
            {dashboard.data.branchId ? ` · ${t.branchOnly}` : ""}
          </p>
          <div className="grid">
            <Card title={t.vehicles}>
              <Stat label={t.vehiclesActive} value={dashboard.data.vehicles.active} />
              <Stat label={t.vehiclesWithDriver} value={dashboard.data.vehicles.withDriver} />
            </Card>
            <Card title={t.maintenance}>
              <Stat label={t.overdue} value={dashboard.data.maintenance.overdue} />
              <Stat label={t.dueSoon} value={dashboard.data.maintenance.dueSoon} />
            </Card>
            <Card title={t.documents}>
              <Stat label={t.expired} value={dashboard.data.documents.expired} />
              <Stat label={t.expiringSoon} value={dashboard.data.documents.expiringWithin30Days} />
            </Card>
            <Card title={t.incidents}>
              <Stat label={t.incidentsOpen} value={dashboard.data.incidents.open} />
              <Stat label={t.incidentsHigh} value={dashboard.data.incidents.highSeverityOpen} />
              <p style={{ marginBottom: 0 }}>
                <Link href={`/app/o/${orgId}/incidents`}>{t.seeIncidents}</Link>
              </p>
            </Card>
            <Card title={t.requests}>
              <Stat label={t.requestsOpen} value={dashboard.data.serviceRequests.open} />
              <Stat label={t.requestsAccepted} value={dashboard.data.serviceRequests.accepted} />
            </Card>
          </div>

          {dashboard.data.maintenance.items.length > 0 ? (
            <Card title={t.attention}>
              <div className="table-wrap" tabIndex={0} role="region" aria-label={t.attention}>
                <table className="table">
                  <caption className="visually-hidden">{t.attention}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t.vehicle}</th>
                      <th scope="col">{t.item}</th>
                      <th scope="col">{t.due}</th>
                      <th scope="col">{t.status}</th>
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
                            item.nextDueKm !== null ? fill(t.km, { km: item.nextDueKm }) : null,
                          ]
                            .filter(Boolean)
                            .join(` ${t.or} `) || "—"}
                        </td>
                        <td>
                          <Badge tone={item.status === "overdue" ? "danger" : "caution"}>
                            {item.status === "overdue" ? t.statusOverdue : t.statusDueSoon}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          <Card title={t.spending}>
            <Notice tone="caution">
              <p className="small">{dashboard.data.spending.disclaimer}</p>
            </Notice>
            {dashboard.data.spending.lines.length === 0 ? (
              <p className="muted">{t.noSpending}</p>
            ) : (
              <ul className="list-plain" style={{ marginTop: 12 }}>
                {dashboard.data.spending.lines.map((line) => (
                  <li key={line.currency}>
                    <strong>
                      {fill(t.spendingTotal, { currency: line.currency, total: line.total })}
                    </strong>{" "}
                    <span className="small muted">
                      {fill(t.spendingSources, {
                        expenses: line.bySource.expenses,
                        serviceRecords: line.bySource.serviceRecords,
                      })}
                    </span>
                    <span className="small" style={{ display: "block" }}>
                      {line.byCategory
                        .map((entry) =>
                          fill(t.spendingCategory, {
                            category: titleCase(entry.category),
                            total: entry.total,
                          }),
                        )
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
