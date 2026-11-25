"use client";

import { ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader, Stat } from "@/components/layout";
import { formatDate, formatDateTime, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

/**
 * Trust and safety overview for FleetTrust staff (moderators and verification reviewers).
 * Read-only here: the full admin console with actions is Prompt 26. Everyone else gets 404
 * from the API, so this page shows nothing to them.
 */
export default function AdminPage() {
  const { api } = useSession();
  const data = useLoad(async () => {
    const [dashboard, queue] = await Promise.all([
      api.trustDashboard(),
      // Only trust and safety moderators can read the queue; reviewers see the dashboard only.
      api.moderationQueue().catch(() => null),
    ]);
    return { dashboard, queue };
  }, "admin");

  if (data.status === "loading") return <Loading />;
  if (data.status === "error") return <ErrorNotice error={data.error} />;
  const { dashboard, queue } = data.data;

  return (
    <>
      <PageHeader
        title="Trust and safety"
        description="Shared overview for moderators and verification reviewers."
      />
      <Notice>
        <p className="small">
          Read-only overview. Moderation, verification and plan actions are in the admin console.
        </p>
      </Notice>
      <div className="grid">
        <Card title="Reports">
          <Stat label="open" value={dashboard.reports.open} />
        </Card>
        <Card title="Waiting for moderation">
          <Stat label="articles" value={dashboard.pendingModeration.articles} />
          <Stat label="jobs" value={dashboard.pendingModeration.jobs} />
        </Card>
        <Card title="Appeals">
          <Stat label="moderation appeals open" value={dashboard.appeals.open} />
          <Stat label="verification appeals open" value={dashboard.appeals.verificationOpen} />
        </Card>
        <Card title="Members">
          <Stat label="active suspensions" value={dashboard.members.activeSuspensions} />
          <Stat label="warnings (30 days)" value={dashboard.members.warningsLast30Days} />
          <Stat label="Power Users" value={dashboard.members.powerUsers} />
        </Card>
        <Card title="Verification">
          <Stat label="cases waiting" value={dashboard.verification.casesWaiting} />
        </Card>
        <Card title="Emergency">
          <Stat label="flagged active alerts" value={dashboard.emergency.flaggedActive} />
        </Card>
      </div>

      <Card title="Reports received, last 14 days">
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Reports received per day"
        >
          <table className="table">
            <caption className="visually-hidden">Reports received per day</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Reports</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.reports.last14Days.map((day) => (
                <tr key={day.date}>
                  <td>{formatDate(day.date)}</td>
                  <td>{day.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {queue ? (
        <Card title="Moderation queue">
          {queue.length === 0 ? (
            <p className="muted">Nothing waiting.</p>
          ) : (
            <ul className="list-plain">
              {queue.map((item) => (
                <li key={`${item.targetType}-${item.targetId}`}>
                  <strong>{item.title}</strong>{" "}
                  <span className="small muted">
                    {titleCase(item.targetType)} · {String(item.openReports)} open reports ·{" "}
                    {item.reasons.map(titleCase).join(", ")} · since{" "}
                    {formatDateTime(item.waitingSince)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card title="Recent audited actions">
        <ul className="list-plain small">
          {dashboard.recentActions.map((action) => (
            <li key={`${action.at}-${action.action}-${action.targetId ?? ""}`}>
              {formatDateTime(action.at)} · {action.action} · {action.targetType}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
