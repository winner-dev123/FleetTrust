"use client";

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

const DAY_NAMES = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
} as const;

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
    branch.location ? { ...branch.location, label: "Saved location", accuracyM: null } : null,
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = countryCode.trim().toUpperCase();
    if (code !== "" && !/^[A-Z]{2}$/.test(code)) {
      setMessage({ ok: false, text: "Country: two letters, e.g. ZA." });
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
      setMessage({ ok: true, text: "Location saved." });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
      <h3>Location</h3>
      <div className="grid">
        <TextField
          label="Street address"
          hint="Shown to signed-in people only"
          maxLength={200}
          autoComplete="street-address"
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
          }}
        />
        <TextField
          label="Town or suburb"
          required
          maxLength={100}
          value={locality}
          onChange={(event) => {
            setLocality(event.target.value);
          }}
        />
        <TextField
          label="Country code"
          hint="Two letters, e.g. ZA"
          required
          maxLength={2}
          value={countryCode}
          onChange={(event) => {
            setCountryCode(event.target.value);
          }}
        />
        <TextField
          label="How far do you travel (km)?"
          hint="Leave empty if customers come to you"
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
        label="Map position"
        hint="Visitors see an area of about 1 km; signed-in people see the exact point."
      />
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      <div>
        <Button type="submit">Save location</Button>
      </div>
    </form>
  );
}

function BranchHours({ orgId, branchId }: { orgId: string; branchId: string }) {
  const { api } = useSession();
  const hours = useLoad(() => api.branchHours(orgId, branchId), `hours-${branchId}`);
  const [days, setDays] = useState<Record<Weekday, DayHours> | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (hours.status === "loading") return <Loading label="Loading hours…" />;
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
      setMessage({ ok: true, text: "Opening hours saved." });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <h3>Opening hours</h3>
      <p className="small muted">Times are local ({hours.data.timeZone}).</p>
      {WEEKDAYS.map((day) => (
        <fieldset key={day} className="cluster" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="visually-hidden">{DAY_NAMES[day]}</legend>
          <div style={{ minWidth: 150 }}>
            <Checkbox
              label={`Open on ${DAY_NAMES[day]}`}
              checked={current[day].open}
              onChange={(event) => {
                update(day, { open: event.target.checked });
              }}
            />
          </div>
          {current[day].open ? (
            <>
              <TextField
                label={`${DAY_NAMES[day]} opens`}
                type="time"
                required
                value={current[day].opens}
                onChange={(event) => {
                  update(day, { opens: event.target.value });
                }}
              />
              <TextField
                label={`${DAY_NAMES[day]} closes`}
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
        <Button type="submit">Save hours</Button>
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
      <PageHeader title="Branches and hours" />
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
