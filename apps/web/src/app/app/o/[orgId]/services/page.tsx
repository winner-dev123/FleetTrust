"use client";

import { copy, fill } from "@fleettrust/copy";
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
import { errorMessage } from "@fleettrust/sdk";
import { EMPTY_PRICE, priceFromDraft } from "@/lib/price";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.org.services;

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
      setError(t.nameTooShort);
      return;
    }
    if (vehicleTypes.length === 0) {
      setError(t.vehicleTypeMissing);
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
          label={t.category}
          required
          value={category}
          onChange={(event) => {
            setCategory(PROVIDER_CATEGORIES.find((c) => c === event.target.value) ?? "workshop");
          }}
          options={PROVIDER_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] }))}
        />
        <TextField
          label={t.serviceName}
          required
          maxLength={120}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>
      <TextArea
        label={t.descriptionLabel}
        maxLength={1000}
        value={description}
        onChange={(event) => {
          setDescription(event.target.value);
        }}
      />
      <fieldset className="field">
        <legend className="field__label">{t.vehicleTypes}</legend>
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
        label={t.atCustomer}
        hint={t.atCustomerHint}
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
          {t.add}
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
      <PageHeader title={t.title} />
      <Notice>
        <p className="small">{fill(t.customersSee, { disclaimer: INDICATIVE_PRICE_DISCLAIMER })}</p>
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
          <EmptyState title={t.emptyTitle}>
            <p>{t.emptyBody}</p>
          </EmptyState>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t.yourServices}>
            <table className="table">
              <caption className="visually-hidden">{t.yourServices}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.service}</th>
                  <th scope="col">{t.price}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t.actions}</span>
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
                        {fill(t.remove, { name: offering.name })}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
      <Card title={t.addTitle}>
        <AddOffering orgId={orgId} onAdded={offerings.reload} />
      </Card>
    </>
  );
}
