// Atlas (personal travel map) domain contract shared between the API
// (services/api) and the web app (apps/web). The Flutter app mirrors the
// lens and stats rules in lib/modules/atlas/lens.dart — both are checked
// against the fixtures in packages/shared/fixtures/atlas/.

import {
  ATLAS_COUNTRIES,
  ATLAS_CONTINENTS,
  ATLAS_COUNTRY_CENTERS,
  ATLAS_US_STATES,
  ATLAS_US_STATE_CENTERS,
  type AtlasContinent
} from "./atlasGeoData.js";

export {
  ATLAS_COUNTRIES,
  ATLAS_CONTINENTS,
  ATLAS_COUNTRY_CENTERS,
  ATLAS_US_STATES,
  ATLAS_US_STATE_CENTERS
};
export type { AtlasContinent };

/** Built-in circle meaning "no companions". It cannot be deleted. */
export const ATLAS_SOLO_CIRCLE_ID = "solo";

/** Curated circle colors; a circle stores the key, clients map it to a hue. */
export const ATLAS_CIRCLE_COLORS = [
  "rose",
  "amber",
  "emerald",
  "sky",
  "violet",
  "coral",
  "teal",
  "slate"
] as const;
export type AtlasCircleColor = (typeof ATLAS_CIRCLE_COLORS)[number];

export type AtlasPlaceKind = "city" | "region" | "country" | "airport" | "poi";

/** A place snapshot. Coloring the map only needs the two codes. */
export interface AtlasPlace {
  /** Amazon Location place id, or "iata:SFO" for airports. */
  providerId: string;
  name: string;
  kind: AtlasPlaceKind;
  locality?: string;
  /** ISO 3166-2 style, e.g. "US-CA". Only US states are drawn today. */
  regionCode?: string;
  regionName?: string;
  /** ISO 3166-1 alpha-2, e.g. "US". */
  countryCode: string;
  lat: number;
  lng: number;
  iata?: string;
}

export interface AtlasStop {
  stopId: string;
  place: AtlasPlace;
}

export type AtlasLegMode = "flight" | "drive" | "train" | "boat" | "other";

export interface AtlasLeg {
  legId: string;
  mode: AtlasLegMode;
  from: AtlasPlace;
  to: AtlasPlace;
  /** Flights only. */
  airline?: string;
  flightNumber?: string;
}

export type AtlasDatePrecision = "day" | "month" | "year";

export interface AtlasTrip {
  tripId: string;
  title: string;
  /** "2018" | "2018-07" | "2018-07-14", cut to datePrecision. */
  start: string;
  end?: string;
  datePrecision: AtlasDatePrecision;
  /** Empty = untagged. [ATLAS_SOLO_CIRCLE_ID] = solo. */
  circleIds: string[];
  personIds: string[];
  stops: AtlasStop[];
  legs: AtlasLeg[];
  rating?: number;
  notes?: string;
  coverKey?: string;
  /** Short-lived signed GET url for coverKey, filled in on read. */
  coverUrl?: string;
  /** Optional link to a Group Expenses trip. */
  expenseTripId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AtlasCircle {
  circleId: string;
  name: string;
  color: AtlasCircleColor;
  sortOrder: number;
  builtIn?: boolean;
  createdAt: string;
}

export interface AtlasPerson {
  personId: string;
  name: string;
  circleIds: string[];
  createdAt: string;
}

export interface AtlasWish {
  wishId: string;
  place: AtlasPlace;
  circleIds: string[];
  note?: string;
  fulfilledByTripId?: string;
  createdAt: string;
}

export interface AtlasProfile {
  homePlace?: AtlasPlace;
  units: "mi" | "km";
  lastLens?: AtlasLens;
}

export interface AtlasSnapshot {
  profile: AtlasProfile;
  circles: AtlasCircle[];
  people: AtlasPerson[];
  trips: AtlasTrip[];
  wishes: AtlasWish[];
}

/** A place search hit; resolve it with GET /atlas/places/{providerId}. */
export interface AtlasPlaceSuggestion {
  providerId: string;
  kind: AtlasPlaceKind;
  title: string;
  subtitle?: string;
  /** Airports are complete already and need no resolve call. */
  place?: AtlasPlace;
}

/** A line of quick-add text parsed into a draft trip. */
export interface AtlasDraftTrip {
  line: string;
  title: string;
  start?: string;
  datePrecision?: AtlasDatePrecision;
  circleIds: string[];
  places: AtlasPlace[];
  /** Place names the parser found but could not resolve. */
  unresolved: string[];
}

// ------------------------------------------------------------------ lenses

export type AtlasMode = "footprint" | "flights";

export interface AtlasLens {
  mode: AtlasMode;
  /** "all" or a circle id. */
  circle: string;
  /** Inclusive year bounds. */
  fromYear?: number;
  toYear?: number;
}

export const DEFAULT_ATLAS_LENS: AtlasLens = { mode: "footprint", circle: "all" };

export const tripYear = (trip: Pick<AtlasTrip, "start">): number =>
  Number(trip.start.slice(0, 4));

export const tripMatchesLens = (trip: AtlasTrip, lens: AtlasLens): boolean => {
  if (lens.circle !== "all" && !trip.circleIds.includes(lens.circle)) {
    return false;
  }
  const year = tripYear(trip);
  if (lens.fromYear !== undefined && year < lens.fromYear) return false;
  if (lens.toYear !== undefined && year > lens.toYear) return false;
  if (lens.mode === "flights" && !trip.legs.some((l) => l.mode === "flight")) {
    return false;
  }
  return true;
};

/** Newest first; trips with the same start keep title order. */
export const sortTrips = (trips: AtlasTrip[]): AtlasTrip[] =>
  [...trips].sort(
    (a, b) => b.start.localeCompare(a.start) || a.title.localeCompare(b.title)
  );

export const applyLens = (trips: AtlasTrip[], lens: AtlasLens): AtlasTrip[] =>
  sortTrips(trips.filter((t) => tripMatchesLens(t, lens)));

// ------------------------------------------------------------------ geography

const EARTH_RADIUS_MI = 3958.8;
export const EARTH_CIRCUMFERENCE_MI = 24901;
export const MI_PER_KM = 0.621371;

export const greatCircleMiles = (
  a: Pick<AtlasPlace, "lat" | "lng">,
  b: Pick<AtlasPlace, "lat" | "lng">
): number => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
};

