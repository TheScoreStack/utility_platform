import { describe, expect, it } from "vitest";
import { airportByIata, resolveLocal, searchAirports, searchAreas, splitLabel } from "./atlasPlaces.js";

describe("local place search", () => {
  it("finds airports by IATA code and by city", () => {
    expect(airportByIata("sfo")).toMatchObject({ iata: "SFO", countryCode: "US", regionCode: "US-CA", kind: "airport" });
    expect(searchAirports("JFK")[0].place?.iata).toBe("JFK");
    expect(searchAirports("london").map((s) => s.place?.iata)).toContain("LHR");
  });
  it("finds countries and US states with a center point", () => {
    expect(searchAreas("portu")[0]).toMatchObject({ kind: "country", place: { countryCode: "PT" } });
    expect(searchAreas("tenn")[0]).toMatchObject({ kind: "region", place: { regionCode: "US-TN" } });
  });
  it("resolves its own provider ids", () => {
    expect(resolveLocal("country:JP")?.name).toBe("Japan");
    expect(resolveLocal("region:US-MT")?.name).toBe("Montana");
    expect(resolveLocal("iata:LIS")?.countryCode).toBe("PT");
    expect(resolveLocal("AQAAADgA")).toBeUndefined();
  });
  it("collapses repeated label parts", () => {
    expect(splitLabel("Kyoto, Japan, Japan")).toEqual(["Kyoto", "Japan"]);
  });
});
