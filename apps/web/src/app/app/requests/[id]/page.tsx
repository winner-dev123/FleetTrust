"use client";

import { copy, fill } from "@fleettrust/copy";
import { CATEGORY_LABELS, VEHICLE_TYPE_LABELS } from "@fleettrust/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type SubmitEvent, use, useState } from "react";

import { Button } from "@/components/button";
import { TextField } from "@/components/field";
import { Badge, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { errorMessage } from "@fleettrust/sdk";
import { formatDate, formatDateTime, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.app.request;

/** One request: the quotes received, accepting one, messaging providers, closing it. */
export default function RequestPage(props: PageProps<"/app/requests/[id]">) {
  const { id } = use(props.params);
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
  if (request.status === "error") {
    return <ErrorNotice error={request.error} onRetry={request.reload} />;
  }
  const data = request.data;
  const vehicle = [
    VEHICLE_TYPE_LABELS[data.vehicle.vehicleType],
    data.vehicle.make,
    data.vehicle.model,
    data.vehicle.registration,
  ]
    .filter(Boolean)
    .join(" · ");

  function cancel(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cancelReason.trim().length < 3) {
      setMessage({ ok: false, text: t.reasonTooShort });
      return;
    }
    void act("cancel", async () => {
      request.setData(await api.cancelServiceRequest(id, cancelReason.trim()));
      setMessage({ ok: true, text: t.cancelled });
    });
  }

  return (
    <>
      <PageHeader
        title={fill(t.title, { category: CATEGORY_LABELS[data.category] })}
        description={fill(t.description, {
          sent: formatDateTime(data.createdAt),
          until: formatDate(data.expiresAt),
        })}
      />
      <p>
        <Badge tone={data.status === "open" ? "caution" : "neutral"}>
          {titleCase(data.status)}
        </Badge>
      </p>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      <Card title={t.details}>
        <p>{data.description}</p>
        <p className="small muted" style={{ margin: 0 }}>
          {vehicle} · {titleCase(data.urgency)}
        </p>
      </Card>

      {data.agreement ? (
        <Notice tone="success" title={t.quoteAccepted}>
          <p>{fill(t.agreedPrice, { price: data.agreement.priceLabel })}</p>
          <p className="small">{data.agreement.disclaimer}</p>
        </Notice>
      ) : null}

      <section aria-labelledby="quotes-heading" className="stack">
        <h2 id="quotes-heading">{t.providersAndQuotes}</h2>
        {data.recipients.length === 0 ? <p className="muted">{t.noProviders}</p> : null}
        {data.recipients.map((recipient) => (
          <Card key={recipient.id} title={recipient.providerName} headingLevel={3}>
            <p className="small">
              <Badge>{titleCase(recipient.status)}</Badge>
              {recipient.providerSlug ? (
                <>
                  {" "}
                  · <Link href={`/providers/${recipient.providerSlug}`}>{t.viewProfile}</Link>
                </>
              ) : null}
            </p>
            {recipient.quotes
              .filter((quote) => quote.status === "active" || quote.status === "accepted")
              .map((quote) => (
                <div key={quote.id} className="card card--muted stack" style={{ gap: 8 }}>
                  <p style={{ margin: 0 }}>
                    <strong>{quote.price.label}</strong> {t.indicative}
                    {quote.status === "accepted" ? (
                      <>
                        {" "}
                        <Badge tone="verified">{t.accepted}</Badge>
                      </>
                    ) : null}
                  </p>
                  {quote.message ? <p style={{ margin: 0 }}>{quote.message}</p> : null}
                  <p className="small muted" style={{ margin: 0 }}>
                    {fill(t.validUntil, { date: formatDate(quote.validUntil) })}
                    {quote.availableFrom
                      ? ` · ${fill(t.canStart, { time: formatDateTime(quote.availableFrom) })}`
                      : ""}
                  </p>
                  <p className="small" style={{ margin: 0 }}>
                    {quote.scamWarning}
                  </p>
                  {data.status === "open" && quote.status === "active" ? (
                    <div>
                      <Button
                        busy={busy === quote.id}
                        onClick={() =>
                          void act(quote.id, async () => {
                            request.setData(await api.acceptQuote(id, quote.id));
                            setMessage({
                              ok: true,
                              text: fill(t.youAccepted, { provider: recipient.providerName }),
                            });
                          })
                        }
                      >
                        {t.acceptQuote}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            <div style={{ marginTop: 12 }}>
              <Button
                variant="ghost"
                busy={busy === `chat-${recipient.id}`}
                onClick={() =>
                  void act(`chat-${recipient.id}`, async () => {
                    const conversation = await api.openRequestConversation(recipient.id);
                    router.push(`/app/messages/${conversation.id}`);
                  })
                }
              >
                {fill(t.messageProvider, { provider: recipient.providerName })}
              </Button>
            </div>
          </Card>
        ))}
      </section>

      {data.status === "accepted" ? (
        <Card title={t.jobDone}>
          <Button
            busy={busy === "complete"}
            onClick={() =>
              void act("complete", async () => {
                request.setData(await api.completeServiceRequest(id));
                setMessage({ ok: true, text: t.markedCompleted });
              })
            }
          >
            {t.markCompleted}
          </Button>
        </Card>
      ) : null}

      {data.status === "open" || data.status === "accepted" ? (
        <Card title={t.cancelTitle}>
          <form className="cluster" style={{ alignItems: "flex-end" }} onSubmit={cancel}>
            <div style={{ flex: "1 1 240px" }}>
              <TextField
                label={t.reason}
                required
                maxLength={500}
                value={cancelReason}
                onChange={(event) => {
                  setCancelReason(event.target.value);
                }}
              />
            </div>
            <Button type="submit" variant="ghost" busy={busy === "cancel"}>
              {t.cancelRequest}
            </Button>
          </form>
        </Card>
      ) : null}
    </>
  );
}