export const continentOf = (countryCode: string): AtlasContinent | undefined =>
  ATLAS_COUNTRIES[countryCode.toUpperCase()]?.continent;

export const countryName = (countryCode: string): string =>
  ATLAS_COUNTRIES[countryCode.toUpperCase()]?.name ?? countryCode;

/** "US-CA" -> "California"; other regions fall back to the code. */
export const regionName = (regionCode: string): string => {
  const [country, sub] = regionCode.split("-");
  if (country === "US" && sub && ATLAS_US_STATES[sub]) return ATLAS_US_STATES[sub];
  return regionCode;
};

/** Every place a trip touched: its stops plus both ends of every leg. */
export const tripPlaces = (trip: AtlasTrip): AtlasPlace[] => [
  ...trip.stops.map((s) => s.place),
  ...trip.legs.flatMap((l) => [l.from, l.to])
];

/** City key: locality (or name) within a country, case-insensitive. */
const cityKey = (p: AtlasPlace): string | undefined => {
  if (p.kind === "country" || p.kind === "region") return undefined;
  const city = (p.locality || p.name).trim().toLowerCase();
  return city ? `${p.countryCode}|${city}` : undefined;
};

// ------------------------------------------------------------------ stats

export interface AtlasRouteStat {
  /** Alphabetical pair, e.g. "JFK-SFO". */
  route: string;
  count: number;
}

export interface AtlasStats {
  trips: number;
  countries: number;
  usStates: number;
  cities: number;
  continents: number;
  /** Visit count per country / region code, for map fill intensity. */
  countryVisits: Record<string, number>;
  regionVisits: Record<string, number>;
  flights: number;
  flightMiles: number;
  airports: number;
  topRoute?: AtlasRouteStat;
  topAirline?: { airline: string; count: number };
  firstYear?: number;
  lastYear?: number;
}

/**
 * Stats for an already-filtered set of trips (see applyLens). Counts are
 * per trip: a country visited on three trips has countryVisits 3.
 */
