// Meet (group scheduling) domain contract shared between the API
// (services/api) and the web app (apps/web). The Flutter package
// (packages/meet_kit) mirrors the availability encoding defined here —
// keep the two in sync when changing slot or encoding semantics.

/** Hour-by-hour grid (When2Meet style) or one slot per candidate date. */
export type MeetMode = "time-grid" | "all-day";

export type MeetStatus = "open" | "finalized";

/**
 * Availability is encoded as one character per slot:
 *   "0" = unavailable, "1" = if need be, "2" = available.
 * Each candidate date maps to a string of slotsPerDay(event) characters
 * ("all-day" mode uses a single character per date). Compact, JSON-safe,
 * and trivially portable to Dart.
 */
export type MeetAvailability = Record<string, string>;

export type MeetAvailabilityLevel = 0 | 1 | 2;

export interface MeetSlotRef {
  /** Candidate date, YYYY-MM-DD, in the event's timezone. */
  date: string;
  /** Minutes from midnight in the event's timezone. */
  startMinute: number;
  endMinute: number;
}

export interface MeetEventSettings {
  /** ISO timestamp after which responses are considered late (Phase 2 nudges). */
  responseDeadline?: string;
  /** Minimum attendee count highlighted by slot suggestions. */
  quorum?: number;
  /** Allow the intermediate "if need be" level. Default true. */
  allowIfNeedBe?: boolean;
  /** When true, new participants cannot join. */
  locked?: boolean;
}

