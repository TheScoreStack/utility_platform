import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AtlasSnapshot } from "../../types";
import { useLens, type AtlasShow } from "../../modules/atlas/lens";
import { CircleChip, Segmented } from "./Controls";
import { plural } from "../../modules/atlas/format";

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** The map's left rail: mode, been/want, circles, years, and actions. */
export const LensControls = ({
  snapshot,
  circleCounts,
  countryCount
}: {
  snapshot: AtlasSnapshot;
  circleCounts: Record<string, number>;
  countryCount: number;
}) => {
  const { lens, show, update } = useLens();
  const navigate = useNavigate();
  const { circles, trips } = snapshot;
  // On a phone the secondary controls fold away so the map is near the top.
  const [moreOpen, setMoreOpen] = useState(false);
  const yearsFiltered = lens.fromYear !== undefined || lens.toYear !== undefined;
  const years = useMemo(() => {
    const ys = trips.map((t) => Number(t.start.slice(0, 4))).filter(Number.isFinite);
    return ys.length ? { min: Math.min(...ys), max: Math.max(...ys) } : undefined;
  }, [trips]);

  return (
  <aside className="atlas-controls" aria-label="Map lens">
      <div className="atlas-controls__head">
        <div>
          <h1 className="atlas-title">Atlas</h1>
          <p className="atlas-sub">
            {plural(countryCount, "country", "countries")} · {plural(trips.length, "trip", "trips")}
          </p>
        </div>
        <button type="button" className="primary atlas-narrow-only" onClick={() => navigate("/atlas/new")}>
          + Add trip
        </button>
      </div>

      <div className="atlas-controls__modes">
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
      </div>

      <div className="atlas-controls__group">
        <p className="atlas-eyebrow atlas-wide-only">Circles</p>
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
        <Link to="/atlas/circles" className="atlas-link atlas-wide-only">
          Manage circles
        </Link>
      </div>

      <button
        type="button"
        className="atlas-more atlas-narrow-only"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen((v) => !v)}
      >
        {moreOpen ? "Fewer options" : yearsFiltered ? `Years ${lens.fromYear ?? years?.min}–${lens.toYear ?? years?.max} · more` : "Years, stats and more"}
      </button>
      <div className={moreOpen ? "atlas-controls__more atlas-controls__more--open" : "atlas-controls__more"}>

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
        <button type="button" className="primary atlas-wide-only" onClick={() => navigate("/atlas/new")}>
          + Add trip
        </button>
        <div className="atlas-controls__links">
          <Link to={`/atlas/stats${window.location.search}`} className="atlas-link">Stats</Link>
          <Link to="/atlas/quick-add" className="atlas-link">Quick add</Link>
          <Link to="/atlas/circles" className="atlas-link atlas-narrow-only">Manage circles</Link>
        </div>
      </div>
      </div>
    </aside>
  );
};
