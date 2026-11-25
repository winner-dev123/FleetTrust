import { errorMessage, isOffline } from "@fleettrust/sdk";
import {
  DEFAULT_EMERGENCY_GUIDANCE,
  EMERGENCY_DISCLAIMER,
  formatDateTime,
  INCIDENT_CATEGORIES,
  INCIDENT_CATEGORY_LABELS,
  type TrustedContactDto,
} from "@fleettrust/types";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { SignInPrompt } from "../../src/components/feedback";
import { LocationPicker, type PickedLocation } from "../../src/components/location-picker";
import { useTheme } from "../../src/components/theme";
import {
  Body,
  Button,
  Choice,
  Heading,
  Loading,
  Notice,
  Screen,
  TextField,
  Toggle,
} from "../../src/components/ui";
import { useLoad } from "../../src/lib/use-load";
import { useOnline } from "../../src/state/network";
import { useSession } from "../../src/state/session";

type Category = (typeof INCIDENT_CATEGORIES)[number];
const CATEGORY_OPTIONS = INCIDENT_CATEGORIES.map((value) => ({
  value,
  label: INCIDENT_CATEGORY_LABELS[value],
}));

/** Official guidance first. Bundled in the app, so it shows offline and signed out. */
function Guidance({ number, text }: { number: string | null; text: string | null }) {
  const { platform } = useSession();
  return (
    <Notice tone="danger" title="If anyone is in danger">
      <Body>{text ?? DEFAULT_EMERGENCY_GUIDANCE}</Body>
      {number ? (
        <Button
          label={`Call ${number}`}
          variant="danger"
          large
          onPress={() => void platform.device.openExternal(`tel:${number}`)}
        />
      ) : null}
      <Body small>{EMERGENCY_DISCLAIMER}</Body>
    </Notice>
  );
}

/**
 * Raise an alert. One confirmation step guards against accidental taps; the alert ID is made
 * once, so pressing send twice or retrying after a dropped connection can't send two. Alerts
 * are never queued offline: a silent delay could mislead someone who needs help now.
 */
function RaiseAlert({ contacts }: { contacts: TrustedContactDto[] }) {
  const { api, platform } = useSession();
  const online = useOnline();
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
  const [clientIncidentId] = useState(() => platform.device.randomId());

  function review() {
    if (shareLocation && !location) {
      setError("Choose your location, or turn off “Share my location”.");
      return;
    }
    if (active.length === 0 && !nearby) {
      setError(
        "You have no active trusted contacts. Turn on “Also alert nearby providers”, or add a contact.",
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
      router.replace(`/emergency/${incident.id}`);
    } catch (failure) {
      setError(
        isOffline(failure)
          ? "The alert was not sent: we couldn't reach FleetTrust. If anyone is in danger, call your local emergency number now."
          : errorMessage(failure),
      );
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 16 }}>
      <Heading level={2}>Send an alert</Heading>
      {!online ? (
        <Notice tone="danger" title="You're offline" live>
          <Body>
            Alerts need a connection and can&apos;t be sent right now. If anyone is in danger, call
            your local emergency number.
          </Body>
        </Notice>
      ) : null}
      <Choice
        label="What's happening?"
        options={CATEGORY_OPTIONS}
        value={category}
        onChange={setCategory}
      />
      <TextField
        label="Short note"
        optional
        hint="For example: flat tyre on the N1 northbound, near the bridge."
        maxLength={500}
        value={note}
        onChangeText={setNote}
      />
      <Toggle
        label="Share my location with this alert"
        hint="Only for this alert. It's erased when the alert closes."
        value={shareLocation}
        onChange={setShareLocation}
      />
      {shareLocation ? (
        <LocationPicker value={location} onChange={setLocation} label="Your location" />
      ) : null}
      <Toggle
        label="Also alert nearby providers who offer roadside assistance"
        hint="They see the type of problem and an approximate area, not your name."
        value={nearby}
        onChange={setNearby}
      />
      <Body small>
        {active.length === 0
          ? "You have no active trusted contacts yet."
          : `Alerts go to ${String(active.length)} trusted ${active.length === 1 ? "contact" : "contacts"}: ${active
              .map((c) => c.person.displayName)
              .join(", ")}.`}
      </Body>
      {error ? (
        <Notice tone="danger" live>
          <Body>{error}</Body>
        </Notice>
      ) : null}
      {confirming ? (
        <Notice tone="danger" title="Send this alert now?" live>
          <Body>
            {INCIDENT_CATEGORY_LABELS[category]}
            {shareLocation && location ? ` · location: ${location.label}` : " · no location"}
            {nearby ? " · nearby providers too" : ""}
          </Body>
          <Button
            label={busy ? "Sending…" : "Yes, send alert"}
            variant="danger"
            large
            busy={busy}
            disabled={!online}
            onPress={() => void send()}
          />
          <Button
            label="Go back"
            variant="ghost"
            onPress={() => {
              setConfirming(false);
            }}
          />
        </Notice>
      ) : (
        <Button label="Send alert" variant="danger" large disabled={!online} onPress={review} />
      )}
    </View>
  );
}

