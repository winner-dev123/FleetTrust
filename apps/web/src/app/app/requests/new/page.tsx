"use client";

import {
  CATEGORY_LABELS,
  PROVIDER_CATEGORIES,
  type ProviderCategory,
  type PublicProviderProfile,
  REQUEST_URGENCIES,
  VEHICLE_TYPE_LABELS,
  VEHICLE_TYPES,
} from "@fleettrust/types";
import { useRouter, useSearchParams } from "next/navigation";
import { type SubmitEvent, Suspense, useEffect, useState } from "react";

import { Button } from "@/components/button";
import { SelectField, TextArea, TextField } from "@/components/field";
import { Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { LocationPicker, type PickedLocation } from "@/components/location-picker";
import { errorMessage } from "@fleettrust/sdk";
import { titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";

type VehicleType = (typeof VEHICLE_TYPES)[number];
type Urgency = (typeof REQUEST_URGENCIES)[number];

function NewRequestForm() {
  const { api } = useSession();
  const router = useRouter();
  const providerSlug = useSearchParams().get("provider");
  const [provider, setProvider] = useState<PublicProviderProfile | null>(null);
  const [category, setCategory] = useState<ProviderCategory>("workshop");
  const [vehicleType, setVehicleType] = useState<VehicleType>("car");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [registration, setRegistration] = useState("");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("routine");
  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [radiusKm, setRadiusKm] = useState(25);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Retrying after a network error reuses the ID, so the request (and quota) is used once.
  const [clientRequestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!providerSlug) return;
    let active = true;
    api.provider(providerSlug).then(
      (profile) => {
        if (!active) return;
        setProvider(profile);
        const [first] = profile.categories;
        if (first) setCategory(first);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api, providerSlug]);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (description.trim().length < 10) {
      found["description"] = "Describe the problem in at least 10 characters.";
    }
    if (!location) found["location"] = "Choose where the vehicle is.";
    if (registration.trim() !== "" && !/^[A-Za-z0-9 -]{2,15}$/.test(registration.trim())) {
      found["registration"] = "Use letters, digits, spaces and hyphens only.";
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || !location) return;
    setBusy(true);
    setFailure(null);
    try {
      const created = await api.createServiceRequest({
        clientRequestId,
        category,
        vehicle: {
          vehicleType,
          make: make.trim() || null,
          model: model.trim() || null,
          registration: registration.trim() || null,
        },
        location: { lat: location.lat, lng: location.lng },
        description: description.trim(),
        urgency,
        target: provider
          ? { mode: "direct", providerIds: [provider.organizationId] }
          : { mode: "match", radiusKm },
      });
      router.push(`/app/requests/${created.id}`);
    } catch (error) {
      setFailure(errorMessage(error));
      setBusy(false);
    }
  }

  return (
    <form className="stack stack--lg" onSubmit={(event) => void submit(event)} noValidate>
      {provider ? (
        <Notice>
          <p>
            This request goes to <strong>{provider.tradingName}</strong> only.
          </p>
        </Notice>
      ) : null}
      <Card title="What do you need?">
        <div className="stack">
          <SelectField
            label="Type of service"
            required
            value={category}
            onChange={(event) => {
              setCategory(PROVIDER_CATEGORIES.find((c) => c === event.target.value) ?? "workshop");
            }}
            options={(provider?.categories ?? PROVIDER_CATEGORIES).map((value) => ({
              value,
              label: CATEGORY_LABELS[value],
            }))}
          />
          <TextArea
            label="Describe the problem"
            hint="What happened, any warning lights or noises, and what you'd like done."
            required
            maxLength={2000}
            value={description}
            error={errors["description"]}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
          <SelectField
            label="How soon?"
            required
            value={urgency}
            onChange={(event) => {
              setUrgency(REQUEST_URGENCIES.find((u) => u === event.target.value) ?? "routine");
            }}
            options={REQUEST_URGENCIES.map((value) => ({ value, label: titleCase(value) }))}
          />
        </div>
      </Card>
      <Card title="Vehicle">
        <div className="grid">
          <SelectField
            label="Vehicle type"
            required
            value={vehicleType}
            onChange={(event) => {
              setVehicleType(VEHICLE_TYPES.find((v) => v === event.target.value) ?? "car");
            }}
            options={VEHICLE_TYPES.map((value) => ({ value, label: VEHICLE_TYPE_LABELS[value] }))}
          />
          <TextField
            label="Make"
            maxLength={60}
            value={make}
            onChange={(event) => {
              setMake(event.target.value);
            }}
          />
          <TextField
            label="Model"
            maxLength={60}
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
            }}
          />
          <TextField
            label="Registration"
            hint="Shared with providers who receive the request"
            maxLength={15}
            value={registration}
            error={errors["registration"]}
            onChange={(event) => {
              setRegistration(event.target.value);
            }}
          />
        </div>
      </Card>
      <Card title="Where">
        <div className="stack">
          <LocationPicker
            value={location}
            onChange={setLocation}
            label="Where is the vehicle?"
            hint="Providers see an area of about 1 km until you accept their quote."
          />
          {errors["location"] ? <p className="field__error">{errors["location"]}</p> : null}
          {!provider ? (
            <SelectField
              label="Send to providers within"
              required
              value={String(radiusKm)}
              onChange={(event) => {
                setRadiusKm(Number(event.target.value));
              }}
              options={[10, 25, 50, 100].map((km) => ({
                value: String(km),
                label: `${String(km)} km`,
              }))}
            />
          ) : null}
        </div>
      </Card>
      {failure ? (
        <Notice tone="danger" live="assertive">
          <p>{failure}</p>
        </Notice>
      ) : null}
      <div>
        <Button type="submit" busy={busy}>
          {busy ? "Sending…" : "Send request"}
        </Button>
      </div>
    </form>
  );
}

export default function NewRequestPage() {
  return (
    <>
      <PageHeader
        title="Request a quote"
        description="Free to ask. Quotes are indicative: you choose one, agree the final price and pay the provider directly."
      />
      <Suspense fallback={<Loading />}>
        <NewRequestForm />
      </Suspense>
    </>
  );
}
