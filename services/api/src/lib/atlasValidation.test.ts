import { describe, expect, it } from "vitest";
import {
  assertOwnCoverKey,
  createTripSchema,
  normalizeCircleIds,
  normalizeDates,
  parseWith
} from "./atlasValidation.js";
import { ValidationError } from "./errors.js";

const place = {
  providerId: "iata:SFO",
  name: "San Francisco International Airport",
  kind: "airport",
  regionCode: "US-CA",
  countryCode: "US",
  lat: 37.6,
  lng: -122.4,
  iata: "SFO"
};

describe("normalizeDates", () => {
  it("derives precision from the start date's shape", () => {
    expect(normalizeDates("2018", undefined)).toEqual({ start: "2018", datePrecision: "year" });
    expect(normalizeDates("2018-07", "2018-07-20")).toEqual({ start: "2018-07", datePrecision: "month" });
    expect(normalizeDates("2018-07-14", "2018-07-20")).toEqual({
      start: "2018-07-14",
      end: "2018-07-20",
      datePrecision: "day"
    });
  });
  it("drops a same-day end and rejects an end before the start", () => {
    expect(normalizeDates("2018-07-14", "2018-07-14").end).toBeUndefined();
    expect(() => normalizeDates("2018-07-14", "2018-07-01")).toThrow(ValidationError);
  });
});

describe("normalizeCircleIds", () => {
  const known = new Set(["solo", "circle_wife", "circle_shop"]);
  it("keeps companions over solo and drops unknown ids", () => {
    expect(normalizeCircleIds(["solo", "circle_wife", "nope"], known)).toEqual(["circle_wife"]);
    expect(normalizeCircleIds(["solo", "solo"], known)).toEqual(["solo"]);
    expect(normalizeCircleIds([], known)).toEqual([]);
  });
});

describe("createTripSchema", () => {
  it("accepts a fuzzy-dated trip and rejects bad dates and countries", () => {
    expect(parseWith(createTripSchema, { title: "Napa", start: "2025-06", stops: [{ place }] }).stops).toHaveLength(1);
    expect(() => parseWith(createTripSchema, { title: "Napa", start: "2025-13" })).toThrow(/start/);
    expect(() =>
      parseWith(createTripSchema, {
        title: "Nowhere",
        start: "2025",
        stops: [{ place: { ...place, countryCode: "ZZ" } }]
      })
    ).toThrow(/Unknown country/);
  });
});

describe("assertOwnCoverKey", () => {
  it("only allows keys under the caller's prefix", () => {
    expect(() => assertOwnCoverKey("u1", "atlas/u1/covers/a.jpg")).not.toThrow();
    expect(() => assertOwnCoverKey("u1", "atlas/u2/covers/a.jpg")).toThrow(ValidationError);
    expect(() => assertOwnCoverKey("u1", "trips/x/receipts/a.jpg")).toThrow(ValidationError);
  });
});
