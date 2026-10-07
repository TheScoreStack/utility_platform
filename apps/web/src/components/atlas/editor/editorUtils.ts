import {
  countryName,
  frequentPlaces,
  samePlace,
  type AtlasLeg,
  type AtlasPlace,
  type AtlasStop,
  type AtlasTrip
} from "../../../types";
import type { QuickPick } from "../PlaceSearch";

export const STEPS = ["Where", "When", "Who", "Details"] as const;
export type Precision = "day" | "month" | "year";
export const TODAY = new Date().toISOString().slice(0, 10);

export const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

export const suggestTitle = (stops: AtlasStop[]) => {
  const names = stops.map((s) => s.place.locality ?? s.place.name);
  const unique = names.filter((n, i) => names.indexOf(n) === i);
  if (!unique.length) return "";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} & ${unique[1]}`;
  return `${unique[0]}, ${unique[1]} & more`;
};

/** "Kyoto Japan", "Napa California", or "country" / "state" for whole areas. */
export const placeContext = (p: AtlasPlace) =>
  p.kind === "country"
    ? "country"
    : p.kind === "region"
      ? "state"
      : p.countryCode === "US"
        ? p.regionName ?? "United States"
        : countryName(p.countryCode);

export const move = <T,>(list: T[], i: number, by: number) => {
  const next = [...list];
  const [item] = next.splice(i, 1);
  next.splice(i + by, 0, item);
  return next;
};

const placeKey = (p: AtlasPlace) => p.iata ?? p.providerId;

/**
 * The leg back from the last one, when the trip doesn't already have it:
 * same mode and airline, ends swapped, no flight number.
 */
export const returnLegFor = (legs: AtlasLeg[]): Omit<AtlasLeg, "legId"> | undefined => {
  const last = legs[legs.length - 1];
  if (!last) return undefined;
  const hasReturn = legs.some(
    (l) => placeKey(l.from) === placeKey(last.to) && placeKey(l.to) === placeKey(last.from)
  );
  if (hasReturn) return undefined;
  return { mode: last.mode, from: last.to, to: last.from, airline: last.airline };
};

export const legEndLabel = (p: AtlasPlace) => p.iata ?? p.name;

/** What a place search can offer in one tap, given the rest of the atlas. */
export interface PickSources {
  /** Every trip except the one being edited. */
  otherTrips: AtlasTrip[];
  home?: AtlasPlace;
}

/** First occurrence of each place wins, so Home beats the same city later. */
const uniquePicks = (picks: QuickPick[]): QuickPick[] =>
  picks.filter((q, i) => picks.findIndex((o) => samePlace(o.place, q.place)) === i);

const homePick = (home: AtlasPlace | undefined): QuickPick[] =>
  home ? [{ place: home, label: `Home · ${home.name}`, home: true }] : [];

/** Stops: home, then the places you go most, minus what's already added. */
export const stopPicks = ({ otherTrips, home }: PickSources, stops: AtlasStop[]): QuickPick[] => {
  const taken = (p: AtlasPlace) => stops.some((s) => samePlace(s.place, p));
  return uniquePicks([
    ...homePick(home),
    ...frequentPlaces(otherTrips, "stops", 8).map((place) => ({ place }))
  ])
    .filter((q) => !taken(q.place))
    .slice(0, 6);
};

/**
 * Leg ends: your most-flown airports for flights; this trip's stops then
 * home for ground legs. Never offers the leg's other end.
 */
export const legEndPicks = (
  { otherTrips, home }: PickSources,
  mode: AtlasLeg["mode"],
  stops: AtlasStop[],
  otherEnd: AtlasPlace | null
): QuickPick[] => {
  const picks: QuickPick[] =
    mode === "flight"
      ? frequentPlaces(otherTrips, "airports", 8).map((place) => ({ place }))
      : [...stops.map((s) => ({ place: s.place, label: s.place.name })), ...homePick(home)];
  return uniquePicks(picks)
    .filter((q) => !otherEnd || !samePlace(q.place, otherEnd))
    .slice(0, 6);
};
