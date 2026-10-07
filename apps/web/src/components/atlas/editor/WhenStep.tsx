import { Segmented } from "../Controls";
import { DateRangeCalendar } from "./DateRangeCalendar";
import { TODAY, type Precision } from "./editorUtils";

export const WhenStep = ({
  precision,
  start,
  end,
  onChange
}: {
  precision: Precision;
  start: string;
  end: string;
  onChange: (changes: { precision?: Precision; start?: string; end?: string }) => void;
}) => (
  <section className="atlas-step">
    <h1 className="atlas-step__q">When was it?</h1>
    <Segmented<Precision>
      label="Date precision"
      value={precision}
      options={[
        { value: "day", label: "Exact" },
        { value: "month", label: "Month" },
        { value: "year", label: "Year" }
      ]}
      onChange={(p) =>
        onChange({
          precision: p,
          start: p === "year" ? start.slice(0, 4) : p === "month" ? start.slice(0, 7) : start,
          ...(p === "day" ? {} : { end: "" })
        })
      }
    />
    <div className="atlas-dates">
      {precision === "day" && (
        <DateRangeCalendar
          start={start.length === 10 ? start : undefined}
          end={end || undefined}
          onChange={(range) => onChange({ start: range.start, end: range.end ?? "" })}
        />
      )}
      {precision === "month" && (
        <label className="atlas-field">
          <span>Month</span>
          <input
            type="month"
            min="1900-01"
            max={TODAY.slice(0, 7)}
            defaultValue={start.length >= 7 ? start.slice(0, 7) : undefined}
            onChange={(e) => onChange({ start: e.target.value })}
          />
        </label>
      )}
      {precision === "year" && (
        <label className="atlas-field">
          <span>Year</span>
          <select value={start.slice(0, 4)} onChange={(e) => onChange({ start: e.target.value })}>
            <option value="">Pick a year</option>
            {Array.from({ length: 70 }, (_, i) => new Date().getFullYear() - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
      )}
    </div>
    <p className="muted">Don’t remember the day? Month or year is fine — old trips usually are.</p>
  </section>
);
