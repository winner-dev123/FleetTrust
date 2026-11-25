import { copy } from "@fleettrust/copy";
import {
  type IndicativePrice,
  indicativePriceSchema,
  PRICE_UNITS,
  type PriceUnit,
} from "@fleettrust/types";

/** What the price form holds (all strings, as typed). */
export interface PriceDraft {
  type: IndicativePrice["type"];
  currency: string;
  amount: string;
  min: string;
  max: string;
  unit: PriceUnit;
}

export const EMPTY_PRICE: PriceDraft = {
  type: "fixed",
  currency: "ZAR",
  amount: "",
  min: "",
  max: "",
  unit: "job",
};

export const PRICE_TYPE_LABELS: Record<IndicativePrice["type"], string> = {
  fixed: copy.web.price.typeFixed,
  from: copy.web.price.typeFrom,
  range: copy.web.price.typeRange,
  quote_required: copy.web.price.typeQuote,
};

export const isPriceUnit = (value: string): value is PriceUnit =>
  (PRICE_UNITS as readonly string[]).includes(value);

/** The draft as an indicative price, or the first problem in plain words. */
export function priceFromDraft(
  draft: PriceDraft,
): { ok: true; price: IndicativePrice } | { ok: false; error: string } {
  const currency = draft.currency.trim().toUpperCase();
  const candidate =
    draft.type === "quote_required"
      ? { type: "quote_required" as const }
      : draft.type === "range"
        ? {
            type: "range" as const,
            currency,
            min: draft.min.trim(),
            max: draft.max.trim(),
            unit: draft.unit,
          }
        : { type: draft.type, currency, amount: draft.amount.trim(), unit: draft.unit };
  const parsed = indicativePriceSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, price: parsed.data };
  const issue = parsed.error.issues[0];
  const field = issue?.path[0];
  const where =
    field === "currency"
      ? copy.web.price.errorCurrency
      : field === "max"
        ? copy.web.price.errorMax
        : copy.web.price.errorAmount;
  return { ok: false, error: where };
}
