"use client";

import { FLEET_INCIDENT_KINDS, FLEET_INCIDENT_SEVERITIES } from "@fleettrust/types";
import { type SubmitEvent, use, useState } from "react";

import { Button } from "@/components/button";
import { SelectField, TextArea, TextField } from "@/components/field";
import { Badge, EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { vehicleName } from "@/components/vehicle-list";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, titleCase } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

type Kind = (typeof FLEET_INCIDENT_KINDS)[number];
type Severity = (typeof FLEET_INCIDENT_SEVERITIES)[number];

/** Fleet incident log (breakdowns, accidents, damage). Not the personal emergency alert. */
export default function FleetIncidentsPage(props: PageProps<"/app/o/[orgId]/incidents">) {
  const { orgId } = use(props.params);
  const { api } = useSession();
  const data = useLoad(async () => {
    const [incidents, vehicles] = await Promise.all([
      api.fleetIncidents(orgId),
      api.fleetVehicles(orgId).catch(() => []),
    ]);
    return { incidents, vehicles };
  }, `fleet-incidents-${orgId}`);
  const [vehicleId, setVehicleId] = useState("");
  const [kind, setKind] = useState<Kind>("breakdown");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [where, setWhere] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function report(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vehicleId) {
      setMessage({ ok: false, text: "Choose the vehicle." });
      return;
    }
    if (description.trim().length < 5) {
      setMessage({ ok: false, text: "Describe what happened (at least 5 characters)." });
      return;
    }
    try {
      await api.reportFleetIncident(orgId, {
        vehicleId,
        kind,
        severity,
        occurredAt: new Date().toISOString(),
        location: where.trim() || null,
        description: description.trim(),
      });
      setDescription("");
      setWhere("");
      setMessage({ ok: true, text: "Incident recorded." });
      data.reload();
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  return (
    <>
      <PageHeader
        title="Fleet incidents"
        description="For someone in danger right now, use Emergency instead."
      />
      {data.status === "loading" ? <Loading /> : null}
      {data.status === "error" ? <ErrorNotice error={data.error} onRetry={data.reload} /> : null}
      {data.status === "ready" ? (
        <>
          {data.data.incidents.length === 0 ? (
            <EmptyState title="No incidents recorded" />
          ) : (
            <ul className="list-plain">
              {data.data.incidents.map((incident) => (
                <li key={incident.id} className="card">
                  <p style={{ margin: 0 }}>
                    <strong>
                      {titleCase(incident.kind)} · {incident.vehicle.name}
                    </strong>{" "}
                    <Badge tone={incident.status === "open" ? "caution" : "neutral"}>
                      {titleCase(incident.status)}
                    </Badge>{" "}
                    <Badge tone={incident.severity === "high" ? "danger" : "neutral"}>
                      {titleCase(incident.severity)} severity
                    </Badge>
                  </p>
                  <p style={{ margin: 0 }}>{incident.description}</p>
                  <p className="small muted" style={{ margin: 0 }}>
                    {formatDateTime(incident.occurredAt)}
                    {incident.location ? ` · ${incident.location}` : ""} · reported by{" "}
                    {incident.reportedBy.name}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Card title="Record an incident">
            <form className="stack" onSubmit={(event) => void report(event)} noValidate>
              <div className="grid">
                <SelectField
                  label="Vehicle"
                  required
                  value={vehicleId}
                  onChange={(event) => {
                    setVehicleId(event.target.value);
                  }}
                  options={[
                    { value: "", label: "Choose a vehicle" },
                    ...data.data.vehicles.map((vehicle) => ({
                      value: vehicle.id,
                      label: vehicleName(vehicle),
                    })),
                  ]}
                />
                <SelectField
                  label="What happened"
                  required
                  value={kind}
                  onChange={(event) => {
                    setKind(
                      FLEET_INCIDENT_KINDS.find((k) => k === event.target.value) ?? "breakdown",
                    );
                  }}
                  options={FLEET_INCIDENT_KINDS.map((value) => ({
                    value,
                    label: titleCase(value),
                  }))}
                />
                <SelectField
                  label="Severity"
                  required
                  value={severity}
                  onChange={(event) => {
                    setSeverity(
                      FLEET_INCIDENT_SEVERITIES.find((s) => s === event.target.value) ?? "medium",
                    );
                  }}
                  options={FLEET_INCIDENT_SEVERITIES.map((value) => ({
                    value,
                    label: titleCase(value),
                  }))}
                />
                <TextField
                  label="Where"
                  maxLength={200}
                  value={where}
                  onChange={(event) => {
                    setWhere(event.target.value);
                  }}
                />
              </div>
              <TextArea
                label="Description"
                required
                maxLength={2000}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
              />
              {message ? (
                <Notice tone={message.ok ? "success" : "danger"} live="polite">
                  <p>{message.text}</p>
                </Notice>
              ) : null}
              <div>
                <Button type="submit">Record incident</Button>
              </div>
            </form>
          </Card>
        </>
      ) : null}
    </>
  );
}
