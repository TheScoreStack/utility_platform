import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import { geoEqualEarth, geoPath, type GeoProjection } from "d3-geo";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import "d3-transition";
import type { AtlasLeg, AtlasPlace } from "../../types";
import type { AtlasFeature, AtlasGeo } from "../../modules/atlas/geo";

export interface MapPin {
  key: string;
  place: AtlasPlace;
  color: string;
}

export interface MapArc {
  key: string;
  leg: Pick<AtlasLeg, "from" | "to">;
  color: string;
}

export interface WorldMapHandle {
  /** Animates the view to fit these places (or resets with none). */
  flyTo: (places: Pick<AtlasPlace, "lat" | "lng">[]) => void;
}

interface WorldMapProps {
  geo: AtlasGeo;
  /** Fill color for visited areas. */
  color: string;
  countryVisits: Record<string, number>;
  regionVisits: Record<string, number>;
  /** Home country, drawn hatched when not otherwise visited. */
  homeCountry?: string;
  pins?: MapPin[];
  arcs?: MapArc[];
  wishes?: MapPin[];
  /** Dims fills (wishlist view, flights view). */
  muted?: boolean;
  selectedCountry?: string;
  /** Countries that just became visited: they ripple once. */
  rippleCountries?: string[];
  interactive?: boolean;
  onCountryClick?: (code: string) => void;
  onCountryHover?: (code: string | undefined, point?: { x: number; y: number }) => void;
  className?: string;
  ariaLabel?: string;
}

const WIDTH = 960;
const HEIGHT = 500;

const fill = (visits: number, color: string, muted: boolean) => {
  if (!visits) return undefined;
  // One visit is clearly filled; four or more is the deepest tone.
  const strength = 0.58 + Math.min(visits - 1, 3) * 0.12;
  return { color, opacity: muted ? strength * 0.35 : strength };
};

const usePrefersReducedMotion = () => {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
};

/**
 * The Atlas map: an Equal Earth world, countries filled by visit count, US
 * states layered on top, city pins, flight arcs and dashed wishlist pins.
 * Pan and zoom with d3-zoom; strokes and pins stay a constant screen size.
 */
