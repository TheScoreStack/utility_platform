// The Meet availability surface — one component, two personalities.
//
//   variant="paint"  your own answer; drag across cells to flood them with
//                    the active level (Available / If need be). Pointer
//                    events + elementFromPoint hit-testing so a single
//                    stroke works identically for mouse and touch. Fast
//                    drags interpolate between samples so strokes never
//                    skip cells, and the scroll container autoscrolls when
//                    a stroke nears its edges. On touch, painting starts
//                    only after a ~350ms long-press — before that the
//                    finger scrolls the page as usual; a quick tap still
//                    toggles a single cell.
//   variant="heat"   the group readout; cells warm from slate to emerald
//                    as more people can make it, amber when a slot only
//                    survives on "if need be". Tap, hover, or focus a cell
//                    to ask who is behind the color.
//
// Both variants are keyboard-operable ARIA grids: one roving tabstop,
// arrow keys move, Space/Enter paints (cycling with the brush level) or
// selects a heat cell.
//
// Both the authed event page and the public /m/<slug> respond page render
// this. Times are wall-clock in the EVENT timezone — no conversion here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { meetLevelAt, meetSlotsPerDay } from "@utility-platform/shared";
import type {
  MeetAvailability,
  MeetAvailabilityLevel,
  MeetEvent,
  MeetHeatmap,
  MeetSlotRef
} from "../../types";
import { formatMinute, meetDayParts } from "../../lib/meetFormat";

export type MeetGridEvent = Pick<
  MeetEvent,
  "mode" | "dates" | "startMinute" | "endMinute" | "slotMinutes" | "settings"
>;

export interface MeetGridSlot {
  date: string;
  slotIndex: number;
}

interface MeetAvailabilityGridProps {
  event: MeetGridEvent;
  variant: "paint" | "heat";
  /** Paint variant: the availability being edited. */
  availability?: MeetAvailability;
  onChange?: (next: MeetAvailability) => void;
  /** Level applied by the brush (2 = available, 1 = if need be). */
  paintLevel?: MeetAvailabilityLevel;
  disabled?: boolean;
  /** Heat variant: aggregate built via buildMeetHeatmap. */
  heatmap?: MeetHeatmap;
  selectedSlot?: MeetGridSlot | null;
  onSelectSlot?: (slot: MeetGridSlot) => void;
  finalizedSlot?: MeetSlotRef;
}

interface PaintStroke {
  pointerId: number;
  pointerType: string;
  target: MeetAvailabilityLevel;
  draft: MeetAvailability;
  lastKey?: string;
  lastX: number;
  lastY: number;
}

interface LongPressState {
  pointerId: number;
  startX: number;
  startY: number;
  cell: MeetGridSlot;
  timer: number;
}

const LONG_PRESS_MS = 350;
const LONG_PRESS_SLOP_PX = 10;
const GUTTER_SNAP_PX = 6;
/** ~half a cell height, so interpolated strokes cannot skip cells. */
const PAINT_STEP_PX = 10;
const AUTOSCROLL_EDGE_PX = 28;
const AUTOSCROLL_STEP_PX = 9;

interface HeatCellInfo {
  style?: CSSProperties;
  /** Extra class when the fill is bright enough to need dark ink. */
  inkClass: string;
}

const heatCellInfo = (
  available: number,
  ifNeedBe: number,
  max: number
): HeatCellInfo => {
  if (available === 0 && ifNeedBe === 0) return { inkClass: "" };
  const t = Math.min(1, (available + ifNeedBe * 0.5) / Math.max(max, 1));
  if (available === 0) {
    const alpha = 0.14 + 0.36 * t;
    return {
      style: { background: `rgba(251, 191, 36, ${alpha})` },
      inkClass: alpha >= 0.38 ? "meet-heat--ink-inb" : ""
    };
  }
  const alpha = 0.16 + 0.64 * t;
  return {
    style: { background: `rgba(52, 211, 153, ${alpha})` },
    inkClass: alpha >= 0.5 ? "meet-heat--ink-yes" : ""
  };
};

