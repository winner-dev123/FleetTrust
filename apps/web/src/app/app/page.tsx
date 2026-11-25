"use client";

import Link from "next/link";

import { ButtonLink } from "@/components/button";
import { ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader, Stat } from "@/components/layout";
import { useAccount } from "@/lib/account";
import { formatDateTime, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

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
        title={me.displayName ? `Hello, ${me.displayName}` : "Your dashboard"}
        actions={
          <>
            <ButtonLink href="/app/requests/new">Request a quote</ButtonLink>
            <ButtonLink variant="secondary" href="/search">
              Find services
            </ButtonLink>
          </>
        }
      />

      {firstRun ? (
        <Notice title="Finish setting up">
          <p>
            Add a display name so you can post, join groups and message providers. If you run a
            business or a fleet, you can set that up too.
          </p>
          <ButtonLink href="/app/onboarding">Set up your account</ButtonLink>
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
              <Notice key={incident.id} tone="danger" title="Your emergency alert is active">
                <p>
                  {incident.categoryLabel} · raised {formatDateTime(incident.createdAt)}
                </p>
                <ButtonLink variant="danger" href={`/app/emergency/${incident.id}`}>
                  Open alert
                </ButtonLink>
              </Notice>
            ))}
          <div className="grid">
            <Card title="Open requests" headingLevel={2}>
              <Stat
                label="waiting for quotes or in progress"
                value={
                  overview.data.requests.filter(
                    (request) => request.status === "open" || request.status === "accepted",
                  ).length
                }
              />
              <p style={{ marginBottom: 0 }}>
                <Link href="/app/requests">See your requests</Link>
              </p>
            </Card>
            <Card title="Unread" headingLevel={2}>
              <Stat label="notifications" value={overview.data.inbox.unreadNotifications} />
              <Stat label="conversations" value={overview.data.inbox.unreadConversations} />
              <p style={{ marginBottom: 0 }}>
                <Link href="/app/notifications">Notifications</Link> ·{" "}
                <Link href="/app/messages">Messages</Link>
              </p>
            </Card>
            <Card title="Emergency" headingLevel={2}>
              <p>Alert your trusted contacts in one tap. Never limited by your plan.</p>
              <ButtonLink variant="danger" href="/app/emergency">
                Emergency
              </ButtonLink>
            </Card>
          </div>
          {overview.data.inbox.notifications.length > 0 ? (
            <Card title="Latest notifications">
              <ul className="list-plain">
                {overview.data.inbox.notifications.slice(0, 5).map((notification) => (
                  <li key={notification.id}>
                    <strong>{notification.title}</strong>
                    {notification.readAt ? null : <span className="small"> (new)</span>}
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

      <Card title="Your organizations">
        {organizations.length === 0 ? (
          <p style={{ margin: 0 }}>
            Run a workshop, towing service or fleet?{" "}
            <Link href="/app/onboarding">Add your business</Link>.
          </p>
        ) : (
          <ul className="list-plain">
            {organizations.map((entry) => (
              <li key={entry.membershipId}>
                <Link href={`/app/o/${entry.organization.id}`}>{entry.organization.name}</Link>{" "}
                <span className="small muted">
                  {entry.organization.kind === "provider" ? "Service provider" : "Fleet"} ·{" "}
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
