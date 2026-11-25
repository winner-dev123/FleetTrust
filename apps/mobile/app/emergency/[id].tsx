import { errorMessage } from "@fleettrust/sdk";
import { formatDateTime, formatDistance, type IncidentDto, titleCase } from "@fleettrust/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { ErrorNotice, SignInPrompt } from "../../src/components/feedback";
import {
  Badge,
  Body,
  Button,
  Card,
  Heading,
  Loading,
  Notice,
  Screen,
} from "../../src/components/ui";
import { useLoad } from "../../src/lib/use-load";
import { useSession } from "../../src/state/session";

const REFRESH_MS = 15_000;

/** One alert: who was notified, who responded, offers from providers, and closing it. */
function Incident({ id }: { id: string }) {
  const { api, platform } = useSession();
  const router = useRouter();
  const incident = useLoad(() => api.incident(id), `incident-${id}`);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { reload } = incident;
  const active = incident.status === "ready" && incident.data.status === "active";

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(reload, REFRESH_MS);
    return () => {
      clearInterval(timer);
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

  async function updateLocation() {
    try {
      if ((await platform.location.permission()) !== "granted") {
        setMessage({
          ok: false,
          text: "Location isn't allowed for FleetTrust, so it can't be updated.",
        });
        return;
      }
      const position = await platform.location.current();
      incident.setData(
        await api.updateIncidentLocation(id, {
          lat: position.lat,
          lng: position.lng,
          accuracyM: position.accuracyM === null ? null : Math.round(position.accuracyM),
        }),
      );
      setMessage({ ok: true, text: "Location updated." });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  if (incident.status === "loading") return <Loading label="Loading your alert…" />;
  if (incident.status === "error") return <ErrorNotice error={incident.error} onRetry={reload} />;
  const data = incident.data;
  const acknowledged = data.contacts.filter((c) => c.acknowledgedAt !== null);

  return (
    <>
      <Heading>{`${data.categoryLabel} alert`}</Heading>
      <Body small muted>
        Raised {formatDateTime(data.createdAt)}
      </Body>
      <Badge
        tone={data.status === "active" ? "danger" : "neutral"}
        label={data.status === "active" ? "Active" : titleCase(data.status)}
      />
      <Notice tone="danger" title={data.guidance.label}>
        <Body>{data.guidance.text}</Body>
        {data.guidance.number ? (
          <Button
            label={`Call ${data.guidance.number}`}
            variant="danger"
            large
            onPress={() => void platform.device.openExternal(`tel:${data.guidance.number ?? ""}`)}
          />
        ) : null}
        <Body small>{data.disclaimer}</Body>
      </Notice>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live>
          <Body>{message.text}</Body>
        </Notice>
      ) : null}
      <Card title="Trusted contacts">
        <Body>
          {acknowledged.length === 0
            ? "No contact has responded yet."
            : `${String(acknowledged.length)} of ${String(data.contacts.length)} responded.`}
        </Body>
        {data.contacts.map((contact) => (
          <Body key={contact.userId}>
            {contact.displayName}:{" "}
            {contact.acknowledgedAt
              ? `responded ${formatDateTime(contact.acknowledgedAt)}`
              : contact.notifiedAt
                ? `notified ${formatDateTime(contact.notifiedAt)}`
                : "waiting to be notified"}
          </Body>
        ))}
        {data.conversationId ? (
          <Button
            label="Message your contacts"
            variant="secondary"
            onPress={() => {
              router.push(`/messages/${data.conversationId ?? ""}`);
            }}
          />
        ) : null}
      </Card>
      {data.providerOffers.length > 0 ? (
        <Card title="Offers from nearby providers">
          <Body small muted>
            Agree any price before work starts and pay the provider directly. Never pay upfront to
            an account you can&apos;t verify.
          </Body>
          {data.providerOffers.map((offer) => (
            <Body key={offer.organizationId}>
              {offer.name}
              {offer.distanceKm !== null ? ` · ${formatDistance(offer.distanceKm * 1000)}` : ""}
              {offer.phone ? ` · ${offer.phone}` : ""}
              {offer.message ? `\n${offer.message}` : ""}
            </Body>
          ))}
        </Card>
      ) : null}
      {data.status === "active" ? (
        <Card title="Close or update this alert">
          {data.location ? (
            <Button
              label="Update my location"
              variant="secondary"
              onPress={() => void updateLocation()}
            />
          ) : null}
          <Button
            label="I'm OK now: close alert"
            busy={busy}
            onPress={() => void close("resolve")}
          />
          <Button
            label="Cancel: sent by mistake"
            variant="ghost"
            busy={busy}
            onPress={() => void close("cancel")}
          />
          <Body small muted>
            Alerts close by themselves at {formatDateTime(data.expiresAt)}. Your location is erased
            when the alert closes.
          </Body>
        </Card>
      ) : null}
    </>
  );
}

export default function IncidentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status } = useSession();
  return (
    <Screen>
      {status === "loading" ? <Loading /> : null}
      {status === "signed-out" ? (
        <SignInPrompt
          title="Sign in to see this alert"
          reason="Alerts are visible to the person who raised them and their trusted contacts."
        />
      ) : null}
      {status === "signed-in" && typeof id === "string" ? <Incident id={id} /> : null}
    </Screen>
  );
}
