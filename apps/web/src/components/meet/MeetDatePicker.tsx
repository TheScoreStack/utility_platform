// Compact month calendar for picking the candidate dates of a meet.
// Click/tap toggles a day; arrows move between months. Selection is a
// set of YYYY-MM-DD strings (wall-clock dates, no timezone math).

import { useMemo, useState } from "react";

interface MeetDatePickerProps {
  selected: string[];
  onToggle: (date: string) => void;
  maxDates?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toKey = (year: number, month: number, day: number) =>
  `${year}-${pad(month + 1)}-${pad(day)}`;

const MeetDatePicker = ({
  selected,
  onToggle,
  maxDates = 60
}: MeetDatePickerProps) => {
  const today = new Date();
  const [cursor, setCursor] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = toKey(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );

  const monthLabel = cursor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric"
  });
  const weekdays = ["S", "M", "T", "W", "T", "F", "S"];
  const atCap = selected.length >= maxDates;
  // Meets are scheduled forward: today stays pickable, the past does not.
  const atCurrentMonth =
    year === today.getFullYear() && month === today.getMonth();

  return (
    <div className="meet-datepick">
      <div className="meet-datepick__head">
        <button
          type="button"
          className="meet-datepick__nav"
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          disabled={atCurrentMonth}
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="meet-datepick__month">{monthLabel}</span>
        <button
          type="button"
          className="meet-datepick__nav"
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="meet-datepick__grid">
        {weekdays.map((label, i) => (
          <span key={`w${i}`} className="meet-datepick__weekday" aria-hidden="true">
            {label}
          </span>
        ))}
        {Array.from({ length: firstWeekday }, (_, i) => (
          <span key={`blank-${i}`} aria-hidden="true" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const key = toKey(year, month, day);
          const isSelected = selectedSet.has(key);
          const isToday = key === todayKey;
          const isPast = key < todayKey;
          return (
            <button
              key={key}
              type="button"
              className={[
                "meet-datepick__day",
                isSelected ? "meet-datepick__day--on" : "",
                isToday ? "meet-datepick__day--today" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={isPast || (!isSelected && atCap)}
              onClick={() => onToggle(key)}
              aria-pressed={isSelected}
            >
              {day}
            </button>
          );
        })}
      </div>
      <p className="meet-datepick__hint muted">
        {selected.length === 0
          ? "Tap the days you want to offer."
          : `${selected.length} ${selected.length === 1 ? "day" : "days"} selected${atCap ? " (max)" : ""}`}
      </p>
    </div>
  );
};

export default MeetDatePicker;
