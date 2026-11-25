import { errorMessage, isOffline } from "@fleettrust/sdk";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { locationAdvice } from "../lib/permissions";
import type { LocationPermission } from "../platform/types";
import { useSession } from "../state/session";
import { useTheme } from "./theme";
import { Body, Button, TextField } from "./ui";

export interface PickedLocation {
  lat: number;
  lng: number;
  label: string;
  accuracyM: number | null;
}

/** iOS "approximate location" and weak GPS give positions this rough or worse. */
export const APPROXIMATE_M = 1_000;

/**
 * Choose a location: the phone's position (foreground permission, asked only when the
 * button is pressed) or a typed place name. Works fully without the location permission.
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
  const { platform, api } = useSession();
  const theme = useTheme();
  const [permission, setPermission] = useState<LocationPermission | null>(null);
  const [place, setPlace] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"gps" | "place" | null>(null);

  useEffect(() => {
    let active = true;
    void platform.location
      .permission()
      .catch(() => "undetermined" as const)
      .then((state) => {
        if (active) setPermission(state);
      });
    return () => {
      active = false;
    };
  }, [platform]);

  async function shareDeviceLocation() {
    setError(null);
    let state = permission ?? "undetermined";
    if (state === "blocked") {
      await platform.device.openSettings();
      return;
    }
    if (state !== "granted") {
      state = await platform.location.requestPermission();
      setPermission(state);
      if (state !== "granted") return;
    }
    setBusy("gps");
    try {
      const position = await platform.location.current();
      onChange({
        lat: position.lat,
        lng: position.lng,
        label: "Your current location",
        accuracyM: position.accuracyM === null ? null : Math.round(position.accuracyM),
      });
    } catch {
      setError("We couldn't get your position. Check that location is on, or type a place.");
    } finally {
      setBusy(null);
    }
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
      setError(
        isOffline(failure)
          ? "You're offline, so places can't be looked up. Try your location instead."
          : errorMessage(failure),
      );
    } finally {
      setBusy(null);
    }
  }

  if (value) {
    return (
      <View style={{ gap: theme.spacing.sm }} accessibilityLabel={label}>
        <Body>
          {label}: {value.label}
        </Body>
        {value.accuracyM !== null && value.accuracyM > APPROXIMATE_M ? (
          <Body small tone="caution">
            This position is approximate (within about {String(Math.round(value.accuracyM / 1000))}{" "}
            km). Allow precise location in Settings, or type a place for a closer match.
          </Body>
        ) : null}
        <Button
          label="Change location"
          variant="ghost"
          onPress={() => {
            onChange(null);
          }}
        />
      </View>
    );
  }

  const advice = locationAdvice(permission ?? "undetermined");
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Body>{label}</Body>
      {hint ? (
        <Body small muted>
          {hint}
        </Body>
      ) : null}
      {advice.message ? (
        <Body small muted>
          {advice.message}
        </Body>
      ) : null}
      {advice.actionLabel ? (
        <Button
          label={advice.actionLabel}
          variant="secondary"
          busy={busy === "gps"}
          onPress={() => void shareDeviceLocation()}
          hint={advice.action === "settings" ? "Opens the FleetTrust page in Settings" : undefined}
        />
      ) : null}
      <TextField
        label="Or type a place"
        value={place}
        onChangeText={setPlace}
        maxLength={100}
        returnKeyType="search"
        onSubmitEditing={() => void findPlace()}
        error={error}
      />
      <Button
        label="Find place"
        variant="secondary"
        busy={busy === "place"}
        onPress={() => void findPlace()}
      />
    </View>
  );
}
