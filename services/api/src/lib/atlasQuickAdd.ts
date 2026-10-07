import { ATLAS_SOLO_CIRCLE_ID, type AtlasDatePrecision } from "@utility-platform/shared";

export interface QuickAddLine {
  line: string;
  title: string;
  places: string[];
  start?: string;
  datePrecision?: AtlasDatePrecision;
  circleIds: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : undefined);

/** Builds a fuzzy start date from whatever parts the model returned. */
export const fuzzyStart = (
  year?: number,
  month?: number,
  day?: number
): { start?: string; datePrecision?: AtlasDatePrecision } => {
  const thisYear = new Date().getUTCFullYear();
  if (!year || year < 1900 || year > thisYear + 1) return {};
  if (!month || month < 1 || month > 12) return { start: String(year), datePrecision: "year" };
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!day || day < 1 || day > daysInMonth) {
    return { start: `${year}-${pad(month)}`, datePrecision: "month" };
  }
  return { start: `${year}-${pad(month)}-${pad(day)}`, datePrecision: "day" };
};

/**
 * Clamps the model's tool input into well-formed lines: drops entries with
 * no title or places, unknown circle ids, and impossible dates.
 */
export const sanitizeQuickAddLines = (
  input: unknown,
  knownCircleIds: Set<string>
): QuickAddLine[] => {
  const trips = (input as { trips?: unknown })?.trips;
  if (!Array.isArray(trips)) return [];
  return trips.flatMap((raw): QuickAddLine[] => {
    const t = (raw ?? {}) as Record<string, unknown>;
    const places = Array.isArray(t.places)
      ? t.places.map(str).filter(Boolean).slice(0, 12)
      : [];
    const title = str(t.title).slice(0, 120) || places[0] || "";
    if (!title || !places.length) return [];
    const circles = Array.isArray(t.circleIds)
      ? [...new Set(t.circleIds.map(str).filter((c) => knownCircleIds.has(c)))]
      : [];
    const others = circles.filter((c) => c !== ATLAS_SOLO_CIRCLE_ID);
    return [
      {
        line: str(t.line),
        title,
        places,
        ...fuzzyStart(int(t.year), int(t.month), int(t.day)),
        circleIds: others.length ? others : circles
      }
    ];
  });
};
