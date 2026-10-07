import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  applyLens,
  computeStats,
  countryName,
  firstsForTrip,
  regionName,
  tripPlaces,
  tripsByCircle,
  EARTH_CIRCUMFERENCE_MI,
  type AtlasPlace,
  type AtlasSnapshot
} from "../types";
import { useAtlasSnapshot } from "../modules/atlas/useAtlas";
import { useAtlasGeo } from "../modules/atlas/geo";
import { ALL_HEX, circleHex, tripHex, useLens } from "../modules/atlas/lens";
import { WorldMap, type MapArc, type MapPin, type WorldMapHandle } from "../components/atlas/WorldMap";
import { LensControls } from "../components/atlas/LensControls";
import { Counter } from "../components/atlas/Counter";
import { TripPanel } from "../components/atlas/TripPanel";
import { WishPanel } from "../components/atlas/WishPanel";
import { HomeOnboarding } from "../components/atlas/HomeOnboarding";

const AtlasMapPage = () => {
  const { data: snapshot, isLoading, error } = useAtlasSnapshot();
  const { geo, error: geoError } = useAtlasGeo();

  if (error || geoError) {
    return (
      <div className="atlas-empty">
        <p className="atlas-empty__title">Your atlas didn’t load</p>
        <p className="muted">{(error ?? geoError)?.message}</p>
      </div>
    );
  }
  if (isLoading || !snapshot || !geo) {
    return (
      <div className="atlas-layout atlas-layout--loading" aria-busy="true">
        <div className="atlas-loading-map skel" />
      </div>
    );
  }
  return <AtlasMap snapshot={snapshot} geo={geo} />;
};

type Snapshot = AtlasSnapshot;

