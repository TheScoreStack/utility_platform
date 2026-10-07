import { useMemo, useState } from "react";
import clsx from "clsx";
import { formatTripDates, tripDays } from "../../../types";
import { TODAY } from "./editorUtils";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const FIRST_YEAR = 1940;

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * One calendar for the whole trip: the first click sets the start, the second
 * sets the end (clicking earlier than the start restarts). A one-day trip is
 * just one click. Month and year selects make jumping back to 2014 quick.
 */
export const DateRangeCalendar = ({
  start,
  end,
  onChange
}: {
  start?: string;
  end?: string;
  onChange: (range: { start: string; end?: string }) => void;
}) => {
  const today = new Date(`${TODAY}T00:00:00`);
  const initial = start ? new Date(`${start}T00:00:00`) : today;
  const [view, setView] = useState({ y: initial.getFullYear(), m: initial.getMonth() });
  // True after the first click of a new range, until the end is picked.
  const [pickingEnd, setPickingEnd] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1).getDay();
    const days = new Date(view.y, view.m + 1, 0).getDate();
    return [
      ...Array.from({ length: first }, () => null),
      ...Array.from({ length: days }, (_, i) => iso(view.y, view.m, i + 1))
    ];
  }, [view]);

  const rangeEnd = pickingEnd && hover && start && hover >= start ? hover : end;
  const inRange = (d: string) => Boolean(start && rangeEnd && d > start && d < rangeEnd);

  const pick = (d: string) => {
    if (!pickingEnd || !start || d < start) {
      onChange({ start: d });
      setPickingEnd(true);
      return;
    }
    onChange({ start, end: d === start ? undefined : d });
    setPickingEnd(false);
  };

  const shift = (by: number) =>
    setView(({ y, m }) => {
      const next = new Date(y, m + by, 1);
      return { y: next.getFullYear(), m: next.getMonth() };
    });
  const atMax = view.y === today.getFullYear() && view.m === today.getMonth();
  const days = start ? tripDays({ start, end, datePrecision: "day" }) : undefined;

  return (
    <div className="atlas-cal">
      <div className="atlas-cal__head">
        <button type="button" className="atlas-cal__nav" aria-label="Previous month" disabled={view.y === FIRST_YEAR && view.m === 0} onClick={() => shift(-1)}>‹</button>
        <select aria-label="Month" value={view.m} onChange={(e) => setView((v) => ({ ...v, m: Number(e.target.value) }))}>
          {MONTHS.map((name, i) => (
            <option key={name} value={i} disabled={view.y === today.getFullYear() && i > today.getMonth()}>{name}</option>
          ))}
        </select>
        <select aria-label="Year" value={view.y} onChange={(e) => {
          const y = Number(e.target.value);
          setView((v) => ({ y, m: y === today.getFullYear() ? Math.min(v.m, today.getMonth()) : v.m }));
        }}>
          {Array.from({ length: today.getFullYear() - FIRST_YEAR + 1 }, (_, i) => today.getFullYear() - i).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button type="button" className="atlas-cal__nav" aria-label="Next month" disabled={atMax} onClick={() => shift(1)}>›</button>
      </div>
      <div className="atlas-cal__grid" role="grid" onMouseLeave={() => setHover(null)}>
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="atlas-cal__weekday" aria-hidden="true">{w}</span>
        ))}
        {cells.map((d, i) =>
          d ? (
            <button
              key={d}
              type="button"
              className={clsx(
                "atlas-cal__day",
                d === start && "atlas-cal__day--start",
                d === rangeEnd && "atlas-cal__day--end",
                inRange(d) && "atlas-cal__day--between",
                d === TODAY && "atlas-cal__day--today"
              )}
              disabled={d > TODAY}
              aria-pressed={d === start || d === rangeEnd}
              aria-label={formatTripDates({ start: d, datePrecision: "day" })}
              onMouseEnter={() => setHover(d)}
              onClick={() => pick(d)}
            >
              {Number(d.slice(8))}
            </button>
          ) : (
            <span key={`blank-${i}`} />
          )
        )}
      </div>
      <p className="atlas-cal__summary" aria-live="polite">
        {!start
          ? "Tap the first day of the trip"
          : pickingEnd
            ? `${formatTripDates({ start, datePrecision: "day" })} · now tap the last day (or the same day for a day trip)`
            : `${formatTripDates({ start, end, datePrecision: "day" })}${days && days > 1 ? ` · ${days} days` : " · day trip"}`}
      </p>
    </div>
  );
};
