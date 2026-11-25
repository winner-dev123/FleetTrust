import { copy, fill } from "@fleettrust/copy";
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
        text: kind === "resolve" ? copy.incident.closedResolved : copy.incident.cancelled,
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
          text: copy.incident.locationNotAllowed,
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
      setMessage({ ok: true, text: copy.incident.locationUpdated });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  if (incident.status === "loading") return <Loading label={copy.incident.loading} />;
  if (incident.status === "error") return <ErrorNotice error={incident.error} onRetry={reload} />;
  const data = incident.data;
  const acknowledged = data.contacts.filter((c) => c.acknowledgedAt !== null);

  return (
    <>
      <Heading>{fill(copy.incident.title, { category: data.categoryLabel })}</Heading>
      <Body small muted>
        {fill(copy.incident.raised, { time: formatDateTime(data.createdAt) })}
      </Body>
      <Badge
        tone={data.status === "active" ? "danger" : "neutral"}
        label={data.status === "active" ? copy.incident.active : titleCase(data.status)}
      />
      <Notice tone="danger" title={data.guidance.label}>
        <Body>{data.guidance.text}</Body>
        {data.guidance.number ? (
          <Button
            label={fill(copy.emergency.call, { number: data.guidance.number })}
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
      <Card title={copy.incident.contactsTitle}>
        <Body>
          {acknowledged.length === 0
            ? copy.incident.noResponseYet
            : fill(copy.incident.responded, {
                count: acknowledged.length,
                total: data.contacts.length,
              })}
        </Body>
        {data.contacts.map((contact) => (
          <Body key={contact.userId}>
            {contact.acknowledgedAt
              ? fill(copy.incident.contactResponded, {
                  name: contact.displayName,
                  time: formatDateTime(contact.acknowledgedAt),
                })
              : contact.notifiedAt
                ? fill(copy.incident.contactNotified, {
                    name: contact.displayName,
                    time: formatDateTime(contact.notifiedAt),
                  })
                : fill(copy.incident.contactWaiting, { name: contact.displayName })}
          </Body>
        ))}
        {data.conversationId ? (
          <Button
            label={copy.incident.messageContacts}
            variant="secondary"
            onPress={() => {
              router.push(`/messages/${data.conversationId ?? ""}`);
            }}
          />
        ) : null}
      </Card>
      {data.providerOffers.length > 0 ? (
        <Card title={copy.incident.offersTitle}>
          <Body small muted>
            {copy.incident.offersNote}
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
        <Card title={copy.incident.closeTitle}>
          {data.location ? (
            <Button
              label={copy.incident.updateLocation}
              variant="secondary"
              onPress={() => void updateLocation()}
            />
          ) : null}
          <Button label={copy.incident.resolve} busy={busy} onPress={() => void close("resolve")} />
          <Button
            label={copy.incident.cancel}
            variant="ghost"
            busy={busy}
            onPress={() => void close("cancel")}
          />
          <Body small muted>
            {fill(copy.incident.autoClose, { time: formatDateTime(data.expiresAt) })}
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
        <SignInPrompt title={copy.incident.signInTitle} reason={copy.incident.signInReason} />
      ) : null}
      {status === "signed-in" && typeof id === "string" ? <Incident id={id} /> : null}
    </Screen>
  );
}
