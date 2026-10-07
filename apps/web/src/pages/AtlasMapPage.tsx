import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import {
  applyLens,
  computeStats,
  countryName,
  firstsForTrip,
  formatTripDates,
  regionName,
  tripPlaces,
  tripsByCircle,
  EARTH_CIRCUMFERENCE_MI,
  type AtlasPlace,
  type AtlasSnapshot,
  type AtlasTrip
} from "../types";
import { useAtlasSnapshot, useUpdateAtlasProfile, useWishMutations } from "../modules/atlas/useAtlas";
import { useAtlasGeo } from "../modules/atlas/geo";
import { ALL_HEX, circleHex, tripHex, useLens, type AtlasShow } from "../modules/atlas/lens";
import { WorldMap, type MapArc, type MapPin, type WorldMapHandle } from "../components/atlas/WorldMap";
import { CircleChip, Counter, PlaceSearch, Segmented } from "../components/atlas/AtlasParts";
import { useConfirm } from "../components/ConfirmDialog";

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
  const years = useMemo(() => {
    const ys = trips.map((t) => Number(t.start.slice(0, 4))).filter(Number.isFinite);
    return ys.length ? { min: Math.min(...ys), max: Math.max(...ys) } : undefined;
  }, [trips]);

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
      <aside className="atlas-controls" aria-label="Map lens">
        <div className="atlas-controls__head">
          <h1 className="atlas-title">Atlas</h1>
          <p className="atlas-sub">
            {allStats.countries} countries · {trips.length} trips
          </p>
        </div>

        <Segmented
          label="Map mode"
          value={lens.mode}
          options={[
            { value: "footprint", label: "Footprint" },
            { value: "flights", label: "Flights" }
          ]}
          onChange={(mode) => update({ mode })}
        />
        <Segmented<AtlasShow>
          label="Show"
          value={show}
          options={[
            { value: "been", label: "Been" },
            { value: "want", label: "Want to go" }
          ]}
          onChange={(value) => update({ show: value })}
        />

        <div className="atlas-controls__group">
          <p className="atlas-eyebrow">Circles</p>
          <div className="atlas-chips">
            <CircleChip active={lens.circle === "all"} count={trips.length} onClick={() => update({ circle: "all" })} />
            {circles.map((c) => (
              <CircleChip
                key={c.circleId}
                circle={c}
                active={lens.circle === c.circleId}
                count={circleCounts[c.circleId] ?? 0}
                onClick={() => update({ circle: lens.circle === c.circleId ? "all" : c.circleId })}
              />
            ))}
          </div>
          <Link to="/atlas/circles" className="atlas-link">
            Manage circles
          </Link>
        </div>

        {years && years.max > years.min && (
          <div className="atlas-controls__group">
            <p className="atlas-eyebrow">Years</p>
            <div className="atlas-years">
              <select
                aria-label="From year"
                value={lens.fromYear ?? years.min}
                onChange={(e) => update({ from: Number(e.target.value) === years.min ? undefined : e.target.value })}
              >
                {range(years.min, years.max).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <span className="muted">to</span>
              <select
                aria-label="To year"
                value={lens.toYear ?? years.max}
                onChange={(e) => update({ to: Number(e.target.value) === years.max ? undefined : e.target.value })}
              >
                {range(years.min, years.max).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="atlas-controls__actions">
          <button type="button" className="primary" onClick={() => navigate("/atlas/new")}>
            + Add trip
          </button>
          <div className="atlas-controls__links">
            <Link to={`/atlas/stats${window.location.search}`} className="atlas-link">Stats</Link>
            <Link to="/atlas/quick-add" className="atlas-link">Quick add</Link>
          </div>
        </div>
      </aside>

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

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const TripPanel = ({
  trips,
  snapshot,
  country,
  onClearCountry,
  onFly
}: {
  trips: AtlasTrip[];
  snapshot: Snapshot;
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

const circleNames = (snapshot: Snapshot, ids: string[]) =>
  ids
    .map((id) => snapshot.circles.find((c) => c.circleId === id)?.name)
    .filter(Boolean)
    .join(", ");

const summarizeTrip = (t: AtlasTrip) => {
  const flights = t.legs.filter((l) => l.mode === "flight").length;
  const parts = [`${t.stops.length || 1} ${t.stops.length === 1 ? "stop" : "stops"}`];
  if (flights) parts.push(`${flights} flight${flights > 1 ? "s" : ""}`);
  return parts.join(", ");
};

const WishPanel = ({
  snapshot,
  circleFilter,
  onFly
}: {
  snapshot: Snapshot;
  circleFilter: string;
  onFly: (place: AtlasPlace) => void;
}) => {
  const { create, remove } = useWishMutations();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [circleIds, setCircleIds] = useState<string[]>(
    circleFilter !== "all" ? [circleFilter] : []
  );
  const open = snapshot.wishes.filter(
    (w) => !w.fulfilledByTripId && (circleFilter === "all" || w.circleIds.includes(circleFilter))
  );
  const done = snapshot.wishes.filter((w) => w.fulfilledByTripId);

  return (
    <>
      <div className="atlas-panel__head">
        <h2 className="atlas-panel__title">Want to go</h2>
        <span className="muted">{open.length}</span>
      </div>
      <div className="atlas-wish-add">
        <PlaceSearch
          placeholder="Add a place to the wishlist"
          onPick={(place) => create.mutate({ place, circleIds })}
        />
        <div className="atlas-chips atlas-chips--small">
          {snapshot.circles.map((c) => (
            <CircleChip
              key={c.circleId}
              circle={c}
              active={circleIds.includes(c.circleId)}
              onClick={() =>
                setCircleIds((ids) =>
                  ids.includes(c.circleId) ? ids.filter((i) => i !== c.circleId) : [...ids, c.circleId]
                )
              }
            />
          ))}
        </div>
      </div>
      <ul className="atlas-trips">
        {open.map((w) => (
          <li key={w.wishId} className="atlas-wish">
            <button type="button" className="atlas-wish__main" onClick={() => onFly(w.place)}>
              <span className="atlas-wish__pin" style={{ borderColor: w.circleIds.length ? circleHex(snapshot.circles, w.circleIds[0]) : ALL_HEX }} />
              <span className="atlas-trip__text">
                <span className="atlas-trip__title">{w.place.name}</span>
                <span className="atlas-trip__sub">
                  {[countryName(w.place.countryCode), circleNames(snapshot, w.circleIds) && `with ${circleNames(snapshot, w.circleIds)}`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </button>
            <div className="atlas-wish__actions">
              <button type="button" className="atlas-link" onClick={() => navigate(`/atlas/new?wish=${w.wishId}`)}>
                Went!
              </button>
              <button
                type="button"
                className="atlas-link atlas-link--quiet"
                aria-label={`Remove ${w.place.name}`}
                onClick={async () => {
                  if (await confirm({ title: `Remove ${w.place.name}?`, confirmLabel: "Remove", tone: "danger" })) {
                    remove.mutate(w.wishId);
                  }
                }}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!open.length && <p className="muted atlas-panel__empty">Add the places you’re dreaming about.</p>}
      {done.length > 0 && (
        <p className="muted atlas-panel__foot">
          {done.length} wish{done.length > 1 ? "es" : ""} checked off
        </p>
      )}
    </>
  );
};

const HomeOnboarding = () => {
  const updateProfile = useUpdateAtlasProfile();
  return (
    <div className={clsx("atlas-onboard", updateProfile.isPending && "atlas-onboard--busy")}>
      <p className="atlas-onboard__title">Where’s home?</p>
      <p className="muted">We’ll start your map there. You can change it any time.</p>
      <PlaceSearch autoFocus onPick={(homePlace) => updateProfile.mutate({ homePlace })} />
    </div>
  );
};

export default AtlasMapPage;
