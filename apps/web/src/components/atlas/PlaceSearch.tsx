import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import type { AtlasPlace, AtlasPlaceSuggestion } from "../../types";
import { resolveSuggestion, searchPlaces } from "../../modules/atlas/useAtlas";

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
export interface QuickPick {
  place: AtlasPlace;
  /** Defaults to the place's IATA code or name. */
  label?: string;
  home?: boolean;
}

export const PlaceSearch = ({
  onPick,
  placeholder = "Search a city, country or airport",
  autoFocus,
  airportsOnly,
  quickPicks = []
}: {
  onPick: (place: AtlasPlace) => void;
  placeholder?: string;
  autoFocus?: boolean;
  airportsOnly?: boolean;
  /** One-tap chips shown while the search box is empty. */
  quickPicks?: QuickPick[];
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
        maxLength={120}
        // Place names: capitalize words; autocorrect "fixes" real towns.
        autoCapitalize="words"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
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
      {!query.trim() && quickPicks.length > 0 && (
        <div className="atlas-picks" aria-label="Quick picks">
          {quickPicks.map((q) => (
            <button
              key={q.place.iata ?? q.place.providerId}
              type="button"
              className={clsx("atlas-chip", q.home && "atlas-chip--home")}
              onClick={() => onPick(q.place)}
            >
              {q.home && <span aria-hidden="true">⌂</span>}
              {q.label ?? q.place.iata ?? q.place.name}
            </button>
          ))}
        </div>
      )}
      {error && <p className="atlas-search__error">{error}</p>}
    </div>
  );
};
