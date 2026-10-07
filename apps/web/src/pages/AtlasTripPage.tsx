import { useEffect, useMemo, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  countryName,
  formatTripDates,
  greatCircleMiles,
  tripDays,
  tripPlaces
} from "../types";
import { useAtlasSnapshot, useDeleteTrip } from "../modules/atlas/useAtlas";
import { useAtlasGeo } from "../modules/atlas/geo";
import { CIRCLE_HEX, tripHex } from "../modules/atlas/lens";
import { WorldMap, type WorldMapHandle } from "../components/atlas/WorldMap";
import { Stars } from "../components/atlas/Controls";
import { useConfirm } from "../components/ConfirmDialog";

const LEG_LABEL = { flight: "Flight", drive: "Drive", train: "Train", boat: "Boat", other: "Travel" };

const AtlasTripPage = () => {
  const { tripId } = useParams();
  const { data: snapshot } = useAtlasSnapshot();
  const { geo } = useAtlasGeo();
  const deleteTrip = useDeleteTrip();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const mapRef = useRef<WorldMapHandle>(null);
  const trip = snapshot?.trips.find((t) => t.tripId === tripId);

  const places = useMemo(() => (trip ? tripPlaces(trip) : []), [trip]);
  useEffect(() => {
    if (!geo || !places.length) return;
    const timer = setTimeout(() => mapRef.current?.flyTo(places), 50);
    return () => clearTimeout(timer);
  }, [geo, places]);

  if (!snapshot) return <div className="atlas-detail skel" style={{ height: 480 }} />;
  if (!trip) {
    return (
      <div className="atlas-empty">
        <p className="atlas-empty__title">Trip not found</p>
        <Link to="/atlas" className="atlas-link">Back to the map</Link>
      </div>
    );
  }

  const color = tripHex(snapshot.circles, trip.circleIds);
  const circles = snapshot.circles.filter((c) => trip.circleIds.includes(c.circleId));
  const people = snapshot.people.filter((p) => trip.personIds.includes(p.personId));
  const days = tripDays(trip);
  const visits: Record<string, number> = {};
  const regions: Record<string, number> = {};
  for (const p of places) {
    visits[p.countryCode] = 1;
    if (p.regionCode) regions[p.regionCode] = 1;
  }
  const flightMiles = trip.legs
    .filter((l) => l.mode === "flight")
    .reduce((sum, l) => sum + greatCircleMiles(l.from, l.to), 0);

  return (
    <article className="atlas-detail">
      <div className="atlas-detail__top">
        <Link to="/atlas" className="atlas-link">← Map</Link>
        <div className="atlas-detail__actions">
          <Link to={`/atlas/trips/${trip.tripId}/edit`} className="atlas-link">Edit</Link>
          <button
            type="button"
            className="atlas-link atlas-link--danger"
            onClick={async () => {
              const ok = await confirm({
                title: `Delete "${trip.title}"?`,
                body: "It comes off your map. This can't be undone.",
                confirmLabel: "Delete trip",
                tone: "danger"
              });
              if (ok) {
                await deleteTrip.mutateAsync(trip.tripId);
                navigate("/atlas");
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>

      <header className="atlas-detail__hero" style={{ ["--trip" as string]: color }}>
        {trip.coverUrl ? (
          <img className="atlas-detail__cover" src={trip.coverUrl} alt="" />
        ) : (
          <div className="atlas-detail__cover atlas-detail__cover--empty" aria-hidden="true" />
        )}
        <div className="atlas-detail__heading">
          <h1 className="atlas-detail__title">{trip.title}</h1>
          <p className="atlas-detail__dates">
            {formatTripDates(trip)}
            {days && days > 1 ? ` · ${days} days` : ""}
          </p>
          <div className="atlas-detail__meta">
            {circles.map((c) => (
              <span key={c.circleId} className="atlas-chip atlas-chip--on atlas-chip--static" style={{ ["--chip" as string]: CIRCLE_HEX[c.color] }}>
                <span className="atlas-chip__dot" />
                {c.name}
              </span>
            ))}
            {people.map((p) => (
              <span key={p.personId} className="atlas-chip atlas-chip--static">{p.name}</span>
            ))}
            {trip.rating && <Stars value={trip.rating} />}
          </div>
        </div>
      </header>

      <div className="atlas-detail__grid">
        <div className="atlas-detail__map">
          {geo && (
            <WorldMap
              ref={mapRef}
              geo={geo}
              color={color}
              countryVisits={visits}
              regionVisits={regions}
              pins={trip.stops.map((s) => ({ key: s.stopId, place: s.place, color: "#f8fafc" }))}
              arcs={trip.legs.filter((l) => l.mode === "flight").map((l) => ({ key: l.legId, leg: l, color }))}
              ariaLabel={`Map of ${trip.title}`}
            />
          )}
        </div>

        <div className="atlas-detail__side">
          {trip.stops.length > 0 && (
            <section>
              <h2 className="atlas-eyebrow">Stops</h2>
              <ol className="atlas-stops atlas-stops--read">
                {trip.stops.map((s, i) => (
                  <li key={s.stopId} className="atlas-stop">
                    <span className="atlas-stop__num">{i + 1}</span>
                    <span className="atlas-stop__name">
                      {s.place.name}
                      <span className="muted"> {s.place.kind === "country" ? "" : countryName(s.place.countryCode)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {trip.legs.length > 0 && (
            <section>
              <h2 className="atlas-eyebrow">Travel</h2>
              <ul className="atlas-legs atlas-legs--read">
                {trip.legs.map((l) => (
                  <li key={l.legId} className="atlas-leg">
                    <span className="atlas-leg__mode">{LEG_LABEL[l.mode]}</span>
                    <span className="atlas-leg__route">
                      {l.from.iata ?? l.from.name} → {l.to.iata ?? l.to.name}
                      {l.airline && <span className="muted"> · {l.airline}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {flightMiles > 0 && (
                <p className="muted">{Math.round(flightMiles).toLocaleString()} miles flown</p>
              )}
            </section>
          )}
          {trip.notes && (
            <section>
              <h2 className="atlas-eyebrow">Notes</h2>
              <p className="atlas-detail__notes">{trip.notes}</p>
            </section>
          )}
        </div>
      </div>
    </article>
  );
};

export default AtlasTripPage;
