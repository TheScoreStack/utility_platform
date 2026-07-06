import { describe, expect, it } from "vitest";
import {
  buildMeetHeatmap,
  meetSlotsPerDay,
  normalizeMeetAvailability,
  suggestMeetSlots,
  type MeetAvailability,
  type MeetEvent
} from "../types.js";

type GridShape = Pick<
  MeetEvent,
  "mode" | "dates" | "startMinute" | "endMinute" | "slotMinutes" | "settings"
>;

/** 9:00–11:00 in 30-minute slots over two days → 4 slots per day. */
const timeGrid = (overrides: Partial<GridShape> = {}): GridShape => ({
  mode: "time-grid",
  dates: ["2026-07-10", "2026-07-11"],
  startMinute: 540,
  endMinute: 660,
  slotMinutes: 30,
  ...overrides
});

const allDay = (overrides: Partial<GridShape> = {}): GridShape => ({
  mode: "all-day",
  dates: ["2026-07-10", "2026-07-11", "2026-07-12"],
  startMinute: 0,
  endMinute: 1440,
  slotMinutes: 1440,
  ...overrides
});

const respondent = (participantId: string, availability: MeetAvailability) => ({
  participantId,
  availability
});

describe("meetSlotsPerDay", () => {
  it("divides the grid window by the slot size", () => {
    expect(meetSlotsPerDay(timeGrid())).toBe(4);
    expect(
      meetSlotsPerDay(timeGrid({ startMinute: 0, endMinute: 1440, slotMinutes: 60 }))
    ).toBe(24);
  });

  it("always reports one slot per day in all-day mode", () => {
    expect(meetSlotsPerDay(allDay())).toBe(1);
    // Even with nonsense grid numbers, mode wins.
    expect(
      meetSlotsPerDay(allDay({ startMinute: 700, endMinute: 100, slotMinutes: 0 }))
    ).toBe(1);
  });

  it("returns zero slots for degenerate grids", () => {
    expect(meetSlotsPerDay(timeGrid({ endMinute: 540 }))).toBe(0);
    expect(meetSlotsPerDay(timeGrid({ endMinute: 500 }))).toBe(0);
    expect(meetSlotsPerDay(timeGrid({ slotMinutes: 0 }))).toBe(0);
  });

  it("floors partial trailing slots", () => {
    expect(meetSlotsPerDay(timeGrid({ endMinute: 650 }))).toBe(3);
  });
});

describe("normalizeMeetAvailability", () => {
  it("zero-fills every candidate date when input is missing", () => {
    expect(normalizeMeetAvailability(timeGrid(), undefined)).toEqual({
      "2026-07-10": "0000",
      "2026-07-11": "0000"
    });
  });

  it("keeps valid levels and clamps unknown characters to 0", () => {
    const result = normalizeMeetAvailability(timeGrid(), {
      "2026-07-10": "21x9",
      "2026-07-11": "0201"
    });
    expect(result).toEqual({
      "2026-07-10": "2100",
      "2026-07-11": "0201"
    });
  });

  it("drops dates that are not candidates for the event", () => {
    const result = normalizeMeetAvailability(timeGrid(), {
      "2026-07-10": "2222",
      "1999-01-01": "2222"
    });
    expect(Object.keys(result)).toEqual(["2026-07-10", "2026-07-11"]);
    expect(result["2026-07-11"]).toBe("0000");
  });

  it("pads short day strings and truncates long ones", () => {
    const result = normalizeMeetAvailability(timeGrid(), {
      "2026-07-10": "2",
      "2026-07-11": "2222222222"
    });
    expect(result["2026-07-10"]).toBe("2000");
    expect(result["2026-07-11"]).toBe("2222");
  });

  it("downgrades if-need-be to unavailable when the setting disallows it", () => {
    const result = normalizeMeetAvailability(
      timeGrid({ settings: { allowIfNeedBe: false } }),
      { "2026-07-10": "1212" }
    );
    expect(result["2026-07-10"]).toBe("0202");
  });

  it("keeps if-need-be when the setting is absent or true", () => {
    expect(
      normalizeMeetAvailability(timeGrid(), { "2026-07-10": "1111" })[
        "2026-07-10"
      ]
    ).toBe("1111");
    expect(
      normalizeMeetAvailability(timeGrid({ settings: { allowIfNeedBe: true } }), {
        "2026-07-10": "1111"
      })["2026-07-10"]
    ).toBe("1111");
  });

  it("uses one character per date in all-day mode", () => {
    const result = normalizeMeetAvailability(allDay(), {
      "2026-07-10": "2",
      "2026-07-11": "12",
      "2026-07-12": "banana"
    });
    expect(result).toEqual({
      "2026-07-10": "2",
      "2026-07-11": "1",
      "2026-07-12": "0"
    });
  });
});

describe("buildMeetHeatmap", () => {
  it("tallies available and if-need-be participants per slot", () => {
    const heatmap = buildMeetHeatmap(timeGrid(), [
      respondent("a", { "2026-07-10": "2210" }),
      respondent("b", { "2026-07-10": "2001" })
    ]);

    expect(heatmap.participantCount).toBe(2);
    expect(heatmap.maxAvailable).toBe(2);
    expect(heatmap.tally["2026-07-10"].available).toEqual([
      ["a", "b"],
      ["a"],
      [],
      []
    ]);
    expect(heatmap.tally["2026-07-10"].ifNeedBe).toEqual([
      [],
      [],
      ["a"],
      ["b"]
    ]);
    // Untouched dates still get empty per-slot buckets.
    expect(heatmap.tally["2026-07-11"].available).toEqual([[], [], [], []]);
  });

  it("handles no participants", () => {
    const heatmap = buildMeetHeatmap(timeGrid(), []);
    expect(heatmap.participantCount).toBe(0);
    expect(heatmap.maxAvailable).toBe(0);
    expect(heatmap.tally["2026-07-10"].available).toEqual([[], [], [], []]);
  });
});