export interface MeetEvent {
  eventId: string;
  /** Short unguessable id used in share links (/m/<slug>). */
  slug: string;
  organizerId: string;
  organizerName?: string;
  title: string;
  description?: string;
  mode: MeetMode;
  /** IANA timezone the grid is defined in, e.g. "America/New_York". */
  timezone: string;
  /** Candidate dates, YYYY-MM-DD in the event timezone, sorted ascending. */
  dates: string[];
  /** Grid window, minutes from midnight in the event timezone ("time-grid"). */
  startMinute: number;
  endMinute: number;
  /** Slot granularity in minutes ("time-grid"); 15, 30, or 60. */
  slotMinutes: number;
  settings?: MeetEventSettings;
  status: MeetStatus;
  finalizedSlot?: MeetSlotRef;
  /** Monotonic counter bumped on every event/participant write; lets
   *  respond pages poll cheaply and skip unchanged payloads. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MeetParticipant {
  eventId: string;
  participantId: string;
  displayName: string;
  /** Set for signed-in responders; guests have only a secret (never exposed). */
  userId?: string;
  email?: string;
  /** Responder's own IANA timezone, for "3pm for you is 9pm for Sam" hints. */
  timezone?: string;
  role: "organizer" | "participant";
  availability: MeetAvailability;
  respondedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const MEET_SLOT_MINUTES_OPTIONS = [15, 30, 60] as const;

export const meetSlotsPerDay = (
  event: Pick<MeetEvent, "mode" | "startMinute" | "endMinute" | "slotMinutes">
): number => {
  if (event.mode === "all-day") return 1;
  if (event.slotMinutes <= 0 || event.endMinute <= event.startMinute) return 0;
  return Math.floor((event.endMinute - event.startMinute) / event.slotMinutes);
};

export const meetSlotRef = (
  event: Pick<MeetEvent, "mode" | "startMinute" | "endMinute" | "slotMinutes">,
  date: string,
  slotIndex: number
): MeetSlotRef => {
  if (event.mode === "all-day") {
    return { date, startMinute: 0, endMinute: 24 * 60 };
  }
  const start = event.startMinute + slotIndex * event.slotMinutes;
  return { date, startMinute: start, endMinute: start + event.slotMinutes };
};

const emptyDay = (slots: number): string => "0".repeat(slots);

/**
 * Clamps untrusted availability input to the event's grid: only candidate
 * dates survive, day strings are padded/truncated to the slot count, and
 * anything but "1"/"2" (or "1" when if-need-be is disabled) becomes "0".
 * The API runs every availability write through this.
 */
export const normalizeMeetAvailability = (
  event: Pick<
    MeetEvent,
    "mode" | "dates" | "startMinute" | "endMinute" | "slotMinutes" | "settings"
  >,
  input: MeetAvailability | undefined
): MeetAvailability => {
  const slots = meetSlotsPerDay(event);
  const allowIfNeedBe = event.settings?.allowIfNeedBe !== false;
  const result: MeetAvailability = {};
  for (const date of event.dates) {
    const raw = input?.[date] ?? "";
    let day = "";
    for (let i = 0; i < slots; i++) {
      const ch = raw[i];
      day +=
        ch === "2" ? "2" : ch === "1" ? (allowIfNeedBe ? "1" : "0") : "0";
    }
    result[date] = day || emptyDay(slots);
  }
  return result;
};

export const meetLevelAt = (
  availability: MeetAvailability,
  date: string,
  slotIndex: number
): MeetAvailabilityLevel => {
  const ch = availability[date]?.[slotIndex];
  return ch === "2" ? 2 : ch === "1" ? 1 : 0;
};

export interface MeetSlotTally {
  /** Participant ids marked available, per slot index. */
  available: string[][];
  /** Participant ids marked if-need-be, per slot index. */
  ifNeedBe: string[][];
}

export interface MeetHeatmap {
  /** Per candidate date, per slot: who can make it. */
  tally: Record<string, MeetSlotTally>;
  participantCount: number;
  /** Highest available-count across all slots; drives heat scaling. */
  maxAvailable: number;
}

/** Aggregates all responses into per-slot attendee lists for the heatmap. */
export const buildMeetHeatmap = (
  event: Pick<
    MeetEvent,
    "mode" | "dates" | "startMinute" | "endMinute" | "slotMinutes"
  >,
  participants: Array<Pick<MeetParticipant, "participantId" | "availability">>
): MeetHeatmap => {
  const slots = meetSlotsPerDay(event);
  const tally: Record<string, MeetSlotTally> = {};
  let maxAvailable = 0;
  for (const date of event.dates) {
    const available: string[][] = Array.from({ length: slots }, () => []);
    const ifNeedBe: string[][] = Array.from({ length: slots }, () => []);
    for (const participant of participants) {
      for (let i = 0; i < slots; i++) {
        const level = meetLevelAt(participant.availability, date, i);
        if (level === 2) available[i].push(participant.participantId);
        else if (level === 1) ifNeedBe[i].push(participant.participantId);
      }
    }
    for (let i = 0; i < slots; i++) {
      if (available[i].length > maxAvailable) maxAvailable = available[i].length;
    }
    tally[date] = { available, ifNeedBe };
  }
  return { tally, participantCount: participants.length, maxAvailable };
};

export interface MeetSuggestion extends MeetSlotRef {
  availableIds: string[];
  ifNeedBeIds: string[];
  /** available + 0.5 * ifNeedBe — what the ranking sorts by. */
  score: number;
  meetsQuorum: boolean;
}

/**
 * Ranks candidate windows for "best times". Consecutive slots whose
 * attendee sets are identical merge into a single window, so a clear
 * 2-hour block surfaces as one suggestion instead of four 30-minute rows.
 * Sorted by score, then longer windows, then chronologically.
 */
export const suggestMeetSlots = (
  event: Pick<
    MeetEvent,
    "mode" | "dates" | "startMinute" | "endMinute" | "slotMinutes" | "settings"
  >,
  participants: Array<Pick<MeetParticipant, "participantId" | "availability">>,
  limit = 3
): MeetSuggestion[] => {
  const slots = meetSlotsPerDay(event);
  const quorum = event.settings?.quorum ?? 0;
  const windows: MeetSuggestion[] = [];
  for (const date of event.dates) {
    let open: MeetSuggestion | undefined;
    for (let i = 0; i < slots; i++) {
      const availableIds = participants
        .filter((p) => meetLevelAt(p.availability, date, i) === 2)
        .map((p) => p.participantId);
      const ifNeedBeIds = participants
        .filter((p) => meetLevelAt(p.availability, date, i) === 1)
        .map((p) => p.participantId);
      const ref = meetSlotRef(event, date, i);
      const sameAsOpen =
        open &&
        open.availableIds.join("|") === availableIds.join("|") &&
        open.ifNeedBeIds.join("|") === ifNeedBeIds.join("|");
      if (sameAsOpen && open) {
        open.endMinute = ref.endMinute;
      } else {
        if (open) windows.push(open);
        open = {
          ...ref,
          availableIds,
          ifNeedBeIds,
          score: availableIds.length + ifNeedBeIds.length * 0.5,
          meetsQuorum:
            quorum > 0 && availableIds.length + ifNeedBeIds.length >= quorum,
        };
      }
    }
    if (open) windows.push(open);
  }
  return windows
    .filter((w) => w.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.endMinute - b.startMinute - (a.endMinute - a.startMinute) ||
        a.date.localeCompare(b.date) ||
        a.startMinute - b.startMinute
    )
    .slice(0, limit);
};
