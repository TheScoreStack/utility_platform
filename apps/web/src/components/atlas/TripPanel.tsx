import { useMemo } from "react";
import { Link } from "react-router-dom";
import { countryName, formatTripDates, regionName, type AtlasSnapshot, type AtlasTrip } from "../../types";
import { tripHex } from "../../modules/atlas/lens";
import { circleNames, summarizeTrip } from "../../modules/atlas/format";

/** The map's side list: trips in the current lens, grouped by year. */
export const TripPanel = ({
  trips,
  snapshot,
  country,
  onClearCountry,
  onFly
}: {
  trips: AtlasTrip[];
  snapshot: AtlasSnapshot;
  country?: string;
  onClearCountry: () => void;
  onFly: (trip: AtlasTrip) => void;
}) => {
  const byYear = useMemo(() => {
    const groups: { year: string; trips: AtlasTrip[] }[] = [];
    for (const t of trips) {
      const year = t.start.slice(0, 4);
      const last = groups[groups.length - 1];
      if (last?.year === year) last.trips.push(t);
      else groups.push({ year, trips: [t] });
    }
    return groups;
  }, [trips]);

  return (
    <>
      <div className="atlas-panel__head">
        <h2 className="atlas-panel__title">Trips</h2>
        <span className="muted">{trips.length}</span>
      </div>
      {country && (
        <button type="button" className="atlas-filter-pill" onClick={onClearCountry}>
          {country.includes("-") ? regionName(country) : countryName(country)} ✕
        </button>
      )}
      {!trips.length && <p className="muted atlas-panel__empty">No trips in this view yet.</p>}
      {byYear.map((group) => (
        <div key={group.year} className="atlas-year">
          <p className="atlas-eyebrow">{group.year}</p>
          <ul className="atlas-trips">
            {group.trips.map((t) => (
              <li key={t.tripId}>
                <Link
                  to={`/atlas/trips/${t.tripId}`}
                  className="atlas-trip"
                  style={{ ["--trip" as string]: tripHex(snapshot.circles, t.circleIds) }}
                  onMouseEnter={() => onFly(t)}
                  onFocus={() => onFly(t)}
                >
                  {t.coverUrl ? (
                    <img className="atlas-trip__thumb" src={t.coverUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="atlas-trip__bar" aria-hidden="true" />
                  )}
                  <span className="atlas-trip__text">
                    <span className="atlas-trip__title">{t.title}</span>
                    <span className="atlas-trip__sub">
                      {[
                        formatTripDates(t).replace(/,? \d{4}$/, "").replace(/^\d{4}$/, "") || null,
                        circleNames(snapshot, t.circleIds),
                        summarizeTrip(t)
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
};
