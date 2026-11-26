"use client";

import { copy, fill, plural } from "@fleettrust/copy";
import { STAFF_ROLE_LABELS, STAFF_ROLE_SCOPES } from "@fleettrust/types";

import { ErrorNotice, Loading } from "@/components/feedback";
import { Card, PageHeader, Stat } from "@/components/layout";
import { formatDate, formatDateTime, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useAdmin } from "@/lib/admin-context";
import { useLoad } from "@/lib/use-load";

const t = copy.web.admin.home;

/** What each of the person's staff roles allows (least privilege, SRS §2.3). */
function RoleSummary() {
  const me = useAdmin();
  return (
    <Card title={t.yourRoles}>
      <ul className="list-plain">
        {me.roles.map((role) => (
          <li key={role}>
            <strong>{fill(t.roleLine, { role: STAFF_ROLE_LABELS[role] })}</strong>{" "}
            {STAFF_ROLE_SCOPES[role]}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Console home: the person's roles, plus the trust and safety overview for those who use it. */
export default function AdminPage() {
  const me = useAdmin();
  const trust =
    me.roles.includes("trust_safety_moderator") || me.roles.includes("verification_reviewer");
  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      <RoleSummary />
      {trust ? <TrustOverview /> : null}
    </>
  );
}

/**
 * Trust and safety overview, shared by moderators and verification reviewers. Everyone else
 * gets 404 from the API, so it isn't loaded for them.
 */
function TrustOverview() {
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
      <h2>{t.trust}</h2>
      <div className="grid">
        <Card title={t.reports}>
          <Stat label={t.reportsOpen} value={dashboard.reports.open} />
        </Card>
        <Card title={t.waiting}>
          <Stat label={t.articles} value={dashboard.pendingModeration.articles} />
          <Stat label={t.jobs} value={dashboard.pendingModeration.jobs} />
        </Card>
        <Card title={t.appeals}>
          <Stat label={t.moderationAppeals} value={dashboard.appeals.open} />
          <Stat label={t.verificationAppeals} value={dashboard.appeals.verificationOpen} />
        </Card>
        <Card title={t.members}>
          <Stat label={t.suspensions} value={dashboard.members.activeSuspensions} />
          <Stat label={t.warnings} value={dashboard.members.warningsLast30Days} />
          <Stat label={t.powerUsers} value={dashboard.members.powerUsers} />
        </Card>
        <Card title={t.verification}>
          <Stat label={t.casesWaiting} value={dashboard.verification.casesWaiting} />
        </Card>
        <Card title={t.emergency}>
          <Stat label={t.flaggedAlerts} value={dashboard.emergency.flaggedActive} />
        </Card>
      </div>

      <Card title={t.reportsChart}>
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t.reportsPerDay}>
          <table className="table">
            <caption className="visually-hidden">{t.reportsPerDay}</caption>
            <thead>
              <tr>
                <th scope="col">{t.day}</th>
                <th scope="col">{t.reportsColumn}</th>
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
        <Card title={t.queue}>
          {queue.length === 0 ? (
            <p className="muted">{t.nothingWaiting}</p>
          ) : (
            <ul className="list-plain">
              {queue.map((item) => (
                <li key={`${item.targetType}-${item.targetId}`}>
                  <strong>{item.title}</strong>{" "}
                  <span className="small muted">
                    {plural(item.openReports, t.queueLine, {
                      type: titleCase(item.targetType),
                      reasons: item.reasons.map(titleCase).join(", "),
                      time: formatDateTime(item.waitingSince),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card title={t.recent}>
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