function SignedInEmergency() {
  const { api } = useSession();
  const router = useRouter();
  const theme = useTheme();
  const data = useLoad(async () => {
    const [guidance, contacts, incidents] = await Promise.all([
      api.emergencyGuidance(),
      api.trustedContacts(),
      api.myIncidents(),
    ]);
    return { guidance, contacts, incidents };
  }, "emergency");

  if (data.status === "loading") {
    return (
      <>
        <Guidance number={null} text={null} />
        <Loading />
      </>
    );
  }
  if (data.status === "error") {
    return (
      <>
        <Guidance number={null} text={null} />
        <Notice
          tone="caution"
          title={isOffline(data.error) ? "You're offline" : "Alerts are unavailable"}
          live
        >
          <Body>
            {isOffline(data.error)
              ? "Alerts need a connection. Call your local emergency number if anyone is in danger."
              : errorMessage(data.error)}
          </Body>
          <Button label="Try again" variant="secondary" onPress={data.reload} />
        </Notice>
      </>
    );
  }
  return (
    <>
      <Guidance number={data.data.guidance.number} text={data.data.guidance.text} />
      {data.data.incidents
        .filter((incident) => incident.status === "active")
        .map((incident) => (
          <Notice key={incident.id} tone="danger" title="You have an active alert">
            <Body>
              {incident.categoryLabel} · raised {formatDateTime(incident.createdAt)}
            </Body>
            <Button
              label="Open alert"
              variant="danger"
              onPress={() => {
                router.push(`/emergency/${incident.id}`);
              }}
            />
          </Notice>
        ))}
      <RaiseAlert contacts={data.data.contacts} />
      <View style={{ gap: theme.spacing.sm }}>
        <Button
          label="Manage trusted contacts"
          variant="secondary"
          onPress={() => {
            router.push("/emergency/contacts");
          }}
        />
      </View>
    </>
  );
}

/**
 * Emergency: official guidance first, then alerts to trusted contacts and (optionally) nearby
 * providers. Never limited by a plan (ADR-0010). Wording never implies that help is certain.
 */
export default function EmergencyScreen() {
  const { status } = useSession();
  return (
    <Screen>
      <Heading>Emergency</Heading>
      {status === "signed-in" ? <SignedInEmergency /> : <Guidance number={null} text={null} />}
      {status === "signed-out" ? (
        <>
          <Body>
            With a free account you can choose trusted contacts. One tap sends them an alert with
            your situation and, if you choose, your location for that alert only. Emergency alerts
            are never limited by your plan.
          </Body>
          <SignInPrompt
            title="Sign in to send alerts"
            reason="Alerts go to trusted contacts you choose after signing in."
          />
        </>
      ) : null}
    </Screen>
  );
}
