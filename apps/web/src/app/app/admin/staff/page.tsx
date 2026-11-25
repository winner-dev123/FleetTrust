"use client";

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
      <PageHeader
        title="Staff roles"
        description="Give each person only the roles their work needs. Every change is audited; you can't change your own roles."
      />
      {done ? (
        <Notice tone="success" live="polite">
          <p>{done}</p>
        </Notice>
      ) : null}
      <Card title="Grant a role">
        <p className="small muted">The person must have signed in to FleetTrust once.</p>
        <div className="grid">
          <TextField
            label="Email address"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
          <SelectField
            label="Role"
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
            label={`Grant ${STAFF_ROLE_LABELS[role]}`}
            phrase={email.trim().toLowerCase()}
            consequence={`${email.trim()} will be able to: ${STAFF_ROLE_SCOPES[role]}`}
            onConfirm={async () => {
              staff.setData(
                await api.grantStaffRole(email.trim().toLowerCase(), role, "staff.grant"),
              );
              setDone(`Granted ${STAFF_ROLE_LABELS[role]} to ${email.trim()}.`);
              setEmail("");
            }}
          />
        ) : null}
      </Card>

      {staff.status === "loading" ? <Loading /> : null}
      {staff.status === "error" ? <ErrorNotice error={staff.error} onRetry={staff.reload} /> : null}
      {staff.status === "ready" ? (
        <Card title="Current staff">
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Current staff">
            <table className="table">
              <caption className="visually-hidden">Current staff</caption>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Role</th>
                  <th scope="col">Since</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {staff.data.flatMap((member) =>
                  member.roles.map((held) => (
                    <tr key={`${member.userId}-${held.role}`}>
                      <td>
                        {member.displayName ?? "—"}
                        <span className="small muted" style={{ display: "block" }}>
                          {member.email ?? "no email"}
                        </span>
                      </td>
                      <td>{STAFF_ROLE_LABELS[held.role]}</td>
                      <td>{formatDate(held.since)}</td>
                      <td>
                        {member.userId === me.userId ? (
                          <span className="small muted">You</span>
                        ) : (
                          <ConfirmAction
                            label={`Revoke ${STAFF_ROLE_LABELS[held.role]}`}
                            phrase={member.email ?? "REVOKE"}
                            consequence={`${member.email ?? "This person"} loses this role straight away.`}
                            onConfirm={async () => {
                              staff.setData(
                                await api.revokeStaffRole(member.userId, held.role, "staff.revoke"),
                              );
                              setDone(
                                `Revoked ${STAFF_ROLE_LABELS[held.role]} from ${member.email ?? "the person"}.`,
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
