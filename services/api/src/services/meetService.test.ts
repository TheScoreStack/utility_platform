import { describe, expect, it } from "vitest";
import type { StoredMeetParticipant } from "../data/meetStore.js";
import {
  assertValidMeetFinalizeSlot,
  hashMeetSecret,
  parseCreateMeetEventInput,
  sanitizeMeetParticipantForUser,
  sanitizeMeetParticipantPublic,
  verifyMeetSecret
} from "./meetService.js";

describe("parseCreateMeetEventInput", () => {
  const base = {
    title: "Team offsite",
    mode: "time-grid",
    timezone: "America/New_York",
    dates: ["2026-07-11", "2026-07-10"],
    startMinute: 540,
    endMinute: 1020,
    slotMinutes: 30
  };

  it("accepts a valid time-grid event and sorts/dedupes dates", () => {
    const input = parseCreateMeetEventInput({
      ...base,
      dates: ["2026-07-11", "2026-07-10", "2026-07-10"]
    });
    expect(input.dates).toEqual(["2026-07-10", "2026-07-11"]);
    expect(input).toMatchObject({
      mode: "time-grid",
      startMinute: 540,
      endMinute: 1020,
      slotMinutes: 30
    });
  });

  it("defaults the grid window to the full day at 30-minute slots", () => {
    const input = parseCreateMeetEventInput({
      title: "Coffee",
      mode: "time-grid",
      timezone: "UTC",
      dates: ["2026-07-10"]
    });
    expect(input).toMatchObject({
      startMinute: 0,
      endMinute: 1440,
      slotMinutes: 30
    });
  });

  it("forces the all-day pseudo-grid regardless of supplied minutes", () => {
    const input = parseCreateMeetEventInput({
      title: "Trip week",
      mode: "all-day",
      timezone: "UTC",
      dates: ["2026-07-10"],
      startMinute: 540,
      endMinute: 600,
      slotMinutes: 15
    });
    expect(input).toMatchObject({
      startMinute: 0,
      endMinute: 1440,
      slotMinutes: 1440
    });
  });

  it("rejects empty and overlong titles", () => {
    expect(() =>
      parseCreateMeetEventInput({ ...base, title: "  " })
    ).toThrowError(/title/i);
    expect(() =>
      parseCreateMeetEventInput({ ...base, title: "x".repeat(201) })
    ).toThrowError(/title/i);
  });

  it("rejects missing, malformed, and excessive dates", () => {
    expect(() =>
      parseCreateMeetEventInput({ ...base, dates: [] })
    ).toThrow();
    expect(() =>
      parseCreateMeetEventInput({ ...base, dates: ["July 10th"] })
    ).toThrowError(/YYYY-MM-DD/);
    const tooMany = Array.from(
      { length: 61 },
      (_, i) =>
        `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-` +
        String((i % 28) + 1).padStart(2, "0")
    );
    expect(() =>
      parseCreateMeetEventInput({ ...base, dates: tooMany })
    ).toThrow();
  });

  it("rejects slot sizes outside 15/30/60", () => {
    expect(() =>
      parseCreateMeetEventInput({ ...base, slotMinutes: 45 })
    ).toThrowError(/slotMinutes/);
  });

  it("rejects inverted or out-of-range grid windows", () => {
    expect(() =>
      parseCreateMeetEventInput({ ...base, startMinute: 600, endMinute: 600 })
    ).toThrowError(/startMinute < endMinute/);
    expect(() =>
      parseCreateMeetEventInput({ ...base, startMinute: -30 })
    ).toThrowError(/startMinute < endMinute/);
    expect(() =>
      parseCreateMeetEventInput({ ...base, endMinute: 1470 })
    ).toThrowError(/startMinute < endMinute/);
  });

  it("rejects window edges that are not multiples of the slot size", () => {
    expect(() =>
      parseCreateMeetEventInput({ ...base, startMinute: 545 })
    ).toThrowError(/multiples/);
    expect(() =>
      parseCreateMeetEventInput({ ...base, slotMinutes: 60, endMinute: 1050 })
    ).toThrowError(/multiples/);
  });
});

