// Persistent trip switcher for the group-expenses module.
//
// Moving between trips used to mean going back to the trip list and in again.
// On a desktop there is room to keep the list beside the work, so switching
// costs one click. Below 1000px the same markup becomes a scrolling strip
// above the canvas.

import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { api } from "../../lib/api";
import type { TripListResponse } from "../../types";

/** Compact date for the rail. formatTripRange spells months out in full,
 *  which does not fit a 232px column. */
const railDates = (startDate?: string, endDate?: string): string => {
  const short = (iso?: string) => {
    if (!iso) return "";
    // Trip dates are plain YYYY-MM-DD; parsing them as UTC and formatting in
    // local time can slide a day, so read the parts directly.
    const [year, month, day] = iso.split("-").map(Number);
    if (!year || !month || !day) return "";
    const monthName = new Date(Date.UTC(year, month - 1, day)).toLocaleString(
      undefined,
      { month: "short", timeZone: "UTC" }
    );
    return `${day} ${monthName}`;
  };
  const from = short(startDate);
  const to = short(endDate);
  if (from && to) return from === to ? from : `${from} – ${to}`;
  return from || to || "";
};

export const TripsRail = () => {
  // Same query key as TripListPage, so the two share one fetch.
  const { data, isLoading } = useQuery({
    queryKey: ["trips"],
    queryFn: () => api.get<TripListResponse>("/trips")
  });

  const trips = data?.trips ?? [];
  const active = trips.filter((trip) => !trip.archivedAt);
  const archived = trips.filter((trip) => trip.archivedAt);

  return (
    <nav className="rail" aria-label="Trips">
      <h2 className="rail__title">Trips</h2>

      {isLoading && <p className="rail__empty">Loading…</p>}
      {!isLoading && active.length === 0 && (
        <p className="rail__empty">No trips yet.</p>
      )}

      {active.map((trip) => (
        <NavLink
          key={trip.tripId}
          to={`/group-expenses/trips/${trip.tripId}`}
          className={({ isActive }) =>
            isActive ? "rail__item rail__item--active" : "rail__item"
          }
          title={trip.name}
        >
          <span className="rail__name">{trip.name}</span>
          {railDates(trip.startDate, trip.endDate) && (
            <span className="rail__figure">
              {railDates(trip.startDate, trip.endDate)}
            </span>
          )}
        </NavLink>
      ))}

      {archived.length > 0 && (
        <NavLink to="/group-expenses/trips" className="rail__new">
          {archived.length} archived
        </NavLink>
      )}

      <NavLink to="/group-expenses/trips" className="rail__new">
        + New trip
      </NavLink>
    </nav>
  );
};

export default TripsRail;
