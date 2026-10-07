import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ATLAS_CONTINENTS,
  applyLens,
  computeStats,
  continentOf,
  countryName,
  tripsByCircle,
  EARTH_CIRCUMFERENCE_MI,
  type AtlasContinent
} from "../types";
import { useAtlasSnapshot } from "../modules/atlas/useAtlas";
import { ALL_HEX, CIRCLE_HEX, circleHex, useLens } from "../modules/atlas/lens";
import { CircleChip } from "../components/atlas/Controls";
import { Counter } from "../components/atlas/Counter";

const Progress = ({ label, value, total, color }: { label: string; value: number; total: number; color: string }) => (
  <div className="atlas-progress">
    <div className="atlas-progress__row">
      <span className="atlas-progress__label">{label}</span>
      <span className="muted">
        {value} of {total}
      </span>
    </div>
    <div className="atlas-progress__track">
      <div className="atlas-progress__fill" style={{ width: `${Math.max(2, (value / total) * 100)}%`, background: color }} />
    </div>
  </div>
);

const AtlasStatsPage = () => {
  const { data: snapshot } = useAtlasSnapshot();
  const { lens, update, search } = useLens();

  const lensTrips = useMemo(() => (snapshot ? applyLens(snapshot.trips, { ...lens, mode: "footprint" }) : []), [snapshot, lens]);
  const stats = useMemo(() => computeStats(lensTrips), [lensTrips]);
  const byCircle = useMemo(() => (snapshot ? tripsByCircle(snapshot.trips) : {}), [snapshot]);

  const byContinent = useMemo(() => {
    const groups: Partial<Record<AtlasContinent, string[]>> = {};
    for (const code of Object.keys(stats.countryVisits)) {
      const c = continentOf(code);
      if (c) (groups[c] ??= []).push(code);
    }
    return groups;
  }, [stats]);

  const byYear = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of lensTrips) counts[t.start.slice(0, 4)] = (counts[t.start.slice(0, 4)] ?? 0) + 1;
    const years = Object.keys(counts).map(Number);
    if (!years.length) return [];
    // Every year in the span, so quiet years read as gaps, not as nothing.
    const first = Math.min(...years);
    const last = Math.max(...years);
    return Array.from({ length: last - first + 1 }, (_, i) => {
      const year = String(first + i);
      return [year, counts[year] ?? 0] as [string, number];
    });
  }, [lensTrips]);

  if (!snapshot) return <div className="atlas-stats skel" style={{ height: 480 }} />;
  const color = lens.circle === "all" ? ALL_HEX : circleHex(snapshot.circles, lens.circle);
  const maxCircle = Math.max(1, ...Object.values(byCircle));
  const maxYear = Math.max(1, ...byYear.map(([, n]) => n));
  const topCountries = Object.entries(stats.countryVisits)
    .sort((a, b) => b[1] - a[1] || countryName(a[0]).localeCompare(countryName(b[0])))
    .slice(0, 5);

  return (
    <div className="atlas-stats">
      <div className="atlas-detail__top">
        <Link to={`/atlas${search ? `?${search}` : ""}`} className="atlas-link">← Map</Link>
      </div>
      <h1 className="atlas-title">Your atlas</h1>
      <div className="atlas-chips">
        <CircleChip active={lens.circle === "all"} onClick={() => update({ circle: "all" })} />
        {snapshot.circles.map((c) => (
          <CircleChip key={c.circleId} circle={c} active={lens.circle === c.circleId} onClick={() => update({ circle: c.circleId })} />
        ))}
      </div>

      <div className="atlas-stats__grid">
        <section className="atlas-card">
          <h2 className="atlas-eyebrow">Collection</h2>
          <Progress label="Countries" value={stats.countries} total={195} color={color} />
          <Progress label="US states" value={stats.usStates} total={50} color={color} />
          <Progress label="Continents" value={stats.continents} total={7} color={color} />
          <div className="atlas-counters atlas-counters--inline">
            <Counter value={stats.cities} label="cities" />
            <Counter value={stats.trips} label="trips" />
            {stats.firstYear && <Counter value={stats.firstYear} label="first trip" format={(n) => String(n)} />}
          </div>
        </section>

        <section className="atlas-card">
          <h2 className="atlas-eyebrow">Trips by circle</h2>
          <ul className="atlas-bars">
            {snapshot.circles.map((c) => (
              <li key={c.circleId} className="atlas-bars__row">
                <span className="atlas-bars__label">
                  <span className="atlas-chip__dot" style={{ background: CIRCLE_HEX[c.color] }} />
                  {c.name}
                </span>
                <span className="atlas-bars__track">
                  <span className="atlas-bars__fill" style={{ width: `${((byCircle[c.circleId] ?? 0) / maxCircle) * 100}%`, background: CIRCLE_HEX[c.color] }} />
                </span>
                <span className="atlas-bars__value">{byCircle[c.circleId] ?? 0}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="atlas-card">
          <h2 className="atlas-eyebrow">Flights</h2>
          {stats.flights ? (
            <>
              <p className="atlas-big">{stats.flightMiles.toLocaleString()} mi</p>
              <p className="muted">
                {stats.flights} flight{stats.flights === 1 ? "" : "s"} · {(stats.flightMiles / EARTH_CIRCUMFERENCE_MI).toFixed(1)}× around Earth · {stats.airports} airports
              </p>
              {stats.topRoute && (
                <p className="muted">
                  Top route: {stats.topRoute.route.replace("-", " ↔ ")}, {stats.topRoute.count}×
                </p>
              )}
              {stats.topAirline && (
                <p className="muted">
                  Favorite airline: {stats.topAirline.airline} ({stats.topAirline.count})
                </p>
              )}
            </>
          ) : (
            <p className="muted">Add flights to your trips to see miles flown.</p>
          )}
        </section>

        <section className="atlas-card">
          <h2 className="atlas-eyebrow">Trips by year</h2>
          {byYear.length ? (
            <div className="atlas-years-chart" role="img" aria-label="Trips per year">
              {byYear.map(([year, n]) => (
                <div key={year} className="atlas-years-chart__col" title={`${year}: ${n} trips`}>
                  <span className="atlas-years-chart__n">{n || ""}</span>
                  <span className="atlas-years-chart__bar" style={{ height: `${(n / maxYear) * 100}%`, background: color }} />
                  <span className="atlas-years-chart__year">{year.slice(2)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No trips yet.</p>
          )}
        </section>

        <section className="atlas-card">
          <h2 className="atlas-eyebrow">Most visited</h2>
          <ol className="atlas-ranked">
            {topCountries.map(([code, n]) => (
              <li key={code}>
                <span>{countryName(code)}</span>
                <span className="muted">{n} trip{n > 1 ? "s" : ""}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="atlas-card">
          <h2 className="atlas-eyebrow">Continents</h2>
          <ul className="atlas-ranked">
            {(Object.keys(ATLAS_CONTINENTS) as AtlasContinent[])
              .filter((c) => c !== "AN" || byContinent.AN)
              .map((c) => (
                <li key={c} className={byContinent[c] ? "" : "atlas-ranked--empty"}>
                  <span>{ATLAS_CONTINENTS[c]}</span>
                  <span className="muted">{byContinent[c]?.length ?? 0}</span>
                </li>
              ))}
          </ul>
        </section>
      </div>
    </div>
  );
};

export default AtlasStatsPage;
