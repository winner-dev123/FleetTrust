"use client";

import { copy, fill } from "@fleettrust/copy";
import { type BranchDto, WEEKDAYS } from "@fleettrust/types";
import { type SubmitEvent, use, useState } from "react";

import { Button } from "@/components/button";
import { Checkbox, TextField } from "@/components/field";
import { ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { LocationPicker, type PickedLocation } from "@/components/location-picker";
import { errorMessage } from "@fleettrust/sdk";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.org.branches;
const DAY_NAMES = copy.web.provider.days;

type Weekday = (typeof WEEKDAYS)[number];
interface DayHours {
  open: boolean;
  opens: string;
  closes: string;
}

function BranchLocation({ orgId, branch }: { orgId: string; branch: BranchDto }) {
  const { api } = useSession();
  const [address, setAddress] = useState(branch.addressLine1 ?? "");
  const [locality, setLocality] = useState(branch.locality ?? "");
  const [countryCode, setCountryCode] = useState(branch.countryCode ?? "");
  const [radius, setRadius] = useState(
    branch.serviceRadiusKm ? String(branch.serviceRadiusKm) : "",
  );
  const [location, setLocation] = useState<PickedLocation | null>(
    branch.location ? { ...branch.location, label: t.savedLocation, accuracyM: null } : null,
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = countryCode.trim().toUpperCase();
    if (code !== "" && !/^[A-Z]{2}$/.test(code)) {
      setMessage({ ok: false, text: t.countryInvalid });
      return;
    }
    try {
      await api.updateBranchLocation(orgId, branch.id, {
        addressLine1: address.trim() || null,
        locality: locality.trim() || null,
        countryCode: code || null,
        location: location ? { lat: location.lat, lng: location.lng } : null,
        serviceRadiusKm: radius.trim() === "" ? null : Math.round(Number(radius)),
      });
      setMessage({ ok: true, text: t.locationSaved });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
      <h3>{t.location}</h3>
      <div className="grid">
        <TextField
          label={t.street}
          hint={t.streetHint}
          maxLength={200}
          autoComplete="street-address"
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
          }}
        />
        <TextField
          label={t.town}
          required
          maxLength={100}
          value={locality}
          onChange={(event) => {
            setLocality(event.target.value);
          }}
        />
        <TextField
          label={t.country}
          hint={t.countryHint}
          required
          maxLength={2}
          value={countryCode}
          onChange={(event) => {
            setCountryCode(event.target.value);
          }}
        />
        <TextField
          label={t.radius}
          hint={t.radiusHint}
          inputMode="numeric"
          value={radius}
          onChange={(event) => {
            setRadius(event.target.value);
          }}
        />
      </div>
      <LocationPicker
        value={location}
        onChange={setLocation}
        label={t.mapPosition}
        hint={t.mapPositionHint}
      />
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      <div>
        <Button type="submit">{t.saveLocation}</Button>
      </div>
    </form>
  );
}

function BranchHours({ orgId, branchId }: { orgId: string; branchId: string }) {
  const { api } = useSession();
  const hours = useLoad(() => api.branchHours(orgId, branchId), `hours-${branchId}`);
  const [days, setDays] = useState<Record<Weekday, DayHours> | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (hours.status === "loading") return <Loading label={t.loadingHours} />;
  if (hours.status === "error") return <ErrorNotice error={hours.error} />;
  const weekly = hours.data.weekly ?? {};
  const current =
    days ??
    (Object.fromEntries(
      WEEKDAYS.map((day) => {
        const first = weekly[day]?.[0];
        return [
          day,
          first
            ? { open: true, opens: first.opens, closes: first.closes }
            : { open: false, opens: "08:00", closes: "17:00" },
        ];
      }),
    ) as Record<Weekday, DayHours>);

  const update = (day: Weekday, change: Partial<DayHours>) => {
    setDays({ ...current, [day]: { ...current[day], ...change } });
  };

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api.saveBranchHours(orgId, branchId, {
        // Keep an inherited organization time zone inherited.
        timeZone:
          hours.status === "ready" && hours.data.timeZoneSource === "branch"
            ? hours.data.timeZone
            : null,
        weekly: Object.fromEntries(
          WEEKDAYS.map((day) => [
            day,
            current[day].open ? [{ opens: current[day].opens, closes: current[day].closes }] : [],
          ]),
        ),
      });
      setMessage({ ok: true, text: t.hoursSaved });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <h3>{t.hours}</h3>
      <p className="small muted">{fill(t.localTimes, { timeZone: hours.data.timeZone })}</p>
      {WEEKDAYS.map((day) => (
        <fieldset key={day} className="cluster" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="visually-hidden">{DAY_NAMES[day]}</legend>
          <div style={{ minWidth: 150 }}>
            <Checkbox
              label={fill(t.openOn, { day: DAY_NAMES[day] })}
              checked={current[day].open}
              onChange={(event) => {
                update(day, { open: event.target.checked });
              }}
            />
          </div>
          {current[day].open ? (
            <>
              <TextField
                label={fill(t.opens, { day: DAY_NAMES[day] })}
                type="time"
                required
                value={current[day].opens}
                onChange={(event) => {
                  update(day, { opens: event.target.value });
                }}
              />
              <TextField
                label={fill(t.closes, { day: DAY_NAMES[day] })}
                type="time"
                required
                value={current[day].closes}
                onChange={(event) => {
                  update(day, { closes: event.target.value });
                }}
              />
            </>
          ) : null}
        </fieldset>
      ))}
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      <div>
        <Button type="submit">{t.saveHours}</Button>
      </div>
    </form>
  );
}

/** Branch locations and weekly opening hours (one interval per day; exceptions via the API). */
export default function BranchesPage(props: PageProps<"/app/o/[orgId]/branches">) {
  const { orgId } = use(props.params);
  const { api } = useSession();
  const branches = useLoad(() => api.listBranches(orgId), `branches-${orgId}`);
  return (
    <>
      <PageHeader title={t.title} />
      {branches.status === "loading" ? <Loading /> : null}
      {branches.status === "error" ? (
        <ErrorNotice error={branches.error} onRetry={branches.reload} />
      ) : null}
      {branches.status === "ready"
        ? branches.data.map((branch) => (
            <Card key={branch.id} title={branch.name}>
              <div className="stack stack--lg">
                <BranchLocation orgId={orgId} branch={branch} />
                <BranchHours orgId={orgId} branchId={branch.id} />
              </div>
            </Card>
          ))
        : null}
    </>
  );
}
