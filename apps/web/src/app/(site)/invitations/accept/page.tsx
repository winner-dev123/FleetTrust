"use client";

import { copy, fill } from "@fleettrust/copy";
import { ApiError } from "@fleettrust/sdk";
import type { MyOrganization } from "@fleettrust/types";
import { onAuthStateChanged } from "@firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ButtonLink } from "@/components/button";
import { Loading, Notice } from "@/components/feedback";
import { apiClient, firebaseAuth } from "@/lib/firebase";
import {
  clearPendingInvitation,
  pendingInvitation,
  savePendingInvitation,
  tokenFromHash,
} from "@/lib/pending-invitation";

type State =
  | { kind: "working" }
  | { kind: "joined"; membership: MyOrganization }
  | { kind: "failed"; message: string };

const MESSAGES: Record<string, string> = {
  invitation_expired: copy.web.invitation.expired,
  invitation_revoked: copy.web.invitation.revoked,
  invitation_used: copy.web.invitation.used,
  invitation_not_found: copy.web.invitation.notFound,
  invitation_email_mismatch: copy.web.invitation.emailMismatch,
  email_not_verified: copy.web.invitation.emailNotVerified,
  already_member: copy.web.invitation.alreadyMember,
  organization_suspended: copy.web.invitation.organizationSuspended,
};

/** Opened from an invitation link: `/invitations/accept#token=…`. */
export default function AcceptInvitationPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "working" });

  useEffect(() => {
    const fromLink = tokenFromHash(window.location.hash);
    if (fromLink) {
      savePendingInvitation(fromLink);
      // Drop the token from the address bar and history.
      window.history.replaceState(null, "", "/invitations/accept");
    }

    return onAuthStateChanged(firebaseAuth(), (user) => {
      const token = pendingInvitation();
      if (!token) {
        setState({ kind: "failed", message: copy.web.invitation.incomplete });
        return;
      }
      if (!user) {
        router.replace("/sign-in");
        return;
      }
      apiClient()
        .acceptInvitation(token)
        .then((membership) => {
          clearPendingInvitation();
          setState({ kind: "joined", membership });
        })
        .catch((error: unknown) => {
          const reason = error instanceof ApiError ? error.reason : undefined;
          // Wrong account: keep the token so signing in with the right one can still use it.
          if (reason !== "invitation_email_mismatch" && reason !== "email_not_verified") {
            clearPendingInvitation();
          }
          setState({
            kind: "failed",
            message: (reason && MESSAGES[reason]) ?? copy.web.invitation.failed,
          });
        });
    });
  }, [router]);

  return (
    <div className="container container--readable stack">
      <title>{copy.web.invitation.pageTitle}</title>
      <h1>{copy.web.invitation.title}</h1>
      {state.kind === "working" && <Loading label={copy.web.invitation.checking} />}
      {state.kind === "joined" && (
        <Notice tone="success" live="polite">
          <p>
            {copy.web.invitation.joinedBefore} <strong>{state.membership.organization.name}</strong>{" "}
            {fill(copy.web.invitation.joinedAs, { role: state.membership.role })}
          </p>
          <ButtonLink href={`/app/o/${state.membership.organization.id}`}>
            {fill(copy.web.invitation.open, { name: state.membership.organization.name })}
          </ButtonLink>
        </Notice>
      )}
      {state.kind === "failed" && (
        <Notice tone="danger" live="assertive">
          <p>{state.message}</p>
        </Notice>
      )}
    </div>
  );
}
