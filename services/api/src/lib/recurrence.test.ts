import { describe, expect, it } from "vitest";
import { advanceCadence } from "./recurrence.js";

describe("advanceCadence", () => {
  it("adds seven days for weekly", () => {
    expect(advanceCadence("2026-07-05T12:00:00.000Z", "weekly")).toBe(
      "2026-07-12T12:00:00.000Z"
    );
  });

  it("crosses month boundaries for weekly", () => {
    expect(advanceCadence("2026-07-28T12:00:00.000Z", "weekly")).toBe(
      "2026-08-04T12:00:00.000Z"
    );
  });

  it("keeps the day of month for monthly", () => {
    expect(advanceCadence("2026-07-15T12:00:00.000Z", "monthly")).toBe(
      "2026-08-15T12:00:00.000Z"
    );
  });

  it("clamps to the end of shorter months", () => {
    expect(advanceCadence("2026-01-31T12:00:00.000Z", "monthly")).toBe(
      "2026-02-28T12:00:00.000Z"
    );
  });

  it("crosses year boundaries for monthly", () => {
    expect(advanceCadence("2026-12-31T12:00:00.000Z", "monthly")).toBe(
      "2027-01-31T12:00:00.000Z"
    );
  });

  it("throws on garbage input", () => {
    expect(() => advanceCadence("not-a-date", "weekly")).toThrow();
  });
});
