import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import type { AtlasCircle, AtlasPlace, AtlasPlaceSuggestion } from "../../types";
import { CIRCLE_HEX, ALL_HEX } from "../../modules/atlas/lens";
import { resolveSuggestion, searchPlaces } from "../../modules/atlas/useAtlas";

/** A number that rolls to its new value like an odometer. */
export const RollingNumber = ({ value, format }: { value: number; format?: (n: number) => string }) => {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    if (reduced || start === value) {
      setShown(value);
      from.current = value;
      return;
    }
    const began = performance.now();
    const duration = 450;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      from.current = value;
    };
  }, [value]);
  return <>{format ? format(shown) : shown.toLocaleString()}</>;
};

export const Counter = ({ value, label, format }: { value: number; label: string; format?: (n: number) => string }) => (
  <div className="atlas-counter">
    <span className="atlas-counter__value">
      <RollingNumber value={value} format={format} />
    </span>
    <span className="atlas-counter__label">{label}</span>
  </div>
);

export const CircleChip = ({
  circle,
  active,
  count,
  onClick
}: {
  circle?: AtlasCircle;
  active: boolean;
  count?: number;
  onClick: () => void;
}) => (
  <button
    type="button"
    className={clsx("atlas-chip", active && "atlas-chip--on")}
    style={{ ["--chip" as string]: circle ? CIRCLE_HEX[circle.color] : ALL_HEX }}
    aria-pressed={active}
    onClick={onClick}
  >
    {circle && <span className="atlas-chip__dot" aria-hidden="true" />}
    <span>{circle ? circle.name : "All"}</span>
    {count !== undefined && <span className="atlas-chip__count">{count}</span>}
  </button>
);

export const Segmented = <T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) => (
  <div className="atlas-seg" role="radiogroup" aria-label={label}>
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        role="radio"
        aria-checked={value === o.value}
        className={clsx("atlas-seg__btn", value === o.value && "atlas-seg__btn--on")}
        onClick={() => onChange(o.value)}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const Stars = ({ value, onChange }: { value?: number; onChange?: (v: number | undefined) => void }) => (
  <div className="atlas-stars" role={onChange ? "radiogroup" : undefined} aria-label="Rating">
    {[1, 2, 3, 4, 5].map((n) =>
      onChange ? (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} of 5`}
          className={clsx("atlas-stars__dot", value && n <= value && "atlas-stars__dot--on")}
          onClick={() => onChange(value === n ? undefined : n)}
        />
      ) : (
        <span key={n} className={clsx("atlas-stars__dot", value && n <= value && "atlas-stars__dot--on")} />
      )
    )}
  </div>
);

const KIND_LABEL: Record<AtlasPlaceSuggestion["kind"], string> = {
  city: "City",
  region: "State",
  country: "Country",
  airport: "Airport",
  poi: "Place"
};

/**
 * Debounced place search. Airports, countries and states arrive complete;
 * cities are resolved to coordinates when picked.
 */
export const PlaceSearch = ({
  onPick,
  placeholder = "Search a city, country or airport",
  autoFocus,
  airportsOnly
}: {
  onPick: (place: AtlasPlace) => void;
  placeholder?: string;
  autoFocus?: boolean;
  airportsOnly?: boolean;
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AtlasPlaceSuggestion[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enter pressed before results arrived: take the first one when they do.
  const pickWhenReady = useRef(false);
  const listId = useId();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      pickWhenReady.current = false;
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      setBusy(true);
      searchPlaces(q)
        .then(({ results }) => {
          if (!live) return;
          const shown = airportsOnly ? results.filter((r) => r.kind === "airport") : results;
          setResults(shown);
          setActive(0);
          setError(null);
          if (pickWhenReady.current && shown[0]) {
            pickWhenReady.current = false;
            void pickRef.current(shown[0]);
          }
        })
        .catch(() => live && setError("Search is unavailable right now"))
        .finally(() => live && setBusy(false));
    }, 220);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, airportsOnly]);

  const pick = async (s: AtlasPlaceSuggestion) => {
    pickWhenReady.current = false;
    try {
      setBusy(true);
      const place = await resolveSuggestion(s);
      onPick(place);
      setQuery("");
      setResults([]);
    } catch {
      setError("Couldn't load that place — try another");
    } finally {
      setBusy(false);
    }
  };

  const pickRef = useRef(pick);
  pickRef.current = pick;

  return (
    <div className="atlas-search">
      <input
        type="search"
        className="atlas-search__input"
        value={query}
        placeholder={placeholder}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (results[active] && !busy) void pick(results[active]);
            else if (query.trim().length >= 2) pickWhenReady.current = true;
          } else if (e.key === "Escape") {
            setResults([]);
          }
        }}
      />
      {busy && <span className="atlas-search__spinner" aria-hidden="true" />}
      {results.length > 0 && (
        <ul id={listId} className="atlas-search__results" role="listbox">
          {results.map((r, i) => (
            <li
              key={r.providerId}
              role="option"
              aria-selected={i === active}
              className={clsx("atlas-search__result", i === active && "atlas-search__result--active")}
              onMouseDown={(e) => {
                e.preventDefault();
                void pick(r);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="atlas-search__title">{r.title}</span>
              {r.subtitle && <span className="atlas-search__sub">{r.subtitle}</span>}
              <span className="atlas-search__kind">{KIND_LABEL[r.kind]}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="atlas-search__error">{error}</p>}
    </div>
  );
};
