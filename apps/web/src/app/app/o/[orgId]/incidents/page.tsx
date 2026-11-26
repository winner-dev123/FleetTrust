"use client";

import { copy, fill } from "@fleettrust/copy";
import { FLEET_INCIDENT_KINDS, FLEET_INCIDENT_SEVERITIES } from "@fleettrust/types";
import { type SubmitEvent, use, useState } from "react";

import { Button } from "@/components/button";
import { SelectField, TextArea, TextField } from "@/components/field";
import { Badge, EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { vehicleName } from "@/components/vehicle-list";
import { errorMessage } from "@fleettrust/sdk";
import { formatDateTime, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.org.incidents;

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
      setMessage({ ok: false, text: t.chooseVehicle });
      return;
    }
    if (description.trim().length < 5) {
      setMessage({ ok: false, text: t.describeTooShort });
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
      setMessage({ ok: true, text: t.recorded });
      data.reload();
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {data.status === "loading" ? <Loading /> : null}
      {data.status === "error" ? <ErrorNotice error={data.error} onRetry={data.reload} /> : null}
      {data.status === "ready" ? (
        <>
          {data.data.incidents.length === 0 ? (
            <EmptyState title={t.empty} />
          ) : (
            <ul className="list-plain">
              {data.data.incidents.map((incident) => (
                <li key={incident.id} className="card">
                  <p style={{ margin: 0 }}>
                    <strong>
                      {fill(t.heading, {
                        kind: titleCase(incident.kind),
                        vehicle: incident.vehicle.name,
                      })}
                    </strong>{" "}
                    <Badge tone={incident.status === "open" ? "caution" : "neutral"}>
                      {titleCase(incident.status)}
                    </Badge>{" "}
                    <Badge tone={incident.severity === "high" ? "danger" : "neutral"}>
                      {fill(t.severity, { severity: titleCase(incident.severity) })}
                    </Badge>
                  </p>
                  <p style={{ margin: 0 }}>{incident.description}</p>
                  <p className="small muted" style={{ margin: 0 }}>
                    {[
                      formatDateTime(incident.occurredAt),
                      incident.location,
                      fill(t.reportedBy, { name: incident.reportedBy.name }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Card title={t.record}>
            <form className="stack" onSubmit={(event) => void report(event)} noValidate>
              <div className="grid">
                <SelectField
                  label={t.vehicle}
                  required
                  value={vehicleId}
                  onChange={(event) => {
                    setVehicleId(event.target.value);
                  }}
                  options={[
                    { value: "", label: t.vehiclePlaceholder },
                    ...data.data.vehicles.map((vehicle) => ({
                      value: vehicle.id,
                      label: vehicleName(vehicle),
                    })),
                  ]}
                />
                <SelectField
                  label={t.whatHappened}
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
                  label={t.severityLabel}
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
                  label={t.where}
                  maxLength={200}
                  value={where}
                  onChange={(event) => {
                    setWhere(event.target.value);
                  }}
                />
              </div>
              <TextArea
                label={t.descriptionLabel}
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
                <Button type="submit">{t.submit}</Button>
              </div>
            </form>
          </Card>
        </>
      ) : null}
    </>
  );
}
