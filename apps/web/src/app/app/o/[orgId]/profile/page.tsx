"use client";

import { copy } from "@fleettrust/copy";
import {
  CATEGORY_LABELS,
  PROVIDER_CATEGORIES,
  type ProviderCategory,
  type ProviderProfileDto,
  VEHICLE_TYPE_LABELS,
  VEHICLE_TYPES,
} from "@fleettrust/types";
import { type SubmitEvent, use, useState } from "react";

import { Button } from "@/components/button";
import { Checkbox, TextArea, TextField } from "@/components/field";
import { ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { errorMessage } from "@fleettrust/sdk";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.org.profile;

type VehicleType = (typeof VEHICLE_TYPES)[number];

function toggle<T>(values: readonly T[], value: T, on: boolean): T[] {
  return on ? [...new Set([...values, value])] : values.filter((entry) => entry !== value);
}

function ProfileForm({ orgId, profile }: { orgId: string; profile: ProviderProfileDto }) {
  const { api } = useSession();
  const [tradingName, setTradingName] = useState(profile.tradingName ?? "");
  const [legalName, setLegalName] = useState(profile.legalName ?? "");
  const [slug, setSlug] = useState(profile.slug ?? "");
  const [description, setDescription] = useState(profile.description ?? "");
  const [categories, setCategories] = useState<ProviderCategory[]>(profile.categories);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>(profile.vehicleTypes);
  const [phone, setPhone] = useState(profile.contactPhone ?? "");
  const [email, setEmail] = useState(profile.contactEmail ?? "");
  const [website, setWebsite] = useState(profile.website ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      slug.trim() !== "" &&
      !/^[a-z0-9](?:[a-z0-9-]{1,58})[a-z0-9]$/.test(slug.trim().toLowerCase())
    ) {
      setMessage({ ok: false, text: t.slugInvalid });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.updateProviderProfile(orgId, {
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        tradingName: tradingName.trim() || null,
        legalName: legalName.trim() || null,
        description: description.trim() || null,
        categories,
        vehicleTypes,
        contactPhone: phone.trim() || null,
        contactEmail: email.trim() || null,
        website: website.trim() || null,
      });
      setMessage({
        ok: true,
        text: t.saved,
      });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack stack--lg" onSubmit={(event) => void submit(event)} noValidate>
      <Card title={t.basics}>
        <div className="stack">
          <TextField
            label={t.tradingName}
            hint={t.tradingNameHint}
            required
            maxLength={120}
            value={tradingName}
            onChange={(event) => {
              setTradingName(event.target.value);
            }}
          />
          <TextField
            label={t.legalName}
            required
            maxLength={200}
            value={legalName}
            onChange={(event) => {
              setLegalName(event.target.value);
            }}
          />
          <TextField
            label={t.slug}
            hint={t.slugHint}
            required
            maxLength={60}
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value);
            }}
          />
          <TextArea
            label={t.descriptionLabel}
            maxLength={2000}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        </div>
      </Card>
      <Card title={t.whatYouDo}>
        <fieldset className="field">
          <legend className="field__label">{t.categories}</legend>
          <div className="grid" style={{ gap: 0 }}>
            {PROVIDER_CATEGORIES.map((category) => (
              <Checkbox
                key={category}
                label={CATEGORY_LABELS[category]}
                checked={categories.includes(category)}
                onChange={(event) => {
                  setCategories(toggle(categories, category, event.target.checked));
                }}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="field" style={{ marginTop: 16 }}>
          <legend className="field__label">{t.vehicleTypes}</legend>
          <div className="grid" style={{ gap: 0 }}>
            {VEHICLE_TYPES.map((type) => (
              <Checkbox
                key={type}
                label={VEHICLE_TYPE_LABELS[type]}
                checked={vehicleTypes.includes(type)}
                onChange={(event) => {
                  setVehicleTypes(toggle(vehicleTypes, type, event.target.checked));
                }}
              />
            ))}
          </div>
        </fieldset>
      </Card>
      <Card title={t.contact}>
        <p className="small muted">{t.contactNote}</p>
        <div className="grid">
          <TextField
            label={t.phone}
            hint={t.phoneHint}
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
            }}
          />
          <TextField
            label={t.email}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
          <TextField
            label={t.website}
            hint={t.websiteHint}
            type="url"
            value={website}
            onChange={(event) => {
              setWebsite(event.target.value);
            }}
          />
        </div>
      </Card>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      <div>
        <Button type="submit" busy={busy}>
          {t.saveDraft}
        </Button>
      </div>
    </form>
  );
}

export default function ProviderProfilePage(props: PageProps<"/app/o/[orgId]/profile">) {
  const { orgId } = use(props.params);
  const { api } = useSession();
  const profile = useLoad(() => api.providerProfile(orgId), `profile-${orgId}`);
  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {profile.status === "loading" ? <Loading /> : null}
      {profile.status === "error" ? (
        <ErrorNotice error={profile.error} onRetry={profile.reload} />
      ) : null}
      {profile.status === "ready" ? <ProfileForm orgId={orgId} profile={profile.data} /> : null}
    </>
  );
}
