// Pulls surcharges (delivery, service, handling…) out of Textract's
// AnalyzeExpense summary fields. Kept free of AWS imports so it can be unit
// tested; textractService feeds it the raw SummaryFields array.

export interface SummaryFieldLike {
  Type?: { Text?: string };
  LabelDetection?: { Text?: string };
  ValueDetection?: { Text?: string };
}

/** Textract's own types for add-on charges. */
const FEE_TYPES = new Set(["SERVICE_CHARGE", "SHIPPING_HANDLING_CHARGE"]);

/** Free-text labels Textract files under OTHER that are really fees —
 *  "Delivery Fee", "Service Fee", "Small Order Fee", "Surcharge", … */
const FEE_LABEL = /\b(fee|fees|surcharge|delivery|service charge|handling)\b/i;
/** …but never a tip, tax, or discount even if the label mentions delivery. */
const NOT_FEE_LABEL = /\b(tip|gratuity|tax|discount|promo|credit|refund)\b/i;

export const parseMoney = (value?: string): number | undefined => {
  if (!value) return undefined;
  const normalized = value.replace(/[^0-9.-]/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Sum of every fee-like summary field, or undefined when there are none.
 *  Negative values (promos filed as fees) are ignored. */
export const sumReceiptFees = (
  fields: SummaryFieldLike[]
): number | undefined => {
  let cents = 0;
  let found = false;
  for (const field of fields) {
    const type = field.Type?.Text ?? "";
    const label = field.LabelDetection?.Text ?? "";
    const isFee =
      FEE_TYPES.has(type) ||
      (type === "OTHER" && FEE_LABEL.test(label) && !NOT_FEE_LABEL.test(label));
    if (!isFee) continue;
    const amount = parseMoney(field.ValueDetection?.Text);
    if (amount === undefined || amount <= 0) continue;
    cents += Math.round(amount * 100);
    found = true;
  }
  return found ? cents / 100 : undefined;
};
