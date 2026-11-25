import { copy, fill } from "@fleettrust/copy";
import { errorMessage } from "@fleettrust/sdk";
import {
  CATEGORY_LABELS,
  formatDate,
  formatDateTime,
  titleCase,
  VEHICLE_TYPE_LABELS,
} from "@fleettrust/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { ErrorNotice, SignInPrompt } from "../../src/components/feedback";
import { PushPrompt } from "../../src/components/push-prompt";
import {
  Badge,
  Body,
  Button,
  Card,
  Heading,
  Loading,
  Notice,
  Screen,
  TextField,
} from "../../src/components/ui";
import { useLoad } from "../../src/lib/use-load";
import { useSession } from "../../src/state/session";

function RequestDetail({ id }: { id: string }) {
  const { api } = useSession();
  const router = useRouter();
  const request = useLoad(() => api.serviceRequest(id), `request-${id}`);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    setMessage(null);
    try {
      await work();
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    } finally {
      setBusy(null);
    }
  };

  if (request.status === "loading") return <Loading />;
  if (request.status === "error")
    return <ErrorNotice error={request.error} onRetry={request.reload} />;
  const data = request.data;
  const vehicle = [
    VEHICLE_TYPE_LABELS[data.vehicle.vehicleType],
    data.vehicle.make,
    data.vehicle.model,
    data.vehicle.registration,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Heading>{fill(copy.request.title, { category: CATEGORY_LABELS[data.category] })}</Heading>
      <Body small muted>
        {fill(copy.request.sent, {
          sent: formatDateTime(data.createdAt),
          until: formatDate(data.expiresAt),
        })}
      </Body>
      <Badge tone={data.status === "open" ? "caution" : "neutral"} label={titleCase(data.status)} />
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live>
          <Body>{message.text}</Body>
        </Notice>
      ) : null}
      {data.status === "open" ? <PushPrompt reason={copy.request.pushReason} /> : null}
      <Card title={copy.request.detailsTitle}>
        <Body>{data.description}</Body>
        <Body small muted>
          {vehicle} · {titleCase(data.urgency)}
        </Body>
      </Card>
      {data.agreement ? (
        <Notice tone="success" title={copy.request.acceptedTitle}>
          <Body>{fill(copy.request.agreedPrice, { price: data.agreement.priceLabel })}</Body>
          <Body small>{data.agreement.disclaimer}</Body>
        </Notice>
      ) : null}
      <Heading level={2}>{copy.request.providersTitle}</Heading>
      {data.recipients.length === 0 ? <Body muted>{copy.request.noProviders}</Body> : null}
      {data.recipients.map((recipient) => (
        <Card key={recipient.id} title={recipient.providerName}>
          <Badge label={titleCase(recipient.status)} />
          {recipient.quotes
            .filter((quote) => quote.status === "active" || quote.status === "accepted")
            .map((quote) => (
              <View key={quote.id} style={{ gap: 6 }}>
                <Body>
                  {fill(
                    quote.status === "accepted"
                      ? copy.request.quotePriceAccepted
                      : copy.request.quotePrice,
                    { price: quote.price.label },
                  )}
                </Body>
                {quote.message ? <Body>{quote.message}</Body> : null}
                <Body small muted>
                  {quote.availableFrom
                    ? fill(copy.request.validUntilStart, {
                        date: formatDate(quote.validUntil),
                        start: formatDateTime(quote.availableFrom),
                      })
                    : fill(copy.request.validUntil, { date: formatDate(quote.validUntil) })}
                </Body>
                <Body small>{quote.scamWarning}</Body>
                {data.status === "open" && quote.status === "active" ? (
                  <Button
                    label={copy.request.acceptQuote}
                    busy={busy === quote.id}
                    onPress={() =>
                      void act(quote.id, async () => {
                        request.setData(await api.acceptQuote(id, quote.id));
                        setMessage({
                          ok: true,
                          text: fill(copy.request.youAccepted, {
                            provider: recipient.providerName,
                          }),
                        });
                      })
                    }
                  />
                ) : null}
              </View>
            ))}
          {recipient.providerSlug ? (
            <Button
              label={copy.request.viewProfile}
              variant="ghost"
              onPress={() => {
                router.push(`/providers/${recipient.providerSlug ?? ""}`);
              }}
            />
          ) : null}
          <Button
            label={fill(copy.request.messageProvider, { provider: recipient.providerName })}
            variant="secondary"
            busy={busy === `chat-${recipient.id}`}
            onPress={() =>
              void act(`chat-${recipient.id}`, async () => {
                const conversation = await api.openRequestConversation(recipient.id);
                router.push(`/messages/${conversation.id}`);
              })
            }
          />
        </Card>
      ))}
      {data.status === "accepted" ? (
        <Card title={copy.request.jobDoneTitle}>
          <Button
            label={copy.request.markCompleted}
            busy={busy === "complete"}
            onPress={() =>
              void act("complete", async () => {
                request.setData(await api.completeServiceRequest(id));
                setMessage({ ok: true, text: copy.request.markedCompleted });
              })
            }
          />
        </Card>
      ) : null}
      {data.status === "open" || data.status === "accepted" ? (
        <Card title={copy.request.cancelTitle}>
          <TextField
            label={copy.request.reason}
            maxLength={500}
            value={cancelReason}
            onChangeText={setCancelReason}
          />
          <Button
            label={copy.request.cancelRequest}
            variant="ghost"
            busy={busy === "cancel"}
            onPress={() => {
              if (cancelReason.trim().length < 3) {
                setMessage({ ok: false, text: copy.request.reasonTooShort });
                return;
              }
              void act("cancel", async () => {
                request.setData(await api.cancelServiceRequest(id, cancelReason.trim()));
                setMessage({ ok: true, text: copy.request.cancelled });
              });
            }}
          />
        </Card>
      ) : null}
    </>
  );
}

export default function RequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status } = useSession();
  return (
    <Screen>
      {status === "loading" ? <Loading /> : null}
      {status === "signed-out" ? (
        <SignInPrompt title={copy.request.signInTitle} reason={copy.request.signInReason} />
      ) : null}
      {status === "signed-in" && typeof id === "string" ? <RequestDetail id={id} /> : null}
    </Screen>
  );
}
