"use client";

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
  invitation_expired: "This invitation has expired. Ask for a new one.",
  invitation_revoked: "This invitation was withdrawn or replaced by a newer one.",
  invitation_used: "This invitation has already been used.",
  invitation_not_found: "We couldn't find this invitation. Check that you opened the whole link.",
  invitation_email_mismatch:
    "This invitation was sent to a different email address. Sign in with that address to accept it.",
  email_not_verified: "Verify your email address, then open the invitation again.",
  already_member: "You're already a member of this organization.",
  organization_suspended: "This organization is currently suspended.",
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
        setState({ kind: "failed", message: "This invitation link is incomplete." });
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
            message:
              (reason && MESSAGES[reason]) ?? "Something went wrong. Please try the link again.",
          });
        });
    });
  }, [router]);

  return (
    <div className="container container--readable stack">
      <title>Invitation · FleetTrust</title>
      <h1>Invitation</h1>
      {state.kind === "working" && <Loading label="Checking your invitation…" />}
      {state.kind === "joined" && (
        <Notice tone="success" live="polite">
          <p>
            You joined <strong>{state.membership.organization.name}</strong> as{" "}
            {state.membership.role}.
          </p>
          <ButtonLink href={`/app/o/${state.membership.organization.id}`}>
            Open {state.membership.organization.name}
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
