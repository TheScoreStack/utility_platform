import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AtlasSnapshot } from "../../types";
import { useLens, type AtlasShow } from "../../modules/atlas/lens";
import { CircleChip, Segmented } from "./Controls";

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
  const years = useMemo(() => {
    const ys = trips.map((t) => Number(t.start.slice(0, 4))).filter(Number.isFinite);
    return ys.length ? { min: Math.min(...ys), max: Math.max(...ys) } : undefined;
  }, [trips]);

  return (
  <aside className="atlas-controls" aria-label="Map lens">
      <div className="atlas-controls__head">
        <h1 className="atlas-title">Atlas</h1>
        <p className="atlas-sub">
          {countryCount} countries · {trips.length} trips
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
  );
};
