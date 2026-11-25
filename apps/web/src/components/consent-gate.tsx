"use client";

import { errorMessage } from "@fleettrust/sdk";
import { CONSENT_LABELS, type ConsentStateDto } from "@fleettrust/types";
import Link from "next/link";
import { type ReactNode, type SubmitEvent, useState } from "react";

import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { Button } from "./button";
import { Checkbox } from "./field";
import { Loading, Notice } from "./feedback";
import { PageHeader } from "./layout";

/**
 * Asks for the required consents (terms of service and privacy notice) before the signed-in
 * area, the first time and whenever their version changes. The choice is recorded with its
 * version and time (Prompt 27).
 */
export function ConsentGate({ children }: { children: ReactNode }) {
  const { api } = useSession();
  const consents = useLoad(() => api.consents(), "consent-gate");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (consents.status === "loading") return <Loading />;
  // Never lock someone out because the check failed; the API stays the boundary.
  if (consents.status === "error") return <>{children}</>;
  const missing = consents.data.filter((c) => c.needsAnswer);
  if (missing.length === 0) return <>{children}</>;

  async function accept(event: SubmitEvent<HTMLFormElement>, needed: ConsentStateDto[]) {
    event.preventDefault();
    if (!agreed) {
      setError("Tick the box to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let latest = consents.status === "ready" ? consents.data : [];
      for (const consent of needed) {
        latest = await api.recordConsent({
          purpose: consent.purpose,
          version: consent.currentVersion,
          granted: true,
        });
      }
      consents.setData(latest);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const updated = missing.some((c) => c.version !== null);
  return (
    <>
      <PageHeader
        title={updated ? "Our terms have changed" : "Before you start"}
        description="Please read and accept these to use FleetTrust."
      />
      <form className="stack" onSubmit={(event) => void accept(event, missing)}>
        <ul>
          {missing.map((c) => (
            <li key={c.purpose}>
              <Link
                href={c.purpose === "terms" ? "/legal/terms" : "/legal/privacy"}
                target="_blank"
              >
                {CONSENT_LABELS[c.purpose]}
              </Link>{" "}
              <span className="small muted">(version {c.currentVersion})</span>
            </li>
          ))}
        </ul>
        <Checkbox
          label="I agree to the terms of service and have read the privacy notice"
          checked={agreed}
          onChange={(event) => {
            setAgreed(event.target.checked);
          }}
        />
        {error ? (
          <Notice tone="danger" live="assertive">
            <p>{error}</p>
          </Notice>
        ) : null}
        <div>
          <Button type="submit" busy={busy}>
            Continue
          </Button>
        </div>
      </form>
    </>
  );
}
