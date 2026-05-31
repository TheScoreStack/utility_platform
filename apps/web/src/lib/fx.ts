// Approximate USD-base FX rates — must stay in sync with services/api/src/lib/fx.ts.
// These are NOT live rates; the UI surfaces an "approx" indicator wherever
// mixed-currency math is shown.

export interface CurrencyOption {
  code: string;
  label: string;
  symbol: string;
}

export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: "USD", label: "US Dollar", symbol: "$" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "GBP", label: "British Pound", symbol: "£" },
  { code: "CAD", label: "Canadian Dollar", symbol: "CA$" },
  { code: "AUD", label: "Australian Dollar", symbol: "A$" },
  { code: "JPY", label: "Japanese Yen", symbol: "¥" },
  { code: "MXN", label: "Mexican Peso", symbol: "MX$" },
  { code: "CHF", label: "Swiss Franc", symbol: "CHF" }
];

const USD_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 1.08,
  GBP: 1.27,
  CAD: 0.74,
  AUD: 0.66,
  JPY: 0.0065,
  MXN: 0.058,
  CHF: 1.13
};

export const isSupportedCurrency = (code: string): boolean =>
  Object.prototype.hasOwnProperty.call(USD_RATES, code);

export const convertCurrency = (
  amount: number,
  from: string,
  to: string
): number => {
  if (!amount || from === to) return amount;
  if (!isSupportedCurrency(from) || !isSupportedCurrency(to)) return amount;
  const inUsd = amount * USD_RATES[from];
  return inUsd / USD_RATES[to];
};