export const WorldMap = forwardRef<WorldMapHandle, WorldMapProps>(function WorldMap(
  {
    geo,
    color,
    countryVisits,
    regionVisits,
    homeCountry,
    pins = [],
    arcs = [],
    wishes = [],
    muted = false,
    selectedCountry,
    rippleCountries = [],
    interactive = true,
    onCountryClick,
    onCountryHover,
    className,
    ariaLabel = "World map of visited places"
  },
  ref
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [k, setK] = useState(1);
  const [transform, setTransform] = useState("");
  const reducedMotion = usePrefersReducedMotion();

  const projection = useMemo<GeoProjection>(
    () =>
      geoEqualEarth().fitExtent(
        [
          [8, 8],
          [WIDTH - 8, HEIGHT - 8]
        ],
        { type: "Sphere" }
      ),
    []
  );
  const path = useMemo(() => geoPath(projection), [projection]);
  const sphere = useMemo(() => path({ type: "Sphere" }) ?? "", [path]);

  // Outlines never change, so their path strings are computed once.
  const countryPaths = useMemo(
    () => geo.countries.map((f) => ({ id: f.properties.id, d: path(f) ?? "" })),
    [geo, path]
  );
  const regionPaths = useMemo(
    () => geo.regions.map((f: AtlasFeature) => ({ id: f.properties.id, d: path(f) ?? "" })),
    [geo, path]
  );
  const anyUsRegion = useMemo(
    () => Object.keys(regionVisits).some((r) => r.startsWith("US-")),
    [regionVisits]
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !interactive) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 14])
      .translateExtent([
        [0, 0],
        [WIDTH, HEIGHT]
      ])
      .on("zoom", (event) => {
        setTransform(event.transform.toString());
        setK(event.transform.k);
      });
    zoomRef.current = behavior;
    const selection = select(svg);
    selection.call(behavior).on("dblclick.zoom", null);
    return () => {
      selection.on(".zoom", null);
    };
  }, [interactive]);

  const flyTo = useCallback(
    (places: Pick<AtlasPlace, "lat" | "lng">[]) => {
      const svg = svgRef.current;
      const behavior = zoomRef.current;
      const points = places
        .map((p) => projection([p.lng, p.lat]))
        .filter((p): p is [number, number] => Boolean(p));
      const target = (() => {
        if (!points.length) return zoomIdentity;
        const xs = points.map((p) => p[0]);
        const ys = points.map((p) => p[1]);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        // A single city still gets some context around it.
        const w = Math.max(x1 - x0, 60);
        const h = Math.max(y1 - y0, 40);
        const scale = Math.max(1, Math.min(10, 0.7 / Math.max(w / WIDTH, h / HEIGHT)));
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        return zoomIdentity
          .translate(WIDTH / 2, HEIGHT / 2)
          .scale(scale)
          .translate(-cx, -cy);
      })();
      if (svg && behavior) {
        const selection = select(svg);
        if (reducedMotion) selection.call(behavior.transform, target);
        else selection.transition().duration(900).call(behavior.transform, target);
      } else {
        setTransform(target.toString());
        setK(target.k);
      }
    },
    [projection, reducedMotion]
  );
  useImperativeHandle(ref, () => ({ flyTo }), [flyTo]);

  const project = (p: Pick<AtlasPlace, "lat" | "lng">) => projection([p.lng, p.lat]);
  const ripple = new Set(rippleCountries);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={`atlas-map ${interactive ? "atlas-map--interactive" : ""} ${className ?? ""}`}
      role="img"
      aria-label={ariaLabel}
      onMouseLeave={() => onCountryHover?.(undefined)}
    >
      <defs>
        <pattern id="atlas-home-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="2" strokeOpacity="0.55" />
        </pattern>
      </defs>
      <g transform={transform}>
        <path d={sphere} className="atlas-map__ocean" />
        <g className="atlas-map__countries">
          {countryPaths.map(({ id, d }) => {
            const visited = fill(countryVisits[id] ?? 0, color, muted);
            // With states drawn on top, the US itself steps back so the
            // visited states read as the fill.
            const f =
              visited && id === "US" && anyUsRegion
                ? { ...visited, opacity: visited.opacity * 0.38 }
                : visited;
            const isHome = !f && id === homeCountry;
            return (
              <path
                key={id}
                d={d}
                className={[
                  "atlas-map__land",
                  f ? "atlas-map__land--visited" : "",
                  id === selectedCountry ? "atlas-map__land--selected" : "",
                  ripple.has(id) ? "atlas-map__land--ripple" : ""
                ].join(" ")}
                style={
                  f
                    ? { fill: f.color, fillOpacity: f.opacity }
                    : isHome
                      ? { fill: "url(#atlas-home-hatch)" }
                      : undefined
                }
                onClick={onCountryClick ? () => onCountryClick(id) : undefined}
                onMouseMove={
                  onCountryHover
                    ? (e) => {
                        const box = svgRef.current?.getBoundingClientRect();
                        onCountryHover(id, box ? { x: e.clientX - box.left, y: e.clientY - box.top } : undefined);
                      }
                    : undefined
                }
              >
                <title>{id}</title>
              </path>
            );
          })}
        </g>
        {anyUsRegion && (
          <g className="atlas-map__regions">
            {regionPaths.map(({ id, d }) => {
              const f = fill(regionVisits[id] ?? 0, color, muted);
              return (
                <path
                  key={id}
                  d={d}
                  className={f ? "atlas-map__region atlas-map__region--visited" : "atlas-map__region"}
                  style={f ? { fill: f.color, fillOpacity: Math.min(1, f.opacity + 0.12) } : undefined}
                  onClick={onCountryClick ? () => onCountryClick("US") : undefined}
                  onMouseMove={
                    onCountryHover
                      ? (e) => {
                          const box = svgRef.current?.getBoundingClientRect();
                          onCountryHover(id, box ? { x: e.clientX - box.left, y: e.clientY - box.top } : undefined);
                        }
                      : undefined
                  }
                />
              );
            })}
          </g>
        )}
        <g className="atlas-map__arcs">
          {arcs.map(({ key, leg, color: arcColor }) => (
            <path
              key={key}
              d={
                path({
                  type: "LineString",
                  coordinates: [
                    [leg.from.lng, leg.from.lat],
                    [leg.to.lng, leg.to.lat]
                  ]
                }) ?? ""
              }
              className="atlas-map__arc"
              pathLength={1}
              style={{ stroke: arcColor }}
            />
          ))}
        </g>
        <g className="atlas-map__wishes">
          {wishes.map(({ key, place, color: wishColor }) => {
            const p = project(place);
            if (!p) return null;
            return (
              <circle
                key={key}
                cx={p[0]}
                cy={p[1]}
                r={5.5 / k}
                className="atlas-map__wish"
                style={{ stroke: wishColor, strokeWidth: 1.6 / k, strokeDasharray: `${2.6 / k} ${2 / k}` }}
              />
            );
          })}
        </g>
        <g className="atlas-map__pins">
          {pins.map(({ key, place, color: pinColor }) => {
            const p = project(place);
            if (!p) return null;
            return (
              <circle
                key={key}
                cx={p[0]}
                cy={p[1]}
                r={(place.kind === "airport" ? 2.6 : 3.2) / k}
                className="atlas-map__pin"
                style={{ fill: pinColor, strokeWidth: 1 / k }}
              >
                <title>{place.name}</title>
              </circle>
            );
          })}
        </g>
      </g>
    </svg>
  );
});
