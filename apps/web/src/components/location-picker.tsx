"use client";

import { copy, fill } from "@fleettrust/copy";
import { useState } from "react";

import { errorMessage } from "@fleettrust/sdk";
import { useSession } from "@/lib/session";

import { Button } from "./button";
import { TextField } from "./field";

export interface PickedLocation {
  lat: number;
  lng: number;
  label: string;
  accuracyM: number | null;
}

/**
 * Choose a location: share the device location (asked each time, never stored by the browser
 * app) or type a place name. Calls `onChange` with the result.
 */
export function LocationPicker({
  value,
  onChange,
  label = copy.web.location.label,
  hint,
}: {
  value: PickedLocation | null;
  onChange: (location: PickedLocation | null) => void;
  label?: string;
  hint?: string;
}) {
  const { api } = useSession();
  const [place, setPlace] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"gps" | "place" | null>(null);

  function useDevice() {
    if (!("geolocation" in navigator)) {
      setError(copy.web.location.browserCannot);
      return;
    }
    setBusy("gps");
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setBusy(null);
        onChange({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: copy.web.location.current,
          accuracyM: Math.round(position.coords.accuracy),
        });
      },
      () => {
        setBusy(null);
        setError(copy.web.location.notShared);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  async function findPlace() {
    if (place.trim().length < 2) {
      setError(copy.web.location.placeTooShort);
      return;
    }
    setBusy("place");
    setError(null);
    try {
      const [first] = await api.geocode(place.trim());
      if (first) {
        onChange({
          lat: first.location.lat,
          lng: first.location.lng,
          label: first.label,
          accuracyM: null,
        });
      } else {
        setError(fill(copy.web.location.placeNotFound, { place: place.trim() }));
      }
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  return (
    <fieldset className="field">
      <legend className="field__label">{label}</legend>
      {hint ? <p className="field__hint">{hint}</p> : null}
      {value ? (
        <p role="status" className="cluster">
          <span>
            {copy.web.location.using} <strong>{value.label}</strong>
          </span>
          <Button
            variant="ghost"
            onClick={() => {
              onChange(null);
            }}
          >
            {copy.web.location.change}
          </Button>
        </p>
      ) : (
        <div className="stack">
          <div>
            <Button variant="secondary" onClick={useDevice} busy={busy === "gps"}>
              {busy === "gps" ? copy.web.location.finding : copy.web.location.useCurrent}
            </Button>
          </div>
          <div className="cluster" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 220px" }}>
              <TextField
                label={copy.web.location.typePlace}
                value={place}
                maxLength={100}
                error={error}
                onChange={(event) => {
                  setPlace(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void findPlace();
                  }
                }}
              />
            </div>
            <Button variant="ghost" onClick={() => void findPlace()} busy={busy === "place"}>
              {copy.web.location.findPlace}
            </Button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
