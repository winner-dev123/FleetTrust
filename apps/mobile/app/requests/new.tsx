import { errorMessage, isOffline } from "@fleettrust/sdk";
import {
  CATEGORY_LABELS,
  formatDateTime,
  PROVIDER_CATEGORIES,
  type PublicProviderProfile,
  VEHICLE_TYPE_LABELS,
  VEHICLE_TYPES,
} from "@fleettrust/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { SignInPrompt } from "../../src/components/feedback";
import { LocationPicker } from "../../src/components/location-picker";
import {
  Body,
  Button,
  Choice,
  Heading,
  Loading,
  Notice,
  Screen,
  TextField,
} from "../../src/components/ui";
import {
  emptyRequestDraft,
  REQUEST_DRAFT_ID,
  type RequestDraft,
  requestDraftSchema,
} from "../../src/lib/request-draft";
import { useOnline } from "../../src/state/network";
import { useSession } from "../../src/state/session";

const URGENCY_OPTIONS = [
  { value: "routine", label: "Routine" },
  { value: "soon", label: "In the next few days" },
  { value: "urgent", label: "Urgent (today)" },
] as const;

const CATEGORY_OPTIONS = PROVIDER_CATEGORIES.map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));
const VEHICLE_OPTIONS = VEHICLE_TYPES.map((value) => ({
  value,
  label: VEHICLE_TYPE_LABELS[value],
}));

/**
 * New service request. Everything typed is saved on the phone as you go (offline drafts), so
 * a lost signal or a closed app keeps it. Sending needs a connection and is never automatic;
 * retries reuse the draft's request ID, so a request is created (and counted) once.
 */
