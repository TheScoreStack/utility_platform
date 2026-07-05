import type { RecurrenceCadence } from "../types.js";

/**
 * Advances a recurrence timestamp by one cadence step. Monthly recurrences
 * keep the original day-of-month where possible and clamp to the last day of
 * shorter months (Jan 31 → Feb 28 → Mar 28 is avoided by advancing from the
 * ORIGINAL nextRunAt each cycle, so callers should always advance the stored
 * timestamp, never "now").
 */
export const advanceCadence = (
  iso: string,
  cadence: RecurrenceCadence
): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid recurrence timestamp: ${iso}`);
  }

  if (cadence === "weekly") {
    date.setUTCDate(date.getUTCDate() + 7);
    return date.toISOString();
  }

  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const daysInTargetMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
  date.setUTCDate(Math.min(day, daysInTargetMonth));
  return date.toISOString();
};
