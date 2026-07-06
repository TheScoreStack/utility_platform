export interface ExpenseCategory {
  id: string;
  label: string;
  icon: string;
  color: string;
}

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { id: "meals", label: "Meals", icon: "🍽", color: "#f9a8d4" },
  { id: "lodging", label: "Lodging", icon: "🏨", color: "#c4b5fd" },
  { id: "transport", label: "Transport", icon: "🚗", color: "#91a7ff" },
  { id: "fuel", label: "Fuel", icon: "⛽", color: "#fcd34d" },
  { id: "groceries", label: "Groceries", icon: "🛒", color: "#86efac" },
  { id: "activities", label: "Activities", icon: "🎟", color: "#fdba74" },
  { id: "drinks", label: "Drinks", icon: "☕", color: "#fda4af" },
  { id: "other", label: "Other", icon: "📦", color: "#cbd5e1" }
];

const CATEGORIES_BY_LABEL = new Map(
  EXPENSE_CATEGORIES.map((c) => [c.label.toLowerCase(), c])
);
const CATEGORIES_BY_ID = new Map(EXPENSE_CATEGORIES.map((c) => [c.id, c]));

/**
 * Resolve a stored category value (free-text from legacy data, or a canonical
 * id from the new picker) to a catalog entry. Returns null if it's a
 * non-empty custom string that doesn't match any catalog entry — callers
 * should render the raw text as an "Other" pill in that case.
 */
export const resolveExpenseCategory = (
  raw: string | undefined | null
): ExpenseCategory | null => {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  return (
    CATEGORIES_BY_ID.get(normalized) ?? CATEGORIES_BY_LABEL.get(normalized) ?? null
  );
};

/**
 * Stable key for grouping/filtering — collapses legacy "Meals", canonical
 * "meals", and any custom string variant into a single identifier.
 */
export const normalizeCategoryKey = (
  raw: string | undefined | null
): string => (raw ? raw.trim().toLowerCase() : "");
