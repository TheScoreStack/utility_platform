// Date/time formatting for the Meet module. All Meet times are wall-clock
// values in the EVENT's timezone (phase 1 does no conversion), so these
// helpers format minutes-from-midnight and YYYY-MM-DD strings directly —
// never through the browser's timezone.

import type { MeetSlotRef } from "../types";

/** Noon-anchored so the browser tz can never shift the calendar day. */
const asLocalDate = (date: string): Date => new Date(`${date}T12:00:00`);

/** 540 -> "9 am", 810 -> "1:30 pm", 0/1440 -> "12 am". */
export const formatMinute = (minute: number): string => {
  const m = ((minute % 1440) + 1440) % 1440;
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  const suffix = hours < 12 ? "am" : "pm";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return mins === 0
    ? `${h12} ${suffix}`
    : `${h12}:${String(mins).padStart(2, "0")} ${suffix}`;
};

export const formatMinuteRange = (startMinute: number, endMinute: number) =>
  `${formatMinute(startMinute)} – ${formatMinute(endMinute)}`;

/** "2026-07-10" -> { weekday: "Fri", day: "10", month: "Jul" } for grid headers. */
export const meetDayParts = (date: string) => {
  const d = asLocalDate(date);
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
    day: d.toLocaleDateString(undefined, { day: "numeric" }),
    month: d.toLocaleDateString(undefined, { month: "short" })
  };
};

/** "2026-07-10" -> "Fri, Jul 10". */
export const formatMeetDate = (date: string): string =>
  asLocalDate(date).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });

/** "2026-07-10" -> "Fri, Jul 10, 2026". */
export const formatMeetDateFull = (date: string): string =>
  asLocalDate(date).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });

/** Compact span over the candidate dates: "Jul 10 – Jul 14". */
export const formatMeetDateSpan = (
  first?: string,
  last?: string
): string | null => {
  if (!first) return null;
  const fmt = (date: string) =>
    asLocalDate(date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric"
    });
  if (!last || last === first) return fmt(first);
  return `${fmt(first)} – ${fmt(last)}`;
};

export const formatMeetSlot = (
  slot: MeetSlotRef,
  mode: "time-grid" | "all-day"
): string =>
  mode === "all-day" || (slot.startMinute === 0 && slot.endMinute === 1440)
    ? `${formatMeetDate(slot.date)} · all day`
    : `${formatMeetDate(slot.date)} · ${formatMinuteRange(slot.startMinute, slot.endMinute)}`;

export const browserTimezone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** Every IANA zone the runtime knows, browser zone first. */
export const timezoneOptions = (): string[] => {
  const browser = browserTimezone();
  const intl = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  const all = intl.supportedValuesOf?.("timeZone") ?? [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Asia/Tokyo",
    "Asia/Shanghai",
    "Asia/Kolkata",
    "Australia/Sydney",
    "UTC"
  ];
  return [browser, ...all.filter((zone) => zone !== browser)];
};