function RequestForm({ uid }: { uid: string }) {
  const params = useLocalSearchParams<{ provider?: string }>();
  const providerParam = typeof params.provider === "string" ? params.provider : null;
  const { api, drafts, platform } = useSession();
  const online = useOnline();
  const router = useRouter();
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [provider, setProvider] = useState<PublicProviderProfile | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void drafts.load(uid, "request", REQUEST_DRAFT_ID, requestDraftSchema).then((saved) => {
      if (!active) return;
      const base = saved?.value ?? emptyRequestDraft(platform.device.randomId());
      setDraft(providerParam ? { ...base, providerSlug: providerParam } : base);
      setRestoredAt(saved?.savedAt ?? null);
    });
    return () => {
      active = false;
    };
  }, [drafts, platform, providerParam, uid]);

  // Save as you type (after a short pause).
  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(() => {
      void drafts.save(uid, "request", REQUEST_DRAFT_ID, draft);
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [draft, drafts, uid]);

  const slug = draft?.providerSlug ?? null;
  useEffect(() => {
    if (!slug) return;
    let active = true;
    api.provider(slug).then(
      (profile) => {
        if (active) setProvider(profile);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api, slug]);

  if (!draft) return <Loading />;
  const update = (change: Partial<RequestDraft>) => {
    setDraft({ ...draft, ...change });
  };

  async function send(current: RequestDraft) {
    const found: Record<string, string> = {};
    if (current.description.trim().length < 10) {
      found["description"] = "Describe the problem in at least 10 characters.";
    }
    if (!current.location) found["location"] = "Choose where the vehicle is.";
    if (
      current.registration.trim() !== "" &&
      !/^[A-Za-z0-9 -]{2,15}$/.test(current.registration.trim())
    ) {
      found["registration"] = "Use letters, digits, spaces and hyphens only.";
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || !current.location) return;
    setBusy(true);
    setFailure(null);
    try {
      const created = await api.createServiceRequest({
        clientRequestId: current.clientRequestId,
        category: current.category,
        vehicle: {
          vehicleType: current.vehicleType,
          make: current.make.trim() || null,
          model: current.model.trim() || null,
          registration: current.registration.trim() || null,
        },
        location: { lat: current.location.lat, lng: current.location.lng },
        description: current.description.trim(),
        urgency: current.urgency,
        target: provider
          ? { mode: "direct", providerIds: [provider.organizationId] }
          : { mode: "match", radiusKm: 25 },
      });
      await drafts.discard(uid, "request", REQUEST_DRAFT_ID);
      router.replace(`/requests/${created.id}`);
    } catch (error) {
      setFailure(
        isOffline(error)
          ? "We couldn't reach FleetTrust. Your request is saved on this phone; send it again when you have signal."
          : errorMessage(error),
      );
      setBusy(false);
    }
  }

  return (
    <>
      {restoredAt ? (
        <Notice title="Draft restored" live>
          <Body>Saved on this phone {formatDateTime(restoredAt)}.</Body>
          <Button
            label="Start over"
            variant="ghost"
            onPress={() => {
              void drafts.discard(uid, "request", REQUEST_DRAFT_ID);
              setRestoredAt(null);
              setDraft(emptyRequestDraft(platform.device.randomId()));
            }}
          />
        </Notice>
      ) : null}
      {provider ? (
        <Notice>
          <Body>This request goes to {provider.tradingName} only.</Body>
        </Notice>
      ) : (
        <Body muted>Nearby providers who offer this service can send you quotes.</Body>
      )}
      <Choice
        label="Service"
        options={CATEGORY_OPTIONS}
        value={draft.category}
        onChange={(category) => {
          update({ category });
        }}
      />
      <TextField
        label="What's the problem?"
        hint="Symptoms, what you've tried, and when you need help."
        multiline
        maxLength={2000}
        value={draft.description}
        onChangeText={(description) => {
          update({ description });
        }}
        error={errors["description"]}
      />
      <Choice
        label="How soon?"
        options={URGENCY_OPTIONS}
        value={draft.urgency}
        onChange={(urgency) => {
          update({ urgency });
        }}
      />
      <Choice
        label="Vehicle type"
        options={VEHICLE_OPTIONS}
        value={draft.vehicleType}
        onChange={(vehicleType) => {
          update({ vehicleType });
        }}
      />
      <TextField
        label="Make"
        optional
        maxLength={60}
        value={draft.make}
        onChangeText={(make) => {
          update({ make });
        }}
      />
      <TextField
        label="Model"
        optional
        maxLength={60}
        value={draft.model}
        onChangeText={(model) => {
          update({ model });
        }}
      />
      <TextField
        label="Registration"
        optional
        maxLength={15}
        autoCapitalize="characters"
        value={draft.registration}
        onChangeText={(registration) => {
          update({ registration });
        }}
        error={errors["registration"]}
      />
      <LocationPicker
        label="Where is the vehicle?"
        value={draft.location}
        onChange={(location) => {
          update({ location });
        }}
      />
      {errors["location"] ? <Body tone="danger">{errors["location"]}</Body> : null}
      {failure ? (
        <Notice tone="danger" live>
          <Body>{failure}</Body>
        </Notice>
      ) : null}
      {!online ? (
        <Notice tone="caution" title="You're offline">
          <Body>Your request is saved on this phone. Send it when you have signal.</Body>
        </Notice>
      ) : null}
      <Button
        label="Send request"
        busy={busy}
        disabled={!online}
        hint={online ? undefined : "Needs a connection"}
        onPress={() => void send(draft)}
      />
      <Body small muted>
        Quotes are indicative. You agree the final price with the provider and pay them directly.
      </Body>
    </>
  );
}

export default function NewRequestScreen() {
  const { status, user } = useSession();
  return (
    <Screen>
      <Heading>Request a quote</Heading>
      {status === "loading" ? <Loading /> : null}
      {status === "signed-out" ? (
        <SignInPrompt
          title="Sign in to request quotes"
          reason="Providers reply to your account, so you need to sign in first."
        />
      ) : null}
      {status === "signed-in" && user ? <RequestForm uid={user.uid} /> : null}
    </Screen>
  );
}