export const computeStats = (trips: AtlasTrip[]): AtlasStats => {
  const countryVisits: Record<string, number> = {};
  const regionVisits: Record<string, number> = {};
  const cities = new Set<string>();
  const continents = new Set<string>();
  const airports = new Set<string>();
  const routes: Record<string, number> = {};
  const airlines: Record<string, number> = {};
  let flights = 0;
  let flightMiles = 0;
  let firstYear: number | undefined;
  let lastYear: number | undefined;

  for (const trip of trips) {
    const year = tripYear(trip);
    if (Number.isFinite(year)) {
      firstYear = firstYear === undefined ? year : Math.min(firstYear, year);
      lastYear = lastYear === undefined ? year : Math.max(lastYear, year);
    }
    const tripCountries = new Set<string>();
    const tripRegions = new Set<string>();
    for (const place of tripPlaces(trip)) {
      if (!place.countryCode) continue;
      tripCountries.add(place.countryCode);
      if (place.regionCode) tripRegions.add(place.regionCode);
      const key = cityKey(place);
      if (key) cities.add(key);
      const continent = continentOf(place.countryCode);
      if (continent) continents.add(continent);
    }
    tripCountries.forEach((c) => (countryVisits[c] = (countryVisits[c] ?? 0) + 1));
    tripRegions.forEach((r) => (regionVisits[r] = (regionVisits[r] ?? 0) + 1));

    for (const leg of trip.legs) {
      if (leg.mode !== "flight") continue;
      flights += 1;
      flightMiles += greatCircleMiles(leg.from, leg.to);
      const a = leg.from.iata ?? leg.from.name;
      const b = leg.to.iata ?? leg.to.name;
      if (leg.from.iata) airports.add(leg.from.iata);
      if (leg.to.iata) airports.add(leg.to.iata);
      const route = [a, b].sort().join("-");
      routes[route] = (routes[route] ?? 0) + 1;
      if (leg.airline) airlines[leg.airline] = (airlines[leg.airline] ?? 0) + 1;
    }
  }

  const top = <T extends string>(counts: Record<T, number>) =>
    (Object.entries(counts) as [T, number][]).sort(
      (x, y) => y[1] - x[1] || x[0].localeCompare(y[0])
    )[0];
  const topRoute = top(routes);
  const topAirline = top(airlines);

  return {
    trips: trips.length,
    countries: Object.keys(countryVisits).length,
    usStates: Object.keys(regionVisits).filter((r) => r.startsWith("US-")).length,
    cities: cities.size,
    continents: continents.size,
    countryVisits,
    regionVisits,
    flights,
    flightMiles: Math.round(flightMiles),
    airports: airports.size,
    topRoute: topRoute ? { route: topRoute[0], count: topRoute[1] } : undefined,
    topAirline: topAirline
      ? { airline: topAirline[0], count: topAirline[1] }
      : undefined,
    firstYear,
    lastYear
  };
};

/** Trips per circle id (a trip in two circles counts for both). */
export const tripsByCircle = (trips: AtlasTrip[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const trip of trips) {
    for (const id of trip.circleIds) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
};

/**
 * Places this trip visits for the first time, given every other trip.
 * Drives the "New country" moment after a save.
 */
export interface AtlasFirsts {
  countries: string[];
  regions: string[];
}

export const firstsForTrip = (trip: AtlasTrip, others: AtlasTrip[]): AtlasFirsts => {
  const seenCountries = new Set<string>();
  const seenRegions = new Set<string>();
  for (const other of others) {
    if (other.tripId === trip.tripId) continue;
    for (const p of tripPlaces(other)) {
      seenCountries.add(p.countryCode);
      if (p.regionCode) seenRegions.add(p.regionCode);
    }
  }
  const countries = new Set<string>();
  const regions = new Set<string>();
  for (const p of tripPlaces(trip)) {
    if (!seenCountries.has(p.countryCode)) countries.add(p.countryCode);
    if (p.regionCode && !seenRegions.has(p.regionCode)) regions.add(p.regionCode);
  }
  return { countries: [...countries], regions: [...regions] };
};

// ------------------------------------------------------------------ dates

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

/** "2025-06-12".."2025-06-15" -> "Jun 12 to 15, 2025"; "2018-07" -> "Jul 2018". */
export const formatTripDates = (trip: Pick<AtlasTrip, "start" | "end" | "datePrecision">): string => {
  const [y, m, d] = trip.start.split("-");
  const month = m ? MONTHS[Number(m) - 1] : undefined;
  if (trip.datePrecision === "year" || !month) return y;
  if (trip.datePrecision === "month" || !d) return `${month} ${y}`;
  const startDay = Number(d);
  if (!trip.end || trip.end === trip.start) return `${month} ${startDay}, ${y}`;
  const [ey, em, ed] = trip.end.split("-");
  const endMonth = em ? MONTHS[Number(em) - 1] : month;
  if (ey !== y) return `${month} ${startDay}, ${y} to ${endMonth} ${Number(ed)}, ${ey}`;
  if (em !== m) return `${month} ${startDay} to ${endMonth} ${Number(ed)}, ${y}`;
  return `${month} ${startDay} to ${Number(ed)}, ${y}`;
};

/** Inclusive day count for day-precision trips, else undefined. */
export const tripDays = (trip: Pick<AtlasTrip, "start" | "end" | "datePrecision">): number | undefined => {
  if (trip.datePrecision !== "day" || trip.start.length !== 10) return undefined;
  const end = trip.end && trip.end.length === 10 ? trip.end : trip.start;
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${trip.start}T00:00:00Z`);
  return Math.round(ms / 86400000) + 1;
};
