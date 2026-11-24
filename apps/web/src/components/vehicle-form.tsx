"use client";

import { type CreateVehicle, VEHICLE_TYPE_LABELS, VEHICLE_TYPES } from "@fleettrust/types";
import { type SubmitEvent, useState } from "react";

import { errorMessage } from "@/lib/errors";

import { Button } from "./button";
import { SelectField, TextField } from "./field";
import { Notice } from "./feedback";

type VehicleType = (typeof VEHICLE_TYPES)[number];

/** Add a vehicle (personal or fleet): only the type is required. */
export function VehicleForm({ onSubmit }: { onSubmit: (vehicle: CreateVehicle) => Promise<void> }) {
  const [vehicleType, setVehicleType] = useState<VehicleType>("car");
  const [nickname, setNickname] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [registration, setRegistration] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const yearNumber = year.trim() === "" ? null : Number(year);
    if (
      yearNumber !== null &&
      (!Number.isInteger(yearNumber) || yearNumber < 1900 || yearNumber > 2100)
    ) {
      setError("Enter a year between 1900 and 2100.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        vehicleType,
        nickname: nickname.trim() || null,
        make: make.trim() || null,
        model: model.trim() || null,
        year: yearNumber,
        registration: registration.trim() || null,
      });
      setNickname("");
      setMake("");
      setModel("");
      setYear("");
      setRegistration("");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
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
          label="Nickname"
          maxLength={60}
          value={nickname}
          onChange={(event) => {
            setNickname(event.target.value);
          }}
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
          label="Year"
          inputMode="numeric"
          maxLength={4}
          value={year}
          onChange={(event) => {
            setYear(event.target.value);
          }}
        />
        <TextField
          label="Registration"
          maxLength={15}
          value={registration}
          onChange={(event) => {
            setRegistration(event.target.value);
          }}
        />
      </div>
      {error ? (
        <Notice tone="danger" live="assertive">
          <p>{error}</p>
        </Notice>
      ) : null}
      <div>
        <Button type="submit" busy={busy}>
          Add vehicle
        </Button>
      </div>
    </form>
  );
}
