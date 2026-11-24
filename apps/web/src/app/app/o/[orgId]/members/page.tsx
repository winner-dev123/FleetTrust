"use client";

import { ROLES_BY_KIND, type Role } from "@fleettrust/types";
import { type SubmitEvent, use, useState } from "react";

import { Button } from "@/components/button";
import { SelectField, TextField } from "@/components/field";
import { ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { errorMessage } from "@/lib/errors";
import { formatDate, titleCase } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { WithMembership } from "../org";

/** Members and invitations. Inviting needs `invitations.manage`; the API enforces every rule. */
export default function MembersPage(props: PageProps<"/app/o/[orgId]/members">) {
  const { orgId } = use(props.params);
  const { api } = useSession();
  const data = useLoad(async () => {
    const [members, invitations] = await Promise.all([
      api.listMembers(orgId),
      api.listInvitations(orgId).catch(() => []),
    ]);
    return { members, invitations };
  }, `members-${orgId}`);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);

  return (
    <WithMembership orgId={orgId}>
      {(membership) => {
        const roles: Role[] = ROLES_BY_KIND[membership.organization.kind].filter(
          (r) => r !== "owner",
        );
        const canInvite = membership.permissions.includes("invitations.manage");

        async function invite(event: SubmitEvent<HTMLFormElement>) {
          event.preventDefault();
          try {
            const created = await api.createInvitation(orgId, {
              email: email.trim(),
              role: roles.includes(role) ? role : (roles[0] ?? "staff"),
            });
            setEmail("");
            setLink(`${window.location.origin}${created.acceptPath}`);
            setMessage({
              ok: true,
              text: `Invitation created for ${created.invitation.email}. It expires ${formatDate(created.invitation.expiresAt)}. Send them the link below: it's shown only once.`,
            });
            data.reload();
          } catch (failure) {
            setMessage({ ok: false, text: errorMessage(failure) });
          }
        }

        return (
          <>
            <PageHeader title={`Members: ${membership.organization.name}`} />
            {message ? (
              <Notice tone={message.ok ? "success" : "danger"} live="polite">
                <p>{message.text}</p>
                {message.ok && link ? (
                  <TextField
                    label="Invitation link"
                    readOnly
                    value={link}
                    onFocus={(event) => {
                      event.target.select();
                    }}
                  />
                ) : null}
              </Notice>
            ) : null}
            {data.status === "loading" ? <Loading /> : null}
            {data.status === "error" ? (
              <ErrorNotice error={data.error} onRetry={data.reload} />
            ) : null}
            {data.status === "ready" ? (
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Members">
                <table className="table">
                  <caption className="visually-hidden">Members</caption>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Role</th>
                      <th scope="col">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.members.map((member) => (
                      <tr key={member.membershipId}>
                        <td>
                          {member.displayName ?? "—"}
                          {member.email ? (
                            <span className="small muted" style={{ display: "block" }}>
                              {member.email}
                            </span>
                          ) : null}
                        </td>
                        <td>{titleCase(member.role)}</td>
                        <td>{formatDate(member.joinedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {data.status === "ready" && data.data.invitations.length > 0 ? (
              <Card title="Pending invitations">
                <ul className="list-plain">
                  {data.data.invitations.map((invitation) => (
                    <li key={invitation.id}>
                      {invitation.email} · {titleCase(invitation.role)} · expires{" "}
                      {formatDate(invitation.expiresAt)}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            {canInvite ? (
              <Card title="Invite someone">
                <form className="stack" onSubmit={(event) => void invite(event)} noValidate>
                  <div className="grid">
                    <TextField
                      label="Email address"
                      type="email"
                      required
                      autoComplete="off"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                      }}
                    />
                    <SelectField
                      label="Role"
                      required
                      value={role}
                      onChange={(event) => {
                        setRole(roles.find((r) => r === event.target.value) ?? "staff");
                      }}
                      options={roles.map((value) => ({ value, label: titleCase(value) }))}
                    />
                  </div>
                  <p className="small muted">
                    You&apos;ll get a link to send them. Only that email address can accept it.
                  </p>
                  <div>
                    <Button type="submit">Send invitation</Button>
                  </div>
                </form>
              </Card>
            ) : null}
          </>
        );
      }}
    </WithMembership>
  );
}
