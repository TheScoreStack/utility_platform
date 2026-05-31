// Approximate USD-base FX rates for trip-balance roll-ups.
// These are NOT live rates — they're hand-curated rough conversions
// good enough to summarize a friend trip's balance. The UI surfaces
// an "approx" indicator wherever mixed-currency math is shown.

export type CurrencyCode =
  | "USD"
  | "EUR"
  | "GBP"
  | "CAD"
  | "AUD"
  | "JPY"
  | "MXN"
  | "CHF";

// rate[code] = how many USD one unit of {code} equals
const USD_RATES: Record<CurrencyCode, number> = {
  USD: 1.0,
  EUR: 1.08,
  GBP: 1.27,
  CAD: 0.74,
  AUD: 0.66,
  JPY: 0.0065,
  MXN: 0.058,
  CHF: 1.13
};

const isSupported = (code: string): code is CurrencyCode =>
  Object.prototype.hasOwnProperty.call(USD_RATES, code);

/**
 * Convert an amount expressed in `from` currency into `to` currency.
 * Unknown currencies fall back to 1:1 (no conversion) — better than
 * throwing in a trip-balance hot path.
 */
export const convertCurrency = (
  amount: number,
  from: string,
  to: string
): number => {
  if (!amount || from === to) return amount;
  if (!isSupported(from) || !isSupported(to)) return amount;
  const inUsd = amount * USD_RATES[from];
  return inUsd / USD_RATES[to];
};