describe("assertValidMeetFinalizeSlot", () => {
  const grid = {
    mode: "time-grid" as const,
    dates: ["2026-07-10"],
    startMinute: 540,
    endMinute: 1020,
    slotMinutes: 30
  };

  it("accepts aligned windows inside the grid", () => {
    expect(() =>
      assertValidMeetFinalizeSlot(grid, {
        date: "2026-07-10",
        startMinute: 600,
        endMinute: 720
      })
    ).not.toThrow();
  });

  it("rejects non-candidate dates", () => {
    expect(() =>
      assertValidMeetFinalizeSlot(grid, {
        date: "2026-07-11",
        startMinute: 600,
        endMinute: 720
      })
    ).toThrowError(/candidate date/);
  });

  it("rejects windows outside or inverted within the grid", () => {
    expect(() =>
      assertValidMeetFinalizeSlot(grid, {
        date: "2026-07-10",
        startMinute: 480,
        endMinute: 600
      })
    ).toThrowError(/outside the grid/);
    expect(() =>
      assertValidMeetFinalizeSlot(grid, {
        date: "2026-07-10",
        startMinute: 720,
        endMinute: 720
      })
    ).toThrowError(/outside the grid/);
  });

  it("rejects windows that do not align with the slot grid", () => {
    expect(() =>
      assertValidMeetFinalizeSlot(grid, {
        date: "2026-07-10",
        startMinute: 555,
        endMinute: 705
      })
    ).toThrowError(/align/);
  });

  it("requires the whole day for all-day events", () => {
    const allDay = { ...grid, mode: "all-day" as const };
    expect(() =>
      assertValidMeetFinalizeSlot(allDay, {
        date: "2026-07-10",
        startMinute: 0,
        endMinute: 1440
      })
    ).not.toThrow();
    expect(() =>
      assertValidMeetFinalizeSlot(allDay, {
        date: "2026-07-10",
        startMinute: 0,
        endMinute: 720
      })
    ).toThrowError(/whole day/);
  });
});

describe("guest secret hashing", () => {
  it("hashes to deterministic sha256 hex", () => {
    const hash = hashMeetSecret("super-secret");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashMeetSecret("super-secret")).toBe(hash);
    expect(hashMeetSecret("other-secret")).not.toBe(hash);
  });

  it("verifies the matching secret and rejects everything else", () => {
    const hash = hashMeetSecret("super-secret");
    expect(verifyMeetSecret("super-secret", hash)).toBe(true);
    expect(verifyMeetSecret("wrong", hash)).toBe(false);
    expect(verifyMeetSecret("super-secret", "")).toBe(false);
    expect(verifyMeetSecret("super-secret", "not-hex")).toBe(false);
  });
});

describe("participant sanitization", () => {
  const stored: StoredMeetParticipant = {
    eventId: "meet_abc",
    participantId: "user-1",
    displayName: "Sam",
    userId: "user-1",
    email: "sam@example.com",
    timezone: "America/Chicago",
    role: "organizer",
    availability: { "2026-07-10": "2200" },
    respondedAt: "2026-07-01T00:00:00.000Z",
    secretHash: "abc123",
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  };

  it("public shape exposes only respond-page fields", () => {
    expect(sanitizeMeetParticipantPublic(stored)).toEqual({
      participantId: "user-1",
      displayName: "Sam",
      timezone: "America/Chicago",
      role: "organizer",
      availability: { "2026-07-10": "2200" },
      respondedAt: "2026-07-01T00:00:00.000Z"
    });
  });

  it("authed shape keeps userId and email only for the caller's own row", () => {
    const own = sanitizeMeetParticipantForUser(stored, "user-1");
    expect(own.userId).toBe("user-1");
    expect(own.email).toBe("sam@example.com");
    expect(own).not.toHaveProperty("secretHash");

    const other = sanitizeMeetParticipantForUser(stored, "user-2");
    expect(other.userId).toBeUndefined();
    expect(other.email).toBeUndefined();
    expect(other).not.toHaveProperty("secretHash");
    expect(other.displayName).toBe("Sam");
    expect(other.availability).toEqual({ "2026-07-10": "2200" });
  });

  it("never leaks a guest's secret hash in either shape", () => {
    const guest: StoredMeetParticipant = {
      ...stored,
      participantId: "pt_guest",
      userId: undefined,
      email: undefined,
      role: "participant"
    };
    expect(sanitizeMeetParticipantPublic(guest)).not.toHaveProperty(
      "secretHash"
    );
    expect(
      sanitizeMeetParticipantForUser(guest, "user-1")
    ).not.toHaveProperty("secretHash");
  });
});
