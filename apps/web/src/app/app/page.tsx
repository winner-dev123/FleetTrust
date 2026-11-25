"use client";

import { copy, fill } from "@fleettrust/copy";
import Link from "next/link";

import { ButtonLink } from "@/components/button";
import { ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader, Stat } from "@/components/layout";
import { useAccount } from "@/lib/account";
import { formatDateTime, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.app.dashboard;

/** Signed-in home: what needs attention, and the quickest way to the main tasks. */
export default function DashboardPage() {
  const { api } = useSession();
  const { me, organizations } = useAccount();
  const overview = useLoad(async () => {
    const [inbox, requests, incidents] = await Promise.all([
      api.inbox(),
      api.serviceRequests(),
      api.myIncidents(),
    ]);
    return { inbox, requests, incidents };
  }, "dashboard");

  const firstRun = !me.profileComplete;

  return (
    <>
      <PageHeader
        title={me.displayName ? fill(t.hello, { name: me.displayName }) : t.title}
        actions={
          <>
            <ButtonLink href="/app/requests/new">{t.requestQuote}</ButtonLink>
            <ButtonLink variant="secondary" href="/search">
              {t.findServices}
            </ButtonLink>
          </>
        }
      />

      {firstRun ? (
        <Notice title={t.setupTitle}>
          <p>{t.setupBody}</p>
          <ButtonLink href="/app/onboarding">{t.setupAction}</ButtonLink>
        </Notice>
      ) : null}

      {overview.status === "loading" ? <Loading /> : null}
      {overview.status === "error" ? (
        <ErrorNotice error={overview.error} onRetry={overview.reload} />
      ) : null}
      {overview.status === "ready" ? (
        <>
          {overview.data.incidents
            .filter((incident) => incident.status === "active")
            .map((incident) => (
              <Notice key={incident.id} tone="danger" title={t.alertActive}>
                <p>
                  {fill(t.alertRaised, {
                    category: incident.categoryLabel,
                    time: formatDateTime(incident.createdAt),
                  })}
                </p>
                <ButtonLink variant="danger" href={`/app/emergency/${incident.id}`}>
                  {t.openAlert}
                </ButtonLink>
              </Notice>
            ))}
          <div className="grid">
            <Card title={t.openRequests} headingLevel={2}>
              <Stat
                label={t.openRequestsStat}
                value={
                  overview.data.requests.filter(
                    (request) => request.status === "open" || request.status === "accepted",
                  ).length
                }
              />
              <p style={{ marginBottom: 0 }}>
                <Link href="/app/requests">{t.seeRequests}</Link>
              </p>
            </Card>
            <Card title={t.unread} headingLevel={2}>
              <Stat label={t.unreadNotifications} value={overview.data.inbox.unreadNotifications} />
              <Stat label={t.unreadConversations} value={overview.data.inbox.unreadConversations} />
              <p style={{ marginBottom: 0 }}>
                <Link href="/app/notifications">{t.notifications}</Link> ·{" "}
                <Link href="/app/messages">{t.messages}</Link>
              </p>
            </Card>
            <Card title={t.emergencyTitle} headingLevel={2}>
              <p>{t.emergencyBody}</p>
              <ButtonLink variant="danger" href="/app/emergency">
                {t.emergencyButton}
              </ButtonLink>
            </Card>
          </div>
          {overview.data.inbox.notifications.length > 0 ? (
            <Card title={t.latest}>
              <ul className="list-plain">
                {overview.data.inbox.notifications.slice(0, 5).map((notification) => (
                  <li key={notification.id}>
                    <strong>{notification.title}</strong>
                    {notification.readAt ? null : <span className="small"> {t.newMark}</span>}
                    <span className="small muted" style={{ display: "block" }}>
                      {notification.body}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}

      <Card title={t.organizations}>
        {organizations.length === 0 ? (
          <p style={{ margin: 0 }}>
            {t.noOrganizations} <Link href="/app/onboarding">{t.addBusiness}</Link>.
          </p>
        ) : (
          <ul className="list-plain">
            {organizations.map((entry) => (
              <li key={entry.membershipId}>
                <Link href={`/app/o/${entry.organization.id}`}>{entry.organization.name}</Link>{" "}
                <span className="small muted">
                  {entry.organization.kind === "provider" ? t.providerKind : t.fleetKind} ·{" "}
                  {titleCase(entry.role)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
