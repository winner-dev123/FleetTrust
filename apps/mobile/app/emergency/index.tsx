import { copy, fill, plural } from "@fleettrust/copy";
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
    <Notice tone="danger" title={copy.emergency.dangerTitle}>
      <Body>{text ?? DEFAULT_EMERGENCY_GUIDANCE}</Body>
      {number ? (
        <Button
          label={fill(copy.emergency.call, { number })}
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
      setError(copy.emergency.chooseLocation);
      return;
    }
    if (active.length === 0 && !nearby) {
      setError(copy.emergency.noContactsError);
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
      setError(isOffline(failure) ? copy.emergency.notSentOffline : errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 16 }}>
      <Heading level={2}>{copy.emergency.sendAlertTitle}</Heading>
      {!online ? (
        <Notice tone="danger" title={copy.emergency.offlineTitle} live>
          <Body>{copy.emergency.offlineBody}</Body>
        </Notice>
      ) : null}
      <Choice
        label={copy.emergency.whatsHappening}
        options={CATEGORY_OPTIONS}
        value={category}
        onChange={setCategory}
      />
      <TextField
        label={copy.emergency.noteLabel}
        optional
        hint={copy.emergency.noteHint}
        maxLength={500}
        value={note}
        onChangeText={setNote}
      />
      <Toggle
        label={copy.emergency.shareLocation}
        hint={copy.emergency.shareLocationHint}
        value={shareLocation}
        onChange={setShareLocation}
      />
      {shareLocation ? (
        <LocationPicker
          value={location}
          onChange={setLocation}
          label={copy.emergency.yourLocation}
        />
      ) : null}
      <Toggle
        label={copy.emergency.alertNearby}
        hint={copy.emergency.alertNearbyHint}
        value={nearby}
        onChange={setNearby}
      />
      <Body small>
        {active.length === 0
          ? copy.emergency.noContactsYet
          : plural(active.length, copy.emergency.alertsGoTo, {
              names: active.map((c) => c.person.displayName).join(", "),
            })}
      </Body>
      {error ? (
        <Notice tone="danger" live>
          <Body>{error}</Body>
        </Notice>
      ) : null}
      {confirming ? (
        <Notice tone="danger" title={copy.emergency.confirmTitle} live>
          <Body>
            {[
              INCIDENT_CATEGORY_LABELS[category],
              shareLocation && location
                ? fill(copy.emergency.summaryLocation, { place: location.label })
                : copy.emergency.summaryNoLocation,
              nearby ? copy.emergency.summaryNearby : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Body>
          <Button
            label={busy ? copy.emergency.sending : copy.emergency.confirmSend}
            variant="danger"
            large
            busy={busy}
            disabled={!online}
            onPress={() => void send()}
          />
          <Button
            label={copy.emergency.goBack}
            variant="ghost"
            onPress={() => {
              setConfirming(false);
            }}
          />
        </Notice>
      ) : (
        <Button
          label={copy.emergency.sendAlert}
          variant="danger"
          large
          disabled={!online}
          onPress={review}
        />
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
          title={
            isOffline(data.error) ? copy.emergency.offlineTitle : copy.emergency.unavailableTitle
          }
          live
        >
          <Body>
            {isOffline(data.error) ? copy.emergency.needConnection : errorMessage(data.error)}
          </Body>
          <Button label={copy.common.tryAgain} variant="secondary" onPress={data.reload} />
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
          <Notice key={incident.id} tone="danger" title={copy.emergency.activeAlertTitle}>
            <Body>
              {fill(copy.emergency.raisedAt, {
                category: incident.categoryLabel,
                time: formatDateTime(incident.createdAt),
              })}
            </Body>
            <Button
              label={copy.emergency.openAlert}
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
          label={copy.emergency.manageContacts}
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
      <Heading>{copy.emergency.title}</Heading>
      {status === "signed-in" ? <SignedInEmergency /> : <Guidance number={null} text={null} />}
      {status === "signed-out" ? (
        <>
          <Body>{copy.emergency.signedOutIntro}</Body>
          <SignInPrompt title={copy.emergency.signInTitle} reason={copy.emergency.signInReason} />
        </>
      ) : null}
    </Screen>
  );
}
