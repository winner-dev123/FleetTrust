"use client";

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
  label = "Location",
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
      setError("This browser can't share a location. Type a place instead.");
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
          label: "Your current location",
          accuracyM: Math.round(position.coords.accuracy),
        });
      },
      () => {
        setBusy(null);
        setError("Location wasn't shared. Type a place instead.");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  async function findPlace() {
    if (place.trim().length < 2) {
      setError("Type a town, suburb or landmark.");
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
        setError(`We couldn't find "${place.trim()}".`);
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
            Using: <strong>{value.label}</strong>
          </span>
          <Button
            variant="ghost"
            onClick={() => {
              onChange(null);
            }}
          >
            Change
          </Button>
        </p>
      ) : (
        <div className="stack">
          <div>
            <Button variant="secondary" onClick={useDevice} busy={busy === "gps"}>
              {busy === "gps" ? "Finding you…" : "Use my current location"}
            </Button>
          </div>
          <div className="cluster" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 220px" }}>
              <TextField
                label="Or type a place"
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
              Find place
            </Button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
