"use client";

import { copy, fill } from "@fleettrust/copy";
import {
  STAFF_ROLE_LABELS,
  STAFF_ROLE_SCOPES,
  STAFF_ROLES,
  type StaffRole,
} from "@fleettrust/types";
import { useState } from "react";

import { ConfirmAction } from "@/components/confirm-action";
import { SelectField, TextField } from "@/components/field";
import { ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { formatDate } from "@fleettrust/types";
import { useAdmin } from "@/lib/admin-context";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.admin.staff;

const ROLE_OPTIONS = STAFF_ROLES.map((role) => ({ value: role, label: STAFF_ROLE_LABELS[role] }));

/** Super admins grant and revoke staff roles. Nobody changes their own roles. */
export default function StaffPage() {
  const { api } = useSession();
  const me = useAdmin();
  const staff = useLoad(() => api.staffMembers(), "admin-staff");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("support_agent");
  const [done, setDone] = useState<string | null>(null);

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {done ? (
        <Notice tone="success" live="polite">
          <p>{done}</p>
        </Notice>
      ) : null}
      <Card title={t.grant}>
        <p className="small muted">{t.signedInOnce}</p>
        <div className="grid">
          <TextField
            label={t.email}
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
          <SelectField
            label={t.role}
            options={ROLE_OPTIONS}
            value={role}
            hint={STAFF_ROLE_SCOPES[role]}
            onChange={(event) => {
              setRole(STAFF_ROLES.find((r) => r === event.target.value) ?? "support_agent");
            }}
          />
        </div>
        {email.trim() !== "" ? (
          <ConfirmAction
            label={fill(t.grantRole, { role: STAFF_ROLE_LABELS[role] })}
            phrase={email.trim().toLowerCase()}
            consequence={fill(t.grantConsequence, {
              email: email.trim(),
              scope: STAFF_ROLE_SCOPES[role],
            })}
            onConfirm={async () => {
              staff.setData(
                await api.grantStaffRole(email.trim().toLowerCase(), role, "staff.grant"),
              );
              setDone(fill(t.granted, { role: STAFF_ROLE_LABELS[role], email: email.trim() }));
              setEmail("");
            }}
          />
        ) : null}
      </Card>

      {staff.status === "loading" ? <Loading /> : null}
      {staff.status === "error" ? <ErrorNotice error={staff.error} onRetry={staff.reload} /> : null}
      {staff.status === "ready" ? (
        <Card title={t.current}>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t.current}>
            <table className="table">
              <caption className="visually-hidden">{t.current}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.person}</th>
                  <th scope="col">{t.role}</th>
                  <th scope="col">{t.since}</th>
                  <th scope="col">{t.action}</th>
                </tr>
              </thead>
              <tbody>
                {staff.data.flatMap((member) =>
                  member.roles.map((held) => (
                    <tr key={`${member.userId}-${held.role}`}>
                      <td>
                        {member.displayName ?? "—"}
                        <span className="small muted" style={{ display: "block" }}>
                          {member.email ?? t.noEmail}
                        </span>
                      </td>
                      <td>{STAFF_ROLE_LABELS[held.role]}</td>
                      <td>{formatDate(held.since)}</td>
                      <td>
                        {member.userId === me.userId ? (
                          <span className="small muted">{t.you}</span>
                        ) : (
                          <ConfirmAction
                            label={fill(t.revokeRole, { role: STAFF_ROLE_LABELS[held.role] })}
                            phrase={member.email ?? "REVOKE"}
                            consequence={fill(t.revokeConsequence, {
                              who: member.email ?? t.thisPerson,
                            })}
                            onConfirm={async () => {
                              staff.setData(
                                await api.revokeStaffRole(member.userId, held.role, "staff.revoke"),
                              );
                              setDone(
                                fill(t.revoked, {
                                  role: STAFF_ROLE_LABELS[held.role],
                                  who: member.email ?? t.thePerson,
                                }),
                              );
                            }}
                          />
                        )}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
}
