import {
  ATLAS_COUNTRIES,
  ATLAS_COUNTRY_CENTERS,
  ATLAS_US_STATES,
  ATLAS_US_STATE_CENTERS,
  type AtlasPlace,
  type AtlasPlaceSuggestion
} from "@utility-platform/shared";
import airportRows from "./airports.json";

// Local place search: airports (OurAirports), countries and US states.
// Cities come from Amazon Location in placesService; these need no network.

/** [iata, name, city, country, region, lat, lng, isLarge] */
type AirportRow = [string, string, string, string, string, number, number, number];
const AIRPORTS = airportRows as unknown as AirportRow[];
const AIRPORT_BY_IATA = new Map(AIRPORTS.map((row) => [row[0], row]));

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** "US-CA" style codes are only drawn for US states; keep others as-is. */
const regionFor = (country: string, isoRegion: string) =>
  /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(isoRegion) ? isoRegion : undefined;

export const airportPlace = (row: AirportRow): AtlasPlace => {
  const [iata, name, city, country, region, lat, lng] = row;
  const regionCode = regionFor(country, region);
  const state =
    regionCode?.startsWith("US-") ? ATLAS_US_STATES[regionCode.slice(3)] : undefined;
  return {
    providerId: `iata:${iata}`,
    name,
    kind: "airport",
    locality: city || undefined,
    regionCode,
    regionName: state,
    countryCode: country,
    lat,
    lng,
    iata
  };
};

export const airportByIata = (iata: string): AtlasPlace | undefined => {
  const row = AIRPORT_BY_IATA.get(iata.toUpperCase());
  return row ? airportPlace(row) : undefined;
};

const airportSuggestion = (row: AirportRow): AtlasPlaceSuggestion => {
  const place = airportPlace(row);
  return {
    providerId: place.providerId,
    kind: "airport",
    title: `${row[0]} · ${row[1]}`,
    subtitle: [row[2], ATLAS_COUNTRIES[row[3]]?.name].filter(Boolean).join(", "),
    place
  };
};

export const searchAirports = (query: string, limit = 3): AtlasPlaceSuggestion[] => {
  const q = fold(query);
  if (q.length < 2) return [];
  const hits: AirportRow[] = [];
  const exact = AIRPORT_BY_IATA.get(q.toUpperCase());
  if (exact) hits.push(exact);
  if (q.length >= 3) {
    // Large airports sort first in the index, so the first matches are the
    // ones people mean ("london" -> LHR before LCY).
    for (const row of AIRPORTS) {
      if (hits.length >= limit) break;
      if (row === exact) continue;
      const city = fold(row[2]);
      const name = fold(row[1]);
      if (city.startsWith(q) || name.startsWith(q) || name.includes(` ${q}`)) {
        hits.push(row);
      }
    }
  }
  return hits.slice(0, limit).map(airportSuggestion);
};

export const countryPlace = (code: string): AtlasPlace | undefined => {
  const country = ATLAS_COUNTRIES[code];
  const center = ATLAS_COUNTRY_CENTERS[code];
  if (!country || !center) return undefined;
  return {
    providerId: `country:${code}`,
    name: country.name,
    kind: "country",
    countryCode: code,
    lat: center[0],
    lng: center[1]
  };
};

export const statePlace = (code: string): AtlasPlace | undefined => {
  const name = ATLAS_US_STATES[code];
  const center = ATLAS_US_STATE_CENTERS[code];
  if (!name || !center) return undefined;
  return {
    providerId: `region:US-${code}`,
    name,
    kind: "region",
    regionCode: `US-${code}`,
    regionName: name,
    countryCode: "US",
    lat: center[0],
    lng: center[1]
  };
};

export const searchAreas = (query: string, limit = 3): AtlasPlaceSuggestion[] => {
  const q = fold(query);
  if (q.length < 3) return [];
  const out: AtlasPlaceSuggestion[] = [];
  for (const [code, country] of Object.entries(ATLAS_COUNTRIES)) {
    if (out.length >= limit) break;
    if (!fold(country.name).startsWith(q)) continue;
    const place = countryPlace(code);
    if (place) {
      out.push({ providerId: place.providerId, kind: "country", title: country.name, subtitle: "Country", place });
    }
  }
  for (const code of Object.keys(ATLAS_US_STATES)) {
    if (out.length >= limit) break;
    if (!fold(ATLAS_US_STATES[code]).startsWith(q)) continue;
    const place = statePlace(code);
    if (place) {
      out.push({ providerId: place.providerId, kind: "region", title: place.name, subtitle: "US state", place });
    }
  }
  return out;
};

/** Resolves the local provider ids ("iata:", "country:", "region:"). */
export const resolveLocal = (providerId: string): AtlasPlace | undefined => {
  const [scheme, value] = providerId.split(":", 2);
  if (!value) return undefined;
  if (scheme === "iata") return airportByIata(value);
  if (scheme === "country") return countryPlace(value);
  if (scheme === "region" && value.startsWith("US-")) return statePlace(value.slice(3));
  return undefined;
};

/** "Kyoto, Japan, Japan" -> ["Kyoto", "Japan"]. */
export const splitLabel = (label: string): string[] => {
  const parts = label.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.filter((p, i) => i === 0 || p !== parts[i - 1]);
};