const AtlasMap = ({ snapshot, geo }: { snapshot: Snapshot; geo: NonNullable<ReturnType<typeof useAtlasGeo>["geo"]> }) => {
  const { lens, show, country, update } = useLens();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const mapRef = useRef<WorldMapHandle>(null);
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);

  const { circles, trips, wishes, profile } = snapshot;
  const color = lens.circle === "all" ? ALL_HEX : circleHex(circles, lens.circle);
  const lensTrips = useMemo(() => applyLens(trips, lens), [trips, lens]);
  const stats = useMemo(() => computeStats(lensTrips), [lensTrips]);
  const allStats = useMemo(() => computeStats(trips), [trips]);
  const circleCounts = useMemo(() => tripsByCircle(trips), [trips]);

  // Trips shown in the side list: the lens, narrowed by a clicked country.
  const listTrips = useMemo(
    () =>
      country
        ? lensTrips.filter((t) =>
            tripPlaces(t).some((p) => p.countryCode === country || p.regionCode === country)
          )
        : lensTrips,
    [lensTrips, country]
  );

  const flights = lens.mode === "flights";
  const pins = useMemo<MapPin[]>(() => {
    if (flights || show === "want") return [];
    const seen = new Set<string>();
    const out: MapPin[] = [];
    for (const trip of lensTrips) {
      for (const stop of trip.stops) {
        const p = stop.place;
        if (p.kind === "country" || p.kind === "region") continue;
        const key = `${p.countryCode}|${(p.locality ?? p.name).toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, place: p, color: "#f8fafc" });
      }
    }
    return out;
  }, [lensTrips, flights, show]);

  const arcs = useMemo<MapArc[]>(() => {
    if (!flights) return [];
    return lensTrips.flatMap((t) =>
      t.legs
        .filter((l) => l.mode === "flight")
        .map((l) => ({
          key: `${t.tripId}-${l.legId}`,
          leg: l,
          color: lens.circle === "all" ? tripHex(circles, t.circleIds) : color
        }))
    );
  }, [lensTrips, flights, lens.circle, circles, color]);

  const airportPins = useMemo<MapPin[]>(() => {
    if (!flights) return [];
    const byCode = new Map<string, AtlasPlace>();
    for (const a of arcs) {
      for (const p of [a.leg.from, a.leg.to]) byCode.set(p.iata ?? p.providerId, p);
    }
    return [...byCode.entries()].map(([key, place]) => ({ key, place, color: "#f8fafc" }));
  }, [arcs, flights]);

  const wishPins = useMemo<MapPin[]>(
    () =>
      show === "want"
        ? wishes
            .filter((w) => !w.fulfilledByTripId)
            .filter((w) => lens.circle === "all" || w.circleIds.includes(lens.circle))
            .map((w) => ({
              key: w.wishId,
              place: w.place,
              color: w.circleIds.length ? circleHex(circles, w.circleIds[0]) : ALL_HEX
            }))
        : [],
    [show, wishes, lens.circle, circles]
  );

  // After a save, the editor sends us here with ?celebrate=<tripId>.
  const celebrateId = params.get("celebrate");
  const celebrated = useMemo(() => {
    const trip = celebrateId ? trips.find((t) => t.tripId === celebrateId) : undefined;
    if (!trip) return undefined;
    return { trip, firsts: firstsForTrip(trip, trips) };
  }, [celebrateId, trips]);
  useEffect(() => {
    if (!celebrated) return;
    const timer = setTimeout(() => mapRef.current?.flyTo(tripPlaces(celebrated.trip)), 250);
    const clear = setTimeout(() => {
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.delete("celebrate");
        return next;
      }, { replace: true });
    }, 7000);
    return () => {
      clearTimeout(timer);
      clearTimeout(clear);
    };
  }, [celebrated, setParams]);

  const hoverTrips = hover
    ? lensTrips.filter((t) =>
        tripPlaces(t).some((p) => p.countryCode === hover.code || p.regionCode === hover.code)
      )
    : [];
  const hoverName = hover
    ? hover.code.includes("-")
      ? regionName(hover.code)
      : countryName(hover.code)
    : "";

  const empty = trips.length === 0;

  return (
    <div className="atlas-layout">
      <LensControls snapshot={snapshot} circleCounts={circleCounts} countryCount={allStats.countries} />

      <section className="atlas-stage" aria-label="Map">
        <div className="atlas-counters" aria-live="polite">
          {flights ? (
            <>
              <Counter value={stats.flights} label="flights" />
              <Counter value={stats.flightMiles} label={profile.units === "km" ? "km" : "miles"} format={(n) => (profile.units === "km" ? Math.round(n / 0.621371) : n).toLocaleString()} />
              <Counter value={stats.airports} label="airports" />
              <Counter
                value={Math.round((stats.flightMiles / EARTH_CIRCUMFERENCE_MI) * 10)}
                label="× around Earth"
                format={(n) => (n / 10).toFixed(1)}
              />
            </>
          ) : (
            <>
              <Counter value={stats.countries} label="countries" />
              <Counter value={stats.usStates} label="states" />
              <Counter value={stats.cities} label="cities" />
              <Counter value={stats.trips} label="trips" />
            </>
          )}
        </div>

        <div className="atlas-map-wrap">
          <WorldMap
            ref={mapRef}
            geo={geo}
            color={color}
            countryVisits={stats.countryVisits}
            regionVisits={stats.regionVisits}
            homeCountry={profile.homePlace?.countryCode}
            pins={flights ? airportPins : pins}
            arcs={arcs}
            wishes={wishPins}
            muted={flights || show === "want"}
            selectedCountry={country}
            rippleCountries={celebrated?.firsts.countries}
            onCountryClick={(code) => update({ country: country === code ? undefined : code })}
            onCountryHover={(code, point) => setHover(code && point ? { code, ...point } : null)}
          />
          {hover && (
            <div className="atlas-hover" style={{ left: hover.x, top: hover.y }} role="status">
              <strong>{hoverName}</strong>
              <span>
                {hoverTrips.length
                  ? `${hoverTrips.length} trip${hoverTrips.length === 1 ? "" : "s"} · ${hoverTrips
                      .slice(0, 3)
                      .map((t) => t.start.slice(0, 4))
                      .filter((y, i, a) => a.indexOf(y) === i)
                      .join(", ")}`
                  : "Not yet"}
              </span>
            </div>
          )}
          <div className="atlas-map-tools">
            <button type="button" className="atlas-icon-btn" aria-label="Reset view" onClick={() => mapRef.current?.flyTo([])}>
              ⤢
            </button>
          </div>
          <div className="atlas-legend" aria-hidden="true">
            {flights ? (
              <span><i className="atlas-legend__arc" style={{ background: color }} /> Flights</span>
            ) : (
              <>
                <span><i className="atlas-legend__fill" style={{ background: color }} /> Been</span>
                <span><i className="atlas-legend__wish" /> Want to go</span>
              </>
            )}
          </div>
        </div>

        {celebrated && (
          <div className="atlas-celebrate" role="status">
            <strong>
              {celebrated.firsts.countries.length
                ? `New ${celebrated.firsts.countries.length > 1 ? "countries" : "country"}: ${celebrated.firsts.countries.map(countryName).join(", ")}`
                : celebrated.firsts.regions.some((r) => r.startsWith("US-"))
                  ? `New state: ${celebrated.firsts.regions.filter((r) => r.startsWith("US-")).map(regionName).join(", ")}`
                  : `${celebrated.trip.title} is on the map`}
            </strong>
            <span>
              {allStats.countries} countries · {allStats.usStates} states · {allStats.cities} cities
            </span>
          </div>
        )}

        {empty && !profile.homePlace && <HomeOnboarding />}
        {empty && profile.homePlace && (
          <div className="atlas-onboard atlas-onboard--soft">
            <p className="atlas-onboard__title">Your map starts here</p>
            <p className="muted">Log a trip you remember, or paste a list of places.</p>
            <div className="atlas-onboard__actions">
              <button type="button" className="primary" onClick={() => navigate("/atlas/new")}>Add a trip</button>
              <button type="button" className="secondary" onClick={() => navigate("/atlas/quick-add")}>Quick add</button>
            </div>
          </div>
        )}
      </section>

      <aside className="atlas-panel" aria-label={show === "want" ? "Wishlist" : "Trips"}>
        {show === "want" ? (
          <WishPanel snapshot={snapshot} circleFilter={lens.circle} onFly={(p) => mapRef.current?.flyTo([p])} />
        ) : (
          <TripPanel
            trips={listTrips}
            snapshot={snapshot}
            country={country}
            onClearCountry={() => update({ country: undefined })}
            onFly={(t) => mapRef.current?.flyTo(tripPlaces(t))}
          />
        )}
      </aside>
    </div>
  );
};


export default AtlasMapPage;
