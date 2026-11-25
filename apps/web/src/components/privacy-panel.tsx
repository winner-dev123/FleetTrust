"use client";

import { errorMessage } from "@fleettrust/sdk";
import { CONSENT_LABELS, type ConsentStateDto, formatDateTime } from "@fleettrust/types";
import { useState } from "react";

import { useSession } from "@/lib/session";
import { leaveSignedInAreaTo } from "@/lib/session-exit";
import { useLoad } from "@/lib/use-load";

import { Button } from "./button";
import { ConfirmAction } from "./confirm-action";
import { Checkbox } from "./field";
import { ErrorNotice, Loading, Notice } from "./feedback";
import { Card } from "./layout";

/**
 * Privacy rights in the account page (Prompt 27): optional consents, a copy of your data,
 * and deleting the account.
 */
export function PrivacyPanel() {
  const { api, signOut } = useSession();
  const consents = useLoad(() => api.consents(), "consents");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function setChoice(choice: ConsentStateDto, granted: boolean) {
    setMessage(null);
    try {
      consents.setData(
        await api.recordConsent({
          purpose: choice.purpose,
          version: choice.currentVersion,
          granted,
        }),
      );
      setMessage({ ok: true, text: "Saved." });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  async function download() {
    setBusy(true);
    setMessage(null);
    try {
      const data = await api.exportMyData();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "fleettrust-data.json";
      link.click();
      URL.revokeObjectURL(url);
      setMessage({ ok: true, text: "Your data is downloading (fleettrust-data.json)." });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Privacy and your data">
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      <h3>Your choices</h3>
      {consents.status === "loading" ? <Loading /> : null}
      {consents.status === "error" ? (
        <ErrorNotice error={consents.error} onRetry={consents.reload} />
      ) : null}
      {consents.status === "ready"
        ? consents.data
            .filter((c) => !c.required)
            .map((choice) => (
              <Checkbox
                key={choice.purpose}
                label={CONSENT_LABELS[choice.purpose]}
                hint={
                  choice.recordedAt
                    ? `Last changed ${formatDateTime(choice.recordedAt)}`
                    : "Off unless you turn it on."
                }
                checked={choice.granted === true}
                onChange={(event) => void setChoice(choice, event.target.checked)}
              />
            ))
        : null}
      <h3>A copy of your data</h3>
      <p className="small">
        A file with your profile, requests, vehicles, messages you sent, articles and other records.
        Up to five a day.
      </p>
      <div>
        <Button variant="secondary" busy={busy} onClick={() => void download()}>
          Download my data
        </Button>
      </div>
      <h3>Delete your account</h3>
      <p className="small">
        Your profile, vehicles, contacts, lists, alerts and preferences are erased. Messages you
        sent stay for the people who received them, shown as from a deleted member. If you own an
        organization alone, make someone else an owner first. You may need to sign in again before
        deleting.
      </p>
      <ConfirmAction
        label="Delete my account"
        phrase="DELETE"
        consequence="Your FleetTrust account and personal data are erased and you are signed out."
        onConfirm={async () => {
          await api.deleteAccount("account.delete");
          leaveSignedInAreaTo("/");
          await signOut();
        }}
      />
    </Card>
  );
}
