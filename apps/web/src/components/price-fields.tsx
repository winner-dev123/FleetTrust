"use client";

import { copy } from "@fleettrust/copy";
import { PRICE_UNITS } from "@fleettrust/types";

import { isPriceUnit, PRICE_TYPE_LABELS, type PriceDraft } from "@/lib/price";

import { SelectField, TextField } from "./field";

const UNIT_TEXT: Record<(typeof PRICE_UNITS)[number], string> = {
  job: "per job",
  hour: "per hour",
  day: "per day",
  night: "per night",
  km: "per km",
  litre: "per litre",
  kwh: "per kWh",
  item: "each",
  tyre: "per tyre",
  vehicle: "per vehicle",
};

/** Indicative price inputs. Prices only inform: the provider confirms the final price. */
export function PriceFields({
  value,
  onChange,
}: {
  value: PriceDraft;
  onChange: (draft: PriceDraft) => void;
}) {
  const set = (change: Partial<PriceDraft>) => {
    onChange({ ...value, ...change });
  };
  return (
    <fieldset className="field">
      <legend className="field__label">{copy.web.price.legend}</legend>
      <div className="grid">
        <SelectField
          label={copy.web.price.type}
          required
          value={value.type}
          onChange={(event) => {
            const type = (Object.keys(PRICE_TYPE_LABELS) as PriceDraft["type"][]).find(
              (key) => key === event.target.value,
            );
            if (type) set({ type });
          }}
          options={Object.entries(PRICE_TYPE_LABELS).map(([key, label]) => ({ value: key, label }))}
        />
        {value.type !== "quote_required" ? (
          <>
            <TextField
              label={copy.web.price.currency}
              hint={copy.web.price.currencyHint}
              required
              maxLength={3}
              value={value.currency}
              onChange={(event) => {
                set({ currency: event.target.value });
              }}
            />
            {value.type === "range" ? (
              <>
                <TextField
                  label={copy.web.price.minimum}
                  required
                  inputMode="decimal"
                  value={value.min}
                  onChange={(event) => {
                    set({ min: event.target.value });
                  }}
                />
                <TextField
                  label={copy.web.price.maximum}
                  required
                  inputMode="decimal"
                  value={value.max}
                  onChange={(event) => {
                    set({ max: event.target.value });
                  }}
                />
              </>
            ) : (
              <TextField
                label={copy.web.price.amount}
                required
                inputMode="decimal"
                value={value.amount}
                onChange={(event) => {
                  set({ amount: event.target.value });
                }}
              />
            )}
            <SelectField
              label={copy.web.price.unit}
              required
              value={value.unit}
              onChange={(event) => {
                if (isPriceUnit(event.target.value)) set({ unit: event.target.value });
              }}
              options={PRICE_UNITS.map((unit) => ({ value: unit, label: UNIT_TEXT[unit] }))}
            />
          </>
        ) : null}
      </div>
    </fieldset>
  );
}
