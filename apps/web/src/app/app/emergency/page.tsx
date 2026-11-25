"use client";

import {
  INCIDENT_CATEGORIES,
  INCIDENT_CATEGORY_LABELS,
  type PersonDto,
  type TrustedContactDto,
} from "@fleettrust/types";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";

import { Button, ButtonLink } from "@/components/button";
import { Checkbox, TextArea, TextField } from "@/components/field";
import { Badge, EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { LocationPicker, type PickedLocation } from "@/components/location-picker";
import { errorMessage } from "@fleettrust/sdk";
import { formatDateTime, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

type Category = (typeof INCIDENT_CATEGORIES)[number];

/** Raise an alert. One confirmation step guards against accidental taps; retries are idempotent. */
function RaiseAlert({ contacts }: { contacts: TrustedContactDto[] }) {
  const { api } = useSession();
  const router = useRouter();
  const active = contacts.filter((c) => c.role === "my_contact" && c.status === "active");
  const [category, setCategory] = useState<Category>("breakdown");
  const [note, setNote] = useState("");
  const [shareLocation, setShareLocation] = useState(true);
  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [nearby, setNearby] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One ID per alert: pressing send twice, or retrying after a network error, can't duplicate it.
  const [clientIncidentId] = useState(() => crypto.randomUUID());

  function review(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (shareLocation && !location) {
      setError("Choose your location, or untick “Share my location”.");
      return;
    }
    if (active.length === 0 && !nearby) {
      setError(
        "You have no active trusted contacts. Tick “Also alert nearby providers”, or add a contact below.",
      );
      return;
    }
    setError(null);
    setConfirming(true);
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const incident = await api.raiseIncident({
        clientIncidentId,
        category,
        note: note.trim() === "" ? null : note.trim(),
        shareLocation,
        location:
          shareLocation && location
            ? { lat: location.lat, lng: location.lng, accuracyM: location.accuracyM }
            : null,
        notifyNearbyProviders: nearby,
      });
      router.push(`/app/emergency/${incident.id}`);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <section className="emergency-panel stack" aria-labelledby="raise-heading">
      <h2 id="raise-heading">Send an alert</h2>
      <form className="stack" onSubmit={review} noValidate>
        <fieldset className="field">
          <legend className="field__label">What&apos;s happening?</legend>
          <div className="grid" style={{ gap: 8 }}>
            {INCIDENT_CATEGORIES.map((value) => (
              <label key={value} className="checkbox card" style={{ padding: 8 }}>
                <input
                  type="radio"
                  name="category"
                  value={value}
                  checked={category === value}
                  onChange={() => {
                    setCategory(value);
                  }}
                  style={{ width: 22, height: 22, flex: "none" }}
                />
                <span>{INCIDENT_CATEGORY_LABELS[value]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <TextArea
          label="Short note"
          hint="For example: flat tyre on the N1 northbound, near the bridge."
          maxLength={500}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <Checkbox
          label="Share my location with this alert"
          hint="Only for this alert. It's erased when the alert closes."
          checked={shareLocation}
          onChange={(event) => {
            setShareLocation(event.target.checked);
          }}
        />
        {shareLocation ? (
          <LocationPicker value={location} onChange={setLocation} label="Your location" />
        ) : null}
        <Checkbox
          label="Also alert nearby providers who offer roadside assistance"
          hint="They see the type of problem and an approximate area, not your name."
          checked={nearby}
          onChange={(event) => {
            setNearby(event.target.checked);
          }}
        />
        <p className="small">
          {active.length === 0
            ? "You have no active trusted contacts yet."
            : `Alerts go to ${String(active.length)} trusted ${active.length === 1 ? "contact" : "contacts"}: ${active.map((c) => c.person.displayName).join(", ")}.`}
        </p>
        {error ? (
          <Notice tone="danger" live="assertive">
            <p>{error}</p>
          </Notice>
        ) : null}
        {confirming ? (
          <div className="card stack" role="alertdialog" aria-labelledby="confirm-heading">
            <h3 id="confirm-heading" className="card__title">
              Send this alert now?
            </h3>
            <p style={{ margin: 0 }}>
              {INCIDENT_CATEGORY_LABELS[category]}
              {shareLocation && location ? ` · location: ${location.label}` : " · no location"}
              {nearby ? " · nearby providers too" : ""}
            </p>
            <div className="cluster">
              <Button variant="danger" large busy={busy} onClick={() => void send()} autoFocus>
                {busy ? "Sending…" : "Yes, send alert"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Go back
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button type="submit" variant="danger" large>
              Send alert
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}

function TrustedContacts({
  contacts,
  onChange,
}: {
  contacts: TrustedContactDto[];
  onChange: () => void;
}) {
  const { api } = useSession();
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PersonDto[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const mine = contacts.filter((c) => c.role === "my_contact");
  const forOthers = contacts.filter((c) => c.role === "contact_for");

  const act = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      setMessage({ ok: true, text: done });
      onChange();
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  };

  async function search(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    try {
      setPeople(await api.searchPeople(query.trim(), 10));
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  return (
    <Card title="Trusted contacts">
      <p>
        People you trust to receive your alerts. They must accept before they can be alerted.
        Primary contacts are alerted first; backups if nobody responds in time.
      </p>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      {mine.length === 0 ? (
        <EmptyState title="No trusted contacts yet" />
      ) : (
        <ul className="list-plain">
          {mine.map((contact) => (
            <li key={contact.id} className="cluster cluster--between">
              <span>
                <strong>{contact.person.displayName}</strong>{" "}
                <Badge tone={contact.status === "active" ? "verified" : "neutral"}>
                  {contact.status === "active" && contact.muted
                    ? "Paused alerts"
                    : titleCase(contact.status)}
                </Badge>{" "}
                <span className="small muted">{titleCase(contact.priority)}</span>
              </span>
              <Button
                variant="ghost"
                onClick={() =>
                  void act(() => api.removeTrustedContact(contact.id), "Contact removed.")
                }
              >
                Remove {contact.person.displayName}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="cluster"
        style={{ alignItems: "flex-end", marginTop: 16 }}
        onSubmit={(event) => void search(event)}
      >
        <div style={{ flex: "1 1 220px" }}>
          <TextField
            label="Add a contact"
            hint="Search by display name"
            value={query}
            maxLength={50}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        <Button type="submit" variant="secondary">
          Search people
        </Button>
      </form>
      {people ? (
        people.length === 0 ? (
          <p className="muted">Nobody found with that name.</p>
        ) : (
          <ul className="list-plain" aria-label="People found" style={{ marginTop: 12 }}>
            {people.map((person) => (
              <li key={person.userId} className="cluster cluster--between">
                <span>{person.displayName}</span>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void act(
                      () => api.inviteTrustedContact(person.userId),
                      `Invitation sent to ${person.displayName}.`,
                    )
                  }
                >
                  Invite {person.displayName}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {forOthers.length > 0 ? (
        <>
          <h3 style={{ marginTop: 24 }}>You&apos;re a trusted contact for</h3>
          <ul className="list-plain">
            {forOthers.map((contact) => (
              <li key={contact.id} className="cluster cluster--between">
                <span>
                  {contact.person.displayName}{" "}
                  <Badge tone={contact.status === "active" ? "verified" : "neutral"}>
                    {titleCase(contact.status)}
                  </Badge>
                </span>
                {contact.status === "pending" ? (
                  <span className="cluster">
                    <Button
                      onClick={() =>
                        void act(
                          () => api.respondToTrustedContact(contact.id, true),
                          "You accepted.",
                        )
                      }
                    >
                      Accept
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void act(
                          () => api.respondToTrustedContact(contact.id, false),
                          "You declined.",
                        )
                      }
                    >
                      Decline
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

/**
 * Emergency: official guidance first, then alerts to trusted contacts and (optionally) nearby
 * providers. Never limited by a plan (ADR-0010). Wording never implies that help is certain.
 */
export default function EmergencyPage() {
  const { api } = useSession();
  const data = useLoad(async () => {
    const [guidance, contacts, incidents] = await Promise.all([
      api.emergencyGuidance(),
      api.trustedContacts(),
      api.myIncidents(),
    ]);
    return { guidance, contacts, incidents };
  }, "emergency");

  return (
    <>
      <PageHeader title="Emergency" />
      {data.status === "loading" ? <Loading /> : null}
      {data.status === "error" ? (
        <>
          <Notice tone="danger" title="If anyone is in danger">
            <p>Call your local emergency number now.</p>
          </Notice>
          <ErrorNotice error={data.error} onRetry={data.reload} />
        </>
      ) : null}
      {data.status === "ready" ? (
        <>
          <Notice tone="danger" title={data.data.guidance.label}>
            <p>
              {data.data.guidance.number ? (
                <>
                  Call <a href={`tel:${data.data.guidance.number}`}>{data.data.guidance.number}</a>
                  .{" "}
                </>
              ) : null}
              {data.data.guidance.text}
            </p>
            <p className="small">{data.data.guidance.disclaimer}</p>
          </Notice>
          {data.data.incidents
            .filter((incident) => incident.status === "active")
            .map((incident) => (
              <Notice key={incident.id} tone="danger" title="You have an active alert">
                <p>
                  {incident.categoryLabel} · raised {formatDateTime(incident.createdAt)}
                </p>
                <ButtonLink variant="danger" href={`/app/emergency/${incident.id}`}>
                  Open alert
                </ButtonLink>
              </Notice>
            ))}
          <RaiseAlert contacts={data.data.contacts} />
          <TrustedContacts contacts={data.data.contacts} onChange={data.reload} />
        </>
      ) : null}
    </>
  );
}
