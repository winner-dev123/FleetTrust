"use client";

import {
  CATEGORY_LABELS,
  formatIndicativePrice,
  INDICATIVE_PRICE_DISCLAIMER,
  PROVIDER_CATEGORIES,
  type ProviderCategory,
  VEHICLE_TYPE_LABELS,
  VEHICLE_TYPES,
} from "@fleettrust/types";
import { type SubmitEvent, use, useState } from "react";

import { Button } from "@/components/button";
import { Checkbox, SelectField, TextArea, TextField } from "@/components/field";
import { EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { PriceFields } from "@/components/price-fields";
import { errorMessage } from "@/lib/errors";
import { EMPTY_PRICE, priceFromDraft } from "@/lib/price";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

type VehicleType = (typeof VEHICLE_TYPES)[number];

function AddOffering({ orgId, onAdded }: { orgId: string; onAdded: () => void }) {
  const { api } = useSession();
  const [category, setCategory] = useState<ProviderCategory>("workshop");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>(["car"]);
  const [atCustomer, setAtCustomer] = useState(false);
  const [price, setPrice] = useState(EMPTY_PRICE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length < 2) {
      setError("Name: at least 2 characters.");
      return;
    }
    if (vehicleTypes.length === 0) {
      setError("Choose at least one vehicle type.");
      return;
    }
    const parsed = priceFromDraft(price);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createOffering(orgId, {
        category,
        name: name.trim(),
        description: description.trim() || null,
        vehicleTypes,
        serviceLocation: atCustomer ? "at_customer" : "at_premises",
        price: parsed.price,
      });
      setName("");
      setDescription("");
      setPrice(EMPTY_PRICE);
      onAdded();
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
          label="Category"
          required
          value={category}
          onChange={(event) => {
            setCategory(PROVIDER_CATEGORIES.find((c) => c === event.target.value) ?? "workshop");
          }}
          options={PROVIDER_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] }))}
        />
        <TextField
          label="Service name"
          required
          maxLength={120}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>
      <TextArea
        label="Description"
        maxLength={1000}
        value={description}
        onChange={(event) => {
          setDescription(event.target.value);
        }}
      />
      <fieldset className="field">
        <legend className="field__label">Vehicle types</legend>
        <div className="grid" style={{ gap: 0 }}>
          {VEHICLE_TYPES.map((type) => (
            <Checkbox
              key={type}
              label={VEHICLE_TYPE_LABELS[type]}
              checked={vehicleTypes.includes(type)}
              onChange={(event) => {
                setVehicleTypes(
                  event.target.checked
                    ? [...vehicleTypes, type]
                    : vehicleTypes.filter((entry) => entry !== type),
                );
              }}
            />
          ))}
        </div>
      </fieldset>
      <Checkbox
        label="Done at the customer's location"
        hint="Needs a travel distance on your branch"
        checked={atCustomer}
        onChange={(event) => {
          setAtCustomer(event.target.checked);
        }}
      />
      <PriceFields value={price} onChange={setPrice} />
      {error ? (
        <Notice tone="danger" live="assertive">
          <p>{error}</p>
        </Notice>
      ) : null}
      <div>
        <Button type="submit" busy={busy}>
          Add service
        </Button>
      </div>
    </form>
  );
}

/** Services and indicative prices. Customers never buy through FleetTrust (FR-07). */
export default function ServicesPage(props: PageProps<"/app/o/[orgId]/services">) {
  const { orgId } = use(props.params);
  const { api } = useSession();
  const offerings = useLoad(() => api.offerings(orgId), `offerings-${orgId}`);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Services and prices" />
      <Notice>
        <p className="small">Customers see: “{INDICATIVE_PRICE_DISCLAIMER}”</p>
      </Notice>
      {message ? (
        <Notice tone="danger" live="assertive">
          <p>{message}</p>
        </Notice>
      ) : null}
      {offerings.status === "loading" ? <Loading /> : null}
      {offerings.status === "error" ? (
        <ErrorNotice error={offerings.error} onRetry={offerings.reload} />
      ) : null}
      {offerings.status === "ready" ? (
        offerings.data.length === 0 ? (
          <EmptyState title="No services yet">
            <p>Add at least one service so customers know what you offer.</p>
          </EmptyState>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Your services">
            <table className="table">
              <caption className="visually-hidden">Your services</caption>
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Price</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {offerings.data.map((offering) => (
                  <tr key={offering.id}>
                    <td>
                      <strong>{offering.name}</strong>
                      <span className="small muted" style={{ display: "block" }}>
                        {CATEGORY_LABELS[offering.category]}
                      </span>
                    </td>
                    <td>{formatIndicativePrice(offering.price)}</td>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          void api
                            .deleteOffering(orgId, offering.id)
                            .then(offerings.reload, (e: unknown) => {
                              setMessage(errorMessage(e));
                            })
                        }
                      >
                        Remove {offering.name}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
      <Card title="Add a service">
        <AddOffering orgId={orgId} onAdded={offerings.reload} />
      </Card>
    </>
  );
}
