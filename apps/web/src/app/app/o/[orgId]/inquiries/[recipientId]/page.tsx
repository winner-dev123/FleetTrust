"use client";

import { CATEGORY_LABELS, VEHICLE_TYPE_LABELS } from "@fleettrust/types";
import { useRouter } from "next/navigation";
import { type SubmitEvent, use, useState } from "react";

import { Button } from "@/components/button";
import { TextArea } from "@/components/field";
import { Badge, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { PriceFields } from "@/components/price-fields";
import { errorMessage } from "@fleettrust/sdk";
import { formatDate, formatDistance, titleCase } from "@fleettrust/types";
import { EMPTY_PRICE, priceFromDraft } from "@/lib/price";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

/** One inquiry: the customer's request and sending an indicative quote. */
export default function InquiryPage(props: PageProps<"/app/o/[orgId]/inquiries/[recipientId]">) {
  const { orgId, recipientId } = use(props.params);
  const { api } = useSession();
  const router = useRouter();
  const inquiry = useLoad(() => api.inquiry(orgId, recipientId), `inquiry-${recipientId}`);
  const [price, setPrice] = useState(EMPTY_PRICE);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function quote(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = priceFromDraft(price);
    if (!parsed.ok) {
      setMessage({ ok: false, text: parsed.error });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      inquiry.setData(
        await api.submitQuote(orgId, recipientId, {
          price: parsed.price,
          message: note.trim() || null,
        }),
      );
      setMessage({ ok: true, text: "Quote sent. The customer will be notified." });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    } finally {
      setBusy(false);
    }
  }

  if (inquiry.status === "loading") return <Loading />;
  if (inquiry.status === "error") {
    return <ErrorNotice error={inquiry.error} onRetry={inquiry.reload} />;
  }
  const data = inquiry.data;
  const open =
    data.status === "open" && ["pending", "viewed", "quoted"].includes(data.recipientStatus);

  return (
    <>
      <PageHeader
        title={`${CATEGORY_LABELS[data.category]} inquiry`}
        description={`Quotes accepted until ${formatDate(data.expiresAt)}`}
      />
      <p>
        <Badge>{titleCase(data.recipientStatus)}</Badge>
      </p>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      <Card title="Request">
        <p>{data.description}</p>
        <p className="small muted" style={{ margin: 0 }}>
          {VEHICLE_TYPE_LABELS[data.vehicle.vehicleType]}
          {data.vehicle.make ? ` · ${data.vehicle.make}` : ""}
          {data.vehicle.model ? ` ${data.vehicle.model}` : ""} · {titleCase(data.urgency)}
          {data.distanceKm !== null
            ? ` · ${data.location.approximate ? "about " : ""}${formatDistance(data.distanceKm * 1000)} away`
            : ""}
        </p>
        {data.location.approximate ? (
          <p className="small muted" style={{ marginBottom: 0 }}>
            The exact location is shared if the customer accepts your quote.
          </p>
        ) : data.locationNote ? (
          <p className="small" style={{ marginBottom: 0 }}>
            Location note: {data.locationNote}
          </p>
        ) : null}
      </Card>
      {data.referredBy ? (
        <Notice title={`Referred by ${data.referredBy.name}`}>
          <p className="small">
            {data.referredBy.relationshipLabel}
            {data.referredBy.relationshipDetails ? `: ${data.referredBy.relationshipDetails}` : ""}
          </p>
        </Notice>
      ) : null}
      {data.quotes.length > 0 ? (
        <Card title="Your quotes">
          <ul className="list-plain">
            {data.quotes.map((sent) => (
              <li key={sent.id}>
                <strong>{sent.price.label}</strong> <Badge>{titleCase(sent.status)}</Badge>
                <span className="small muted" style={{ display: "block" }}>
                  Valid until {formatDate(sent.validUntil)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {open ? (
        <Card title="Send a quote">
          <form className="stack" onSubmit={(event) => void quote(event)} noValidate>
            <PriceFields value={price} onChange={setPrice} />
            <TextArea
              label="Message to the customer"
              maxLength={2000}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
            <p className="small muted">
              Never ask for a deposit through a link: FleetTrust warns customers about that.
            </p>
            <div className="cluster">
              <Button type="submit" busy={busy}>
                Send quote
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  void api.declineInquiry(orgId, recipientId).then(
                    () => {
                      router.push(`/app/o/${orgId}/inquiries`);
                    },
                    (failure: unknown) => {
                      setMessage({ ok: false, text: errorMessage(failure) });
                    },
                  )
                }
              >
                Decline
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
