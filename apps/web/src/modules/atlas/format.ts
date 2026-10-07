import type { AtlasSnapshot, AtlasTrip } from "../../types";

/** "Wife, Barbershop" for a trip's or wish's circle ids. */
export const circleNames = (snapshot: AtlasSnapshot, ids: string[]) =>
  ids
    .map((id) => snapshot.circles.find((c) => c.circleId === id)?.name)
    .filter(Boolean)
    .join(", ");

/** "2 stops, 1 flight". */
export const summarizeTrip = (t: AtlasTrip) => {
  const flights = t.legs.filter((l) => l.mode === "flight").length;
  const parts = [`${t.stops.length || 1} ${t.stops.length === 1 ? "stop" : "stops"}`];
  if (flights) parts.push(`${flights} flight${flights > 1 ? "s" : ""}`);
  return parts.join(", ");
};