describe("suggestMeetSlots", () => {
  it("merges consecutive slots with identical attendee sets into one window", () => {
    const suggestions = suggestMeetSlots(timeGrid(), [
      respondent("a", { "2026-07-10": "2220" }),
      respondent("b", { "2026-07-10": "2220" })
    ]);

    expect(suggestions[0]).toMatchObject({
      date: "2026-07-10",
      startMinute: 540,
      endMinute: 630,
      availableIds: ["a", "b"],
      score: 2
    });
  });

  it("splits windows when the attendee set changes mid-block", () => {
    const suggestions = suggestMeetSlots(timeGrid(), [
      respondent("a", { "2026-07-10": "2222" }),
      respondent("b", { "2026-07-10": "0022" })
    ]);

    const both = suggestions.find((s) => s.availableIds.length === 2);
    const solo = suggestions.find((s) => s.availableIds.length === 1);
    expect(both).toMatchObject({ startMinute: 600, endMinute: 660, score: 2 });
    expect(solo).toMatchObject({ startMinute: 540, endMinute: 600, score: 1 });
  });

  it("weights if-need-be at half an available", () => {
    const suggestions = suggestMeetSlots(timeGrid(), [
      respondent("a", { "2026-07-10": "2000" }),
      respondent("b", { "2026-07-10": "1000" })
    ]);

    expect(suggestions[0]).toMatchObject({
      availableIds: ["a"],
      ifNeedBeIds: ["b"],
      score: 1.5
    });
  });

  it("ranks by score, then window length, then chronology", () => {
    const suggestions = suggestMeetSlots(timeGrid(), [
      // Day 1: two people for one slot. Day 2: one person for a longer
      // block early plus a single late slot.
      respondent("a", { "2026-07-10": "2000", "2026-07-11": "2220" }),
      respondent("b", { "2026-07-10": "2000", "2026-07-11": "0001" })
    ]);

    expect(suggestions[0]).toMatchObject({
      date: "2026-07-10",
      score: 2
    });
    // Same-score tie: longer window wins over the earlier-but-shorter one.
    expect(suggestions[1]).toMatchObject({
      date: "2026-07-11",
      startMinute: 540,
      endMinute: 630,
      score: 1
    });
    expect(suggestions[2]).toMatchObject({
      date: "2026-07-11",
      startMinute: 630,
      score: 0.5
    });
  });

  it("prefers longer windows when scores tie, even across days", () => {
    const suggestions = suggestMeetSlots(timeGrid(), [
      respondent("a", { "2026-07-10": "2000", "2026-07-11": "2200" })
    ]);
    expect(suggestions[0]).toMatchObject({
      date: "2026-07-11",
      startMinute: 540,
      endMinute: 600
    });
    expect(suggestions[1]).toMatchObject({
      date: "2026-07-10",
      startMinute: 540,
      endMinute: 570
    });
  });

  it("breaks full ties chronologically", () => {
    const suggestions = suggestMeetSlots(timeGrid(), [
      respondent("a", { "2026-07-10": "0200", "2026-07-11": "2000" })
    ]);
    expect(suggestions.map((s) => [s.date, s.startMinute])).toEqual([
      ["2026-07-10", 570],
      ["2026-07-11", 540]
    ]);
  });

  it("flags quorum using available plus if-need-be", () => {
    const grid = timeGrid({ settings: { quorum: 2 } });
    const suggestions = suggestMeetSlots(grid, [
      respondent("a", { "2026-07-10": "2200" }),
      respondent("b", { "2026-07-10": "1000" })
    ]);

    const first = suggestions.find((s) => s.startMinute === 540);
    const second = suggestions.find((s) => s.startMinute === 570);
    expect(first?.meetsQuorum).toBe(true);
    expect(second?.meetsQuorum).toBe(false);
  });

  it("never meets quorum when no quorum is configured", () => {
    const suggestions = suggestMeetSlots(timeGrid(), [
      respondent("a", { "2026-07-10": "2222" }),
      respondent("b", { "2026-07-10": "2222" })
    ]);
    expect(suggestions[0].meetsQuorum).toBe(false);
  });

  it("drops zero-score windows and respects the limit", () => {
    const nobody = suggestMeetSlots(timeGrid(), [
      respondent("a", { "2026-07-10": "0000" })
    ]);
    expect(nobody).toEqual([]);

    const many = suggestMeetSlots(
      timeGrid(),
      [respondent("a", { "2026-07-10": "2020", "2026-07-11": "2020" })],
      2
    );
    expect(many).toHaveLength(2);
  });

  it("suggests whole days in all-day mode", () => {
    const suggestions = suggestMeetSlots(allDay(), [
      respondent("a", {
        "2026-07-10": "2",
        "2026-07-11": "1",
        "2026-07-12": "0"
      }),
      respondent("b", { "2026-07-10": "2" })
    ]);

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toMatchObject({
      date: "2026-07-10",
      startMinute: 0,
      endMinute: 1440,
      availableIds: ["a", "b"],
      score: 2
    });
    expect(suggestions[1]).toMatchObject({
      date: "2026-07-11",
      ifNeedBeIds: ["a"],
      score: 0.5
    });
  });

  it("tolerates malformed availability by treating it as unavailable", () => {
    const suggestions = suggestMeetSlots(timeGrid(), [
      respondent("a", { "2026-07-10": "zz", "bad-date": "2222" }),
      respondent("b", { "2026-07-10": "2" })
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      date: "2026-07-10",
      startMinute: 540,
      endMinute: 570,
      availableIds: ["b"]
    });
  });
});
