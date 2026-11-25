"use client";

import type { IncidentDto } from "@fleettrust/types";
import Link from "next/link";
import { use, useEffect, useState } from "react";

import { Button } from "@/components/button";
import { Badge, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { errorMessage } from "@fleettrust/sdk";
import { formatDateTime, formatDistance, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const REFRESH_MS = 15_000;

/** One alert: who was notified, who responded, offers from providers, and closing it. */
export default function IncidentPage(props: PageProps<"/app/emergency/[id]">) {
  const { id } = use(props.params);
  const { api } = useSession();
  const incident = useLoad(() => api.incident(id), `incident-${id}`);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { reload } = incident;
  const active = incident.status === "ready" && incident.data.status === "active";

  // While the alert is active, refresh so new responses appear without reloading the page.
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(reload, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [active, reload]);

  async function close(kind: "resolve" | "cancel") {
    setBusy(true);
    try {
      const updated: IncidentDto =
        kind === "resolve" ? await api.resolveIncident(id) : await api.cancelIncident(id);
      incident.setData(updated);
      setMessage({
        ok: true,
        text: kind === "resolve" ? "Alert closed. Glad you're OK." : "Alert cancelled.",
      });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    } finally {
      setBusy(false);
    }
  }

  function updateLocation() {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        api
          .updateIncidentLocation(id, {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracyM: Math.round(position.coords.accuracy),
          })
          .then(
            (updated) => {
              incident.setData(updated);
              setMessage({ ok: true, text: "Location updated." });
            },
            (failure: unknown) => {
              setMessage({ ok: false, text: errorMessage(failure) });
            },
          );
      },
      () => {
        setMessage({ ok: false, text: "Location wasn't shared." });
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  if (incident.status === "loading") return <Loading label="Loading your alert…" />;
  if (incident.status === "error") {
    return <ErrorNotice error={incident.error} onRetry={incident.reload} />;
  }
  const data = incident.data;
  const acknowledged = data.contacts.filter((c) => c.acknowledgedAt !== null);

  return (
    <>
      <PageHeader
        title={`${data.categoryLabel} alert`}
        description={`Raised ${formatDateTime(data.createdAt)}`}
      />
      <p>
        <Badge tone={data.status === "active" ? "danger" : "neutral"}>
          {data.status === "active" ? "Active" : titleCase(data.status)}
        </Badge>
      </p>
      <Notice tone="danger" title={data.guidance.label}>
        <p>
          {data.guidance.number ? (
            <>
              Call <a href={`tel:${data.guidance.number}`}>{data.guidance.number}</a>.{" "}
            </>
          ) : null}
          {data.guidance.text}
        </p>
        <p className="small">{data.disclaimer}</p>
      </Notice>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}

      <Card title="Trusted contacts">
        <p role="status" aria-live="polite">
          {acknowledged.length === 0
            ? "No contact has responded yet."
            : `${String(acknowledged.length)} of ${String(data.contacts.length)} responded.`}
        </p>
        <ul className="list-plain">
          {data.contacts.map((contact) => (
            <li key={contact.userId}>
              <strong>{contact.displayName}</strong>{" "}
              {contact.acknowledgedAt ? (
                <Badge tone="verified">Responded {formatDateTime(contact.acknowledgedAt)}</Badge>
              ) : contact.notifiedAt ? (
                <Badge>Notified {formatDateTime(contact.notifiedAt)}</Badge>
              ) : (
                <Badge>Waiting to be notified</Badge>
              )}
            </li>
          ))}
        </ul>
        {data.conversationId ? (
          <p>
            <Link href={`/app/messages/${data.conversationId}`}>Message your contacts</Link>
          </p>
        ) : null}
      </Card>

      {data.providerOffers.length > 0 ? (
        <Card title="Offers from nearby providers">
          <p className="small muted">
            Agree any price before work starts and pay the provider directly. Never pay upfront to
            an account you can&apos;t verify.
          </p>
          <ul className="list-plain">
            {data.providerOffers.map((offer) => (
              <li key={offer.organizationId}>
                <strong>{offer.name}</strong>
                {offer.distanceKm !== null ? ` · ${formatDistance(offer.distanceKm * 1000)}` : ""}
                {offer.phone ? (
                  <>
                    {" "}
                    · <a href={`tel:${offer.phone}`}>{offer.phone}</a>
                  </>
                ) : null}
                {offer.message ? (
                  <span className="small" style={{ display: "block" }}>
                    {offer.message}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {data.status === "active" ? (
        <Card title="Close or update this alert">
          <div className="cluster">
            {data.location ? (
              <Button variant="secondary" onClick={updateLocation}>
                Update my location
              </Button>
            ) : null}
            <Button busy={busy} onClick={() => void close("resolve")}>
              I&apos;m OK now: close alert
            </Button>
            <Button variant="ghost" busy={busy} onClick={() => void close("cancel")}>
              Cancel: sent by mistake
            </Button>
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Alerts close by themselves at {formatDateTime(data.expiresAt)}. Your location is erased
            when the alert closes.
          </p>
        </Card>
      ) : null}
      <p>
        <Link href="/app/emergency">Back to emergency</Link>
      </p>
    </>
  );
}
