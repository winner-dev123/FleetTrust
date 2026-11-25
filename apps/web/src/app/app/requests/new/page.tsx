"use client";

import { copy, fill } from "@fleettrust/copy";
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

const t = copy.web.app.newRequest;

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
      found["description"] = t.describeTooShort;
    }
    if (!location) found["location"] = t.locationMissing;
    if (registration.trim() !== "" && !/^[A-Za-z0-9 -]{2,15}$/.test(registration.trim())) {
      found["registration"] = t.registrationInvalid;
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
            {t.directBefore} <strong>{provider.tradingName}</strong> {t.directAfter}
          </p>
        </Notice>
      ) : null}
      <Card title={t.what}>
        <div className="stack">
          <SelectField
            label={t.serviceType}
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
            label={t.describe}
            hint={t.describeHint}
            required
            maxLength={2000}
            value={description}
            error={errors["description"]}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
          <SelectField
            label={t.howSoon}
            required
            value={urgency}
            onChange={(event) => {
              setUrgency(REQUEST_URGENCIES.find((u) => u === event.target.value) ?? "routine");
            }}
            options={REQUEST_URGENCIES.map((value) => ({ value, label: titleCase(value) }))}
          />
        </div>
      </Card>
      <Card title={t.vehicle}>
        <div className="grid">
          <SelectField
            label={t.vehicleType}
            required
            value={vehicleType}
            onChange={(event) => {
              setVehicleType(VEHICLE_TYPES.find((v) => v === event.target.value) ?? "car");
            }}
            options={VEHICLE_TYPES.map((value) => ({ value, label: VEHICLE_TYPE_LABELS[value] }))}
          />
          <TextField
            label={t.make}
            maxLength={60}
            value={make}
            onChange={(event) => {
              setMake(event.target.value);
            }}
          />
          <TextField
            label={t.model}
            maxLength={60}
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
            }}
          />
          <TextField
            label={t.registration}
            hint={t.registrationHint}
            maxLength={15}
            value={registration}
            error={errors["registration"]}
            onChange={(event) => {
              setRegistration(event.target.value);
            }}
          />
        </div>
      </Card>
      <Card title={t.where}>
        <div className="stack">
          <LocationPicker
            value={location}
            onChange={setLocation}
            label={t.whereLabel}
            hint={t.whereHint}
          />
          {errors["location"] ? <p className="field__error">{errors["location"]}</p> : null}
          {!provider ? (
            <SelectField
              label={t.radius}
              required
              value={String(radiusKm)}
              onChange={(event) => {
                setRadiusKm(Number(event.target.value));
              }}
              options={[10, 25, 50, 100].map((km) => ({
                value: String(km),
                label: fill(t.km, { km }),
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
          {busy ? t.sending : t.send}
        </Button>
      </div>
    </form>
  );
}

export default function NewRequestPage() {
  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      <Suspense fallback={<Loading />}>
        <NewRequestForm />
      </Suspense>
    </>
  );
}
