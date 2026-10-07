import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyLens,
  computeStats,
  firstsForTrip,
  formatTripDates,
  frequentPlaces,
  greatCircleMiles,
  tripDays,
  type AtlasLens,
  type AtlasStats,
  type AtlasTrip
} from "@utility-platform/shared";

// The same fixtures drive apps/mobile/test/atlas_lens_test.dart, so web and
// phone can't disagree about a count.
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../packages/shared/fixtures/atlas/${name}`, import.meta.url),
      "utf8"
    )
  );
const atlas = fixture("sample-atlas.json") as { trips: AtlasTrip[] };
const expected = fixture("expected-stats.json") as Record<
  string,
  { lens: AtlasLens; tripIds: string[]; stats: AtlasStats }
>;

describe("Atlas lenses and stats (shared fixtures)", () => {
  for (const [name, { lens, tripIds, stats }] of Object.entries(expected)) {
    it(`matches the ${name} lens`, () => {
      const trips = applyLens(atlas.trips, lens);
      expect(trips.map((t) => t.tripId)).toEqual(tripIds);
      expect(computeStats(trips)).toEqual(stats);
    });
  }
});

describe("greatCircleMiles", () => {
  it("measures SFO to JFK at about 2,580 miles", () => {
    const miles = greatCircleMiles({ lat: 37.619, lng: -122.375 }, { lat: 40.6398, lng: -73.7789 });
    expect(miles).toBeGreaterThan(2570);
    expect(miles).toBeLessThan(2590);
  });
});

describe("firstsForTrip", () => {
  it("flags only countries and states no other trip reached", () => {
    const lisbon = atlas.trips.find((t) => t.tripId === "t_lis")!;
    const others = atlas.trips.filter((t) => t.tripId !== "t_lis");
    expect(firstsForTrip(lisbon, others)).toEqual({ countries: ["PT"], regions: [] });
    expect(firstsForTrip(lisbon, [])).toEqual({ countries: ["PT", "US"], regions: ["US-CA"] });
  });
});

describe("formatTripDates / tripDays", () => {
  it("formats each precision", () => {
    expect(formatTripDates({ start: "2019", datePrecision: "year" })).toBe("2019");
    expect(formatTripDates({ start: "2025-04", datePrecision: "month" })).toBe("Apr 2025");
    expect(formatTripDates({ start: "2025-06-12", end: "2025-06-15", datePrecision: "day" })).toBe(
      "Jun 12 to 15, 2025"
    );
    expect(formatTripDates({ start: "2025-06-29", end: "2025-07-02", datePrecision: "day" })).toBe(
      "Jun 29 to Jul 2, 2025"
    );
    expect(formatTripDates({ start: "2024-12-30", end: "2025-01-02", datePrecision: "day" })).toBe(
      "Dec 30, 2024 to Jan 2, 2025"
    );
  });
  it("counts days inclusively", () => {
    expect(tripDays({ start: "2025-06-12", end: "2025-06-15", datePrecision: "day" })).toBe(4);
    expect(tripDays({ start: "2025-06-12", datePrecision: "day" })).toBe(1);
    expect(tripDays({ start: "2025-06", datePrecision: "month" })).toBeUndefined();
  });
});

describe("frequentPlaces", () => {
  it("ranks airports by how many trips used them, then recency", () => {
    expect(frequentPlaces(atlas.trips, "airports").map((p) => p.iata)).toEqual([
      "SFO",
      "LAX",
      "BNA",
      "LIS"
    ]);
  });
  it("ranks stop places (never airports) the same way", () => {
    const names = frequentPlaces(atlas.trips, "stops", 3).map((p) => p.name);
    expect(names).toEqual(["San Francisco", "Yountville", "Nashville"]);
  });
});