const MeetAvailabilityGrid = ({
  event,
  variant,
  availability,
  onChange,
  paintLevel = 2,
  disabled = false,
  heatmap,
  selectedSlot,
  onSelectSlot,
  finalizedSlot
}: MeetAvailabilityGridProps) => {
  const slotsPerDay = meetSlotsPerDay(event);
  const stroke = useRef<PaintStroke | null>(null);
  const longPress = useRef<LongPressState | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollVelX = useRef(0);
  const scrollVelY = useRef(0);
  const rafId = useRef<number | null>(null);
  const [touchPainting, setTouchPainting] = useState(false);
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const paintable = variant === "paint" && !disabled;
  const interactive = paintable || variant === "heat";

  // Roving tabindex position: indices into event.dates / slot rows.
  const [focusPos, setFocusPos] = useState({ day: 0, slot: 0 });
  const focusDay = Math.min(focusPos.day, Math.max(0, event.dates.length - 1));
  const focusSlot = Math.min(focusPos.slot, Math.max(0, slotsPerDay - 1));

  const slotStart = useCallback(
    (slotIndex: number) =>
      event.mode === "all-day"
        ? 0
        : event.startMinute + slotIndex * event.slotMinutes,
    [event.mode, event.startMinute, event.slotMinutes]
  );

  const isFinalized = useCallback(
    (date: string, slotIndex: number) => {
      if (!finalizedSlot || finalizedSlot.date !== date) return false;
      if (event.mode === "all-day") return true;
      const start = slotStart(slotIndex);
      return (
        start >= finalizedSlot.startMinute &&
        start + event.slotMinutes <= finalizedSlot.endMinute
      );
    },
    [finalizedSlot, event.mode, event.slotMinutes, slotStart]
  );

  const toCell = (el: HTMLElement | null): MeetGridSlot | null => {
    if (!el) return null;
    const date = el.dataset.meetDate;
    const slot = Number(el.dataset.meetSlot);
    if (!date || Number.isNaN(slot)) return null;
    return { date, slotIndex: slot };
  };

  const cellFromPoint = (x: number, y: number): MeetGridSlot | null =>
    toCell(
      document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-meet-date]") ??
        null
    );

  // A press landing in the gutter between cells should still start a stroke —
  // snap to the nearest cell within reach instead of dropping the gesture.
  const cellNearPoint = (x: number, y: number): MeetGridSlot | null => {
    const direct = cellFromPoint(x, y);
    if (direct) return direct;
    const cells = gridRef.current?.querySelectorAll<HTMLElement>(
      "[data-meet-date]"
    );
    if (!cells) return null;
    let best: { el: HTMLElement; dist: number } | null = null;
    for (const el of cells) {
      const r = el.getBoundingClientRect();
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      const dist = Math.hypot(dx, dy);
      if (dist <= GUTTER_SNAP_PX && (!best || dist < best.dist)) {
        best = { el, dist };
      }
    }
    return toCell(best?.el ?? null);
  };

  const applyToCell = (cell: MeetGridSlot) => {
    const active = stroke.current;
    if (!active) return;
    const key = `${cell.date}#${cell.slotIndex}`;
    if (active.lastKey === key) return;
    active.lastKey = key;
    const raw = active.draft[cell.date] ?? "";
    const day = raw.padEnd(slotsPerDay, "0").slice(0, slotsPerDay);
    if (day[cell.slotIndex] === String(active.target)) return;
    active.draft[cell.date] =
      day.slice(0, cell.slotIndex) +
      String(active.target) +
      day.slice(cell.slotIndex + 1);
    onChange?.({ ...active.draft });
  };

  /** One-shot toggle for keyboard and quick taps: paints the brush level,
   *  or clears the cell when it already carries it (cycle on repeat). */
  const toggleCell = (cell: MeetGridSlot) => {
    if (!paintable) return;
    const current = meetLevelAt(availability ?? {}, cell.date, cell.slotIndex);
    const target: MeetAvailabilityLevel =
      current === paintLevel ? 0 : paintLevel;
    const draft = { ...(availability ?? {}) };
    const raw = draft[cell.date] ?? "";
    const day = raw.padEnd(slotsPerDay, "0").slice(0, slotsPerDay);
    draft[cell.date] =
      day.slice(0, cell.slotIndex) +
      String(target) +
      day.slice(cell.slotIndex + 1);
    onChange?.(draft);
  };

  // Hit-test intermediate points too — fast drags sample pointermove far
  // apart, and a plain elementFromPoint at the endpoint skips cells.
  const paintAlong = (x1: number, y1: number, x2: number, y2: number) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / PAINT_STEP_PX));
    for (let i = 1; i <= steps; i++) {
      const cell = cellFromPoint(
        x1 + ((x2 - x1) * i) / steps,
        y1 + ((y2 - y1) * i) / steps
      );
      if (cell) applyToCell(cell);
    }
  };

  // ------------------------------------------------------ edge autoscroll
  const stopAutoScroll = () => {
    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    rafId.current = null;
    scrollVelX.current = 0;
    scrollVelY.current = 0;
  };

  const autoScrollLoop = () => {
    const active = stroke.current;
    if (!active || (scrollVelX.current === 0 && scrollVelY.current === 0)) {
      stopAutoScroll();
      return;
    }
    if (scrollVelX.current !== 0 && scrollRef.current) {
      scrollRef.current.scrollLeft += scrollVelX.current;
    }
    if (scrollVelY.current !== 0) {
      window.scrollBy(0, scrollVelY.current);
    }
    // The grid moved under a stationary pointer — keep painting.
    const cell = cellFromPoint(active.lastX, active.lastY);
    if (cell) applyToCell(cell);
    rafId.current = requestAnimationFrame(autoScrollLoop);
  };

  const updateAutoScroll = (x: number, y: number) => {
    let vx = 0;
    if (scrollRef.current) {
      const rect = scrollRef.current.getBoundingClientRect();
      if (x < rect.left + AUTOSCROLL_EDGE_PX) vx = -AUTOSCROLL_STEP_PX;
      else if (x > rect.right - AUTOSCROLL_EDGE_PX) vx = AUTOSCROLL_STEP_PX;
    }
    let vy = 0;
    if (y < 70) vy = -AUTOSCROLL_STEP_PX;
    else if (y > window.innerHeight - 70) vy = AUTOSCROLL_STEP_PX;
    scrollVelX.current = vx;
    scrollVelY.current = vy;
    if ((vx !== 0 || vy !== 0) && rafId.current === null) {
      rafId.current = requestAnimationFrame(autoScrollLoop);
    }
  };

  useEffect(
    () => () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    },
    []
  );

  // ------------------------------------------------------ pointer painting
  const clearLongPress = () => {
    if (longPress.current) {
      window.clearTimeout(longPress.current.timer);
      longPress.current = null;
    }
  };

  const beginStroke = (
    cell: MeetGridSlot,
    pointerId: number,
    pointerType: string,
    x: number,
    y: number,
    el: HTMLElement
  ) => {
    const current = meetLevelAt(availability ?? {}, cell.date, cell.slotIndex);
    stroke.current = {
      pointerId,
      pointerType,
      // Starting on a cell already at the brush level erases instead,
      // so a second pass over painted cells clears them.
      target: current === paintLevel ? 0 : paintLevel,
      draft: { ...(availability ?? {}) },
      lastX: x,
      lastY: y
    };
    try {
      el.setPointerCapture(pointerId);
    } catch {
      // The pointer may already be gone (e.g. lifted during a long-press).
    }
    applyToCell(cell);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!paintable) return;
    const cell = cellNearPoint(e.clientX, e.clientY);
    if (!cell) return;
    if (e.pointerType === "touch") {
      // Touch scrolls by default; a ~350ms still press arms the brush.
      const el = e.currentTarget;
      const { pointerId, clientX, clientY } = e;
      clearLongPress();
      longPress.current = {
        pointerId,
        startX: clientX,
        startY: clientY,
        cell,
        timer: window.setTimeout(() => {
          longPress.current = null;
          setTouchPainting(true);
          setArmedKey(`${cell.date}#${cell.slotIndex}`);
          if (typeof navigator !== "undefined" && "vibrate" in navigator) {
            navigator.vibrate?.(10);
          }
          beginStroke(cell, pointerId, "touch", clientX, clientY, el);
        }, LONG_PRESS_MS)
      };
      return;
    }
    // preventDefault stops text selection but also suppresses the browser's
    // click-to-focus, so move the roving grid focus to the cell ourselves —
    // otherwise Space/arrows after a click scroll the page instead.
    e.preventDefault();
    focusCell(event.dates.indexOf(cell.date), cell.slotIndex);
    beginStroke(
      cell,
      e.pointerId,
      e.pointerType,
      e.clientX,
      e.clientY,
      e.currentTarget
    );
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pending = longPress.current;
    if (pending && pending.pointerId === e.pointerId) {
      const drift = Math.hypot(
        e.clientX - pending.startX,
        e.clientY - pending.startY
      );
      // The finger is scrolling, not pressing — stand down.
      if (drift > LONG_PRESS_SLOP_PX) clearLongPress();
    }
    const active = stroke.current;
    if (!active || active.pointerId !== e.pointerId) return;
    paintAlong(active.lastX, active.lastY, e.clientX, e.clientY);
    active.lastX = e.clientX;
    active.lastY = e.clientY;
    updateAutoScroll(e.clientX, e.clientY);
  };

  const endStroke = (e: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const pending = longPress.current;
    if (pending && pending.pointerId === e.pointerId) {
      clearLongPress();
      // A quick, still tap toggles that one cell.
      if (!cancelled) toggleCell(pending.cell);
    }
    if (!stroke.current || stroke.current.pointerId !== e.pointerId) return;
    stroke.current = null;
    stopAutoScroll();
    setTouchPainting(false);
    setArmedKey(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const pointerHandlers = paintable
    ? {
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => endStroke(e),
        onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) =>
          endStroke(e, true),
        onContextMenu: (e: { preventDefault: () => void }) => {
          // Long-press must arm the brush, not the browser menu.
          if (stroke.current || longPress.current) e.preventDefault();
        }
      }
    : {};

  // While a touch stroke is live, block the browser's pan outright —
  // touch-action alone is not re-evaluated mid-gesture everywhere.
  useEffect(() => {
    const el = gridRef.current;
    if (!el || !paintable) return;
    const onTouchMove = (ev: TouchEvent) => {
      if (stroke.current?.pointerType === "touch") ev.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, [paintable]);

  // --------------------------------------------------------- keyboard grid
  const focusCell = (day: number, slot: number) => {
    setFocusPos({ day, slot });
    const date = event.dates[day];
    gridRef.current
      ?.querySelector<HTMLElement>(
        `[data-meet-date="${date}"][data-meet-slot="${slot}"]`
      )
      ?.focus();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const maxDay = event.dates.length - 1;
    const maxSlot = slotsPerDay - 1;
    let day = focusDay;
    let slot = focusSlot;
    switch (e.key) {
      case "ArrowRight":
        day = Math.min(maxDay, day + 1);
        break;
      case "ArrowLeft":
        day = Math.max(0, day - 1);
        break;
      case "ArrowDown":
        if (event.mode === "all-day") day = Math.min(maxDay, day + 1);
        else slot = Math.min(maxSlot, slot + 1);
        break;
      case "ArrowUp":
        if (event.mode === "all-day") day = Math.max(0, day - 1);
        else slot = Math.max(0, slot - 1);
        break;
      case "Home":
        if (event.mode === "all-day") day = 0;
        else slot = 0;
        break;
      case "End":
        if (event.mode === "all-day") day = maxDay;
        else slot = maxSlot;
        break;
      case " ":
      case "Enter": {
        e.preventDefault();
        const cell = { date: event.dates[day], slotIndex: slot };
        if (paintable) toggleCell(cell);
        else onSelectSlot?.(cell);
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    focusCell(day, slot);
  };

  const heatTotal = heatmap ? Math.max(heatmap.maxAvailable, 1) : 1;

  const cellClass = (date: string, slotIndex: number): string => {
    const classes = ["meet-cell"];
    if (variant === "paint") {
      const level = meetLevelAt(availability ?? {}, date, slotIndex);
      classes.push(`meet-cell--l${level}`);
      if (disabled) classes.push("meet-cell--locked");
      if (armedKey === `${date}#${slotIndex}`) classes.push("meet-cell--armed");
    } else {
      classes.push("meet-cell--heat");
      if (
        selectedSlot &&
        selectedSlot.date === date &&
        selectedSlot.slotIndex === slotIndex
      ) {
        classes.push("meet-cell--selected");
      }
    }
    if (isFinalized(date, slotIndex)) classes.push("meet-cell--final");
    return classes.join(" ");
  };

  const levelName = (level: MeetAvailabilityLevel): string =>
    level === 2 ? "available" : level === 1 ? "if need be" : "free";

  const cellLabel = (date: string, slotIndex: number): string => {
    const window =
      event.mode === "all-day"
        ? "all day"
        : `${formatMinute(slotStart(slotIndex))} – ${formatMinute(slotStart(slotIndex) + event.slotMinutes)}`;
    const base = `${date}, ${window}`;
    if (variant === "paint") {
      return `${base} — ${levelName(
        meetLevelAt(availability ?? {}, date, slotIndex)
      )}`;
    }
    const tally = heatmap?.tally[date];
    const available = tally?.available[slotIndex]?.length ?? 0;
    const ifNeedBe = tally?.ifNeedBe[slotIndex]?.length ?? 0;
    return `${base} — ${available} available${
      ifNeedBe > 0 ? `, ${ifNeedBe} if need be` : ""
    }`;
  };

  const cellA11yProps = (date: string, dayIndex: number, slotIndex: number) => {
    if (!interactive) {
      return { role: "gridcell", "aria-label": cellLabel(date, slotIndex) };
    }
    return {
      role: "gridcell",
      "aria-label": cellLabel(date, slotIndex),
      "aria-selected":
        variant === "heat"
          ? selectedSlot?.date === date && selectedSlot?.slotIndex === slotIndex
          : undefined,
      tabIndex: dayIndex === focusDay && slotIndex === focusSlot ? 0 : -1,
      onFocus: () => {
        setFocusPos({ day: dayIndex, slot: slotIndex });
        if (variant === "heat") onSelectSlot?.({ date, slotIndex });
      }
    };
  };

  const heatProps = (date: string, slotIndex: number) => {
    if (variant !== "heat") return {};
    return {
      onClick: () => onSelectSlot?.({ date, slotIndex }),
      onMouseEnter: () => onSelectSlot?.({ date, slotIndex })
    };
  };

  const dayParts = useMemo(
    () => event.dates.map((date) => ({ date, ...meetDayParts(date) })),
    [event.dates]
  );

  const gridA11yProps = {
    role: "grid",
    "aria-label":
      variant === "paint" ? "Your availability" : "Group availability",
    onKeyDown: handleKeyDown
  };

  // ------------------------------------------------------------ all-day
  if (event.mode === "all-day") {
    return (
      <div
        ref={gridRef}
        className={`meet-alldays ${paintable ? "meet-alldays--paint" : ""} ${
          touchPainting ? "meet-alldays--painting" : ""
        }`}
        {...gridA11yProps}
        {...pointerHandlers}
      >
        <div className="meet-alldays__row" role="row">
          {dayParts.map(({ date, weekday, day, month }, dayIndex) => {
            const tally = heatmap?.tally[date];
            const available = tally?.available[0]?.length ?? 0;
            const ifNeedBe = tally?.ifNeedBe[0]?.length ?? 0;
            const heat =
              variant === "heat"
                ? heatCellInfo(available, ifNeedBe, heatTotal)
                : undefined;
            return (
              <div
                key={date}
                className={`meet-allday-tile ${cellClass(date, 0)} ${
                  heat?.inkClass ?? ""
                }`}
                data-meet-date={date}
                data-meet-slot={0}
                style={heat?.style}
                {...cellA11yProps(date, dayIndex, 0)}
                {...heatProps(date, 0)}
              >
                <span className="meet-allday-tile__weekday">{weekday}</span>
                <span className="meet-allday-tile__day">{day}</span>
                <span className="meet-allday-tile__month">{month}</span>
                {variant === "heat" && (
                  <span className="meet-allday-tile__count">
                    {available}
                    {ifNeedBe > 0 ? `+${ifNeedBe}` : ""}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------- time-grid
  const columns = `3.4rem repeat(${event.dates.length}, minmax(2.7rem, 1fr))`;

  return (
    <div className="meet-grid-scroll" ref={scrollRef}>
      <div
        ref={gridRef}
        className={`meet-grid ${paintable ? "meet-grid--paint" : ""} ${
          touchPainting ? "meet-grid--painting" : ""
        }`}
        style={{ gridTemplateColumns: columns }}
        {...gridA11yProps}
        {...pointerHandlers}
      >
        <div className="meet-grid__row" role="row">
          <div
            className="meet-grid__corner"
            role="columnheader"
            aria-label="Time"
          />
          {dayParts.map(({ date, weekday, day, month }) => (
            <div
              key={`head-${date}`}
              className="meet-grid__day"
              role="columnheader"
            >
              <span className="meet-grid__day-weekday">{weekday}</span>
              <span className="meet-grid__day-date">
                {month} {day}
              </span>
            </div>
          ))}
        </div>
        {Array.from({ length: slotsPerDay }, (_, slotIndex) => {
          const start = slotStart(slotIndex);
          const onHour = start % 60 === 0;
          return (
            <div key={`row-${slotIndex}`} className="meet-grid__row" role="row">
              <div
                className={`meet-grid__time ${onHour ? "meet-grid__time--hour" : ""}`}
                role="rowheader"
                aria-label={formatMinute(start)}
              >
                {onHour ? formatMinute(start) : ""}
              </div>
              {event.dates.map((date, dayIndex) => {
                const tally = heatmap?.tally[date];
                const available = tally?.available[slotIndex]?.length ?? 0;
                const ifNeedBe = tally?.ifNeedBe[slotIndex]?.length ?? 0;
                const heat =
                  variant === "heat"
                    ? heatCellInfo(available, ifNeedBe, heatTotal)
                    : undefined;
                return (
                  <div
                    key={`${date}-${slotIndex}`}
                    className={`${cellClass(date, slotIndex)} ${onHour ? "meet-cell--hour" : ""} ${heat?.inkClass ?? ""}`}
                    data-meet-date={date}
                    data-meet-slot={slotIndex}
                    style={heat?.style}
                    {...cellA11yProps(date, dayIndex, slotIndex)}
                    {...heatProps(date, slotIndex)}
                  >
                    {variant === "heat" && available + ifNeedBe > 0 && (
                      <span className="meet-cell__count" aria-hidden="true">
                        {available}
                        {ifNeedBe > 0 ? `+${ifNeedBe}` : ""}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MeetAvailabilityGrid;
