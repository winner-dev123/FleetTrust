"use client";

import { copy, fill } from "@fleettrust/copy";
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
      setMessage({ ok: true, text: copy.web.privacy.downloading });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={copy.web.privacy.title}>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      <h3>{copy.web.privacy.choicesTitle}</h3>
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
                    ? fill(copy.web.privacy.lastChanged, {
                        time: formatDateTime(choice.recordedAt),
                      })
                    : copy.web.privacy.offByDefault
                }
                checked={choice.granted === true}
                onChange={(event) => void setChoice(choice, event.target.checked)}
              />
            ))
        : null}
      <h3>{copy.web.privacy.copyTitle}</h3>
      <p className="small">{copy.web.privacy.copyBody}</p>
      <div>
        <Button variant="secondary" busy={busy} onClick={() => void download()}>
          {copy.web.privacy.download}
        </Button>
      </div>
      <h3>{copy.web.privacy.deleteTitle}</h3>
      <p className="small">{copy.web.privacy.deleteBody}</p>
      <ConfirmAction
        label={copy.web.privacy.deleteButton}
        phrase={copy.web.privacy.deletePhrase}
        consequence={copy.web.privacy.deleteConsequence}
        onConfirm={async () => {
          await api.deleteAccount("account.delete");
          leaveSignedInAreaTo("/");
          await signOut();
        }}
      />
    </Card>
  );
}
