"use client";

import { copy, fill, plural } from "@fleettrust/copy";
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

const t = copy.web.app.emergency;

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
      setError(t.locationMissing);
      return;
    }
    if (active.length === 0 && !nearby) {
      setError(t.noContactsError);
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
      <h2 id="raise-heading">{t.sendAnAlert}</h2>
      <form className="stack" onSubmit={review} noValidate>
        <fieldset className="field">
          <legend className="field__label">{t.whatsHappening}</legend>
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
          label={t.note}
          hint={t.noteHint}
          maxLength={500}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <Checkbox
          label={t.shareLocation}
          hint={t.shareLocationHint}
          checked={shareLocation}
          onChange={(event) => {
            setShareLocation(event.target.checked);
          }}
        />
        {shareLocation ? (
          <LocationPicker value={location} onChange={setLocation} label={t.yourLocation} />
        ) : null}
        <Checkbox
          label={t.nearby}
          hint={t.nearbyHint}
          checked={nearby}
          onChange={(event) => {
            setNearby(event.target.checked);
          }}
        />
        <p className="small">
          {active.length === 0
            ? t.noContacts
            : plural(active.length, t.alertsGoTo, {
                names: active.map((c) => c.person.displayName).join(", "),
              })}
        </p>
        {error ? (
          <Notice tone="danger" live="assertive">
            <p>{error}</p>
          </Notice>
        ) : null}
        {confirming ? (
          <div className="card stack" role="alertdialog" aria-labelledby="confirm-heading">
            <h3 id="confirm-heading" className="card__title">
              {t.confirmTitle}
            </h3>
            <p style={{ margin: 0 }}>
              {[
                INCIDENT_CATEGORY_LABELS[category],
                shareLocation && location
                  ? fill(t.confirmLocation, { place: location.label })
                  : t.confirmNoLocation,
                nearby ? t.confirmNearby : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="cluster">
              <Button variant="danger" large busy={busy} onClick={() => void send()} autoFocus>
                {busy ? t.sending : t.confirmSend}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {t.goBack}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button type="submit" variant="danger" large>
              {t.send}
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
    <Card title={t.contacts}>
      <p>{t.contactsIntro}</p>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      {mine.length === 0 ? (
        <EmptyState title={t.noContactsTitle} />
      ) : (
        <ul className="list-plain">
          {mine.map((contact) => (
            <li key={contact.id} className="cluster cluster--between">
              <span>
                <strong>{contact.person.displayName}</strong>{" "}
                <Badge tone={contact.status === "active" ? "verified" : "neutral"}>
                  {contact.status === "active" && contact.muted
                    ? t.paused
                    : titleCase(contact.status)}
                </Badge>{" "}
                <span className="small muted">{titleCase(contact.priority)}</span>
              </span>
              <Button
                variant="ghost"
                onClick={() => void act(() => api.removeTrustedContact(contact.id), t.removed)}
              >
                {fill(t.remove, { name: contact.person.displayName })}
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
            label={t.addContact}
            hint={t.addContactHint}
            value={query}
            maxLength={50}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        <Button type="submit" variant="secondary">
          {t.searchPeople}
        </Button>
      </form>
      {people ? (
        people.length === 0 ? (
          <p className="muted">{t.nobodyFound}</p>
        ) : (
          <ul className="list-plain" aria-label={t.peopleFound} style={{ marginTop: 12 }}>
            {people.map((person) => (
              <li key={person.userId} className="cluster cluster--between">
                <span>{person.displayName}</span>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void act(
                      () => api.inviteTrustedContact(person.userId),
                      fill(t.invitationSent, { name: person.displayName }),
                    )
                  }
                >
                  {fill(t.invite, { name: person.displayName })}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {forOthers.length > 0 ? (
        <>
          <h3 style={{ marginTop: 24 }}>{t.contactFor}</h3>
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
                        void act(() => api.respondToTrustedContact(contact.id, true), t.youAccepted)
                      }
                    >
                      {t.accept}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void act(
                          () => api.respondToTrustedContact(contact.id, false),
                          t.youDeclined,
                        )
                      }
                    >
                      {t.decline}
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
      <PageHeader title={t.title} />
      {data.status === "loading" ? <Loading /> : null}
      {data.status === "error" ? (
        <>
          <Notice tone="danger" title={t.dangerTitle}>
            <p>{t.dangerBody}</p>
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
                  {t.call}{" "}
                  <a href={`tel:${data.data.guidance.number}`}>{data.data.guidance.number}</a>.{" "}
                </>
              ) : null}
              {data.data.guidance.text}
            </p>
            <p className="small">{data.data.guidance.disclaimer}</p>
          </Notice>
          {data.data.incidents
            .filter((incident) => incident.status === "active")
            .map((incident) => (
              <Notice key={incident.id} tone="danger" title={t.activeAlert}>
                <p>
                  {fill(t.raised, {
                    category: incident.categoryLabel,
                    time: formatDateTime(incident.createdAt),
                  })}
                </p>
                <ButtonLink variant="danger" href={`/app/emergency/${incident.id}`}>
                  {t.openAlert}
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
