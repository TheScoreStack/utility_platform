// Builds the static geography Atlas draws its map from, plus the airport
// index the API searches. Run with `npm run build` from scripts/geo after
// bumping any of the source datasets; the outputs are committed.
//
//   packages/shared/src/atlasGeoData.ts   country + US state names, continents
//   apps/web/public/geo/atlas-geo.json    simplified country + state outlines
//   apps/mobile/assets/geo/atlas-geo.json same file, for the Flutter painter
//   services/api/src/lib/airports.json    IATA airports with scheduled service
//
// Sources: Natural Earth via world-atlas / us-atlas (public domain),
// countries-list (MIT), OurAirports (public domain).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { feature } from "topojson-client";
import { presimplify, simplify, quantile } from "topojson-simplify";
import * as countriesList from "countries-list";
import isoCountries from "i18n-iso-countries";
import { geoCentroid } from "d3-geo";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const out = (rel) => {
  const path = resolve(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  return path;
};
const readJson = (rel) =>
  JSON.parse(readFileSync(resolve(here, "node_modules", rel), "utf8"));

// ---------------------------------------------------------------- names

const US_STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
};
const stateByName = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [name, code])
);

// Natural Earth features with no ISO numeric code.
const NAMED_ISO = {
  Kosovo: "XK",
  "N. Cyprus": "CY",
  Somaliland: "SO"
};

const countries = {};
for (const [code, c] of Object.entries(countriesList.countries)) {
  countries[code] = { name: c.name, continent: c.continent };
}
countries.XK = { name: "Kosovo", continent: "EU" };

// ---------------------------------------------------------------- shapes

const round = (n) => Math.round(n * 100) / 100;

/** GeoJSON geometry -> [[ring as flat lon,lat,...]] per polygon. */
const compact = (geometry) => {
  if (!geometry) return [];
  const polys =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  // A polygon whose outer ring simplified away is dropped whole: keeping its
  // holes would leave a reversed ring that d3 fills as "the whole globe".
  return polys
    .map((poly) =>
      poly.map((ring) => ring.flatMap(([lon, lat]) => [round(lon), round(lat)]))
    )
    .filter((poly) => poly[0] && poly[0].length >= 8)
    .map((poly) => [poly[0], ...poly.slice(1).filter((ring) => ring.length >= 8)]);
};

const simplified = (topo, q) => {
  const pre = presimplify(topo);
  return simplify(pre, quantile(pre, q));
};

const centroid = (f) => {
  const [lng, lat] = geoCentroid(f);
  return [Math.round(lat * 100) / 100, Math.round(lng * 100) / 100];
};
const countryCentroids = {};
const stateCentroids = {};

const world = simplified(readJson("world-atlas/countries-50m.json"), 0.35);
const worldFeatures = feature(world, world.objects.countries).features;
const shapeCountries = [];
const unmatched = [];
for (const f of worldFeatures) {
  const name = f.properties?.name;
  let iso = f.id ? isoCountries.numericToAlpha2(f.id) : undefined;
  if (!iso && name in NAMED_ISO) iso = NAMED_ISO[name];
  if (!iso) {
    unmatched.push(name);
    continue;
  }
  const p = compact(f.geometry);
  if (!p.length) continue;
  if (!countryCentroids[iso] || name !== "N. Cyprus") countryCentroids[iso] = centroid(f);
  const existing = shapeCountries.find((c) => c.id === iso);
  if (existing) existing.p.push(...p);
  else shapeCountries.push({ id: iso, p });
}

const states = simplified(readJson("us-atlas/states-10m.json"), 0.5);
const stateFeatures = feature(states, states.objects.states).features;
const shapeStates = [];
for (const f of stateFeatures) {
  const code = stateByName[f.properties?.name];
  if (!code) continue; // territories
  stateCentroids[code] = centroid(f);
  shapeStates.push({ id: `US-${code}`, p: compact(f.geometry) });
}

const geo = JSON.stringify({ countries: shapeCountries, regions: shapeStates });
for (const rel of [
  "apps/web/public/geo/atlas-geo.json",
  "apps/mobile/assets/geo/atlas-geo.json"
]) {
  writeFileSync(out(rel), geo);
}

// ---------------------------------------------------------------- shared TS

const ts = `// Generated by scripts/geo/build-geo.mjs — do not edit by hand.

export type AtlasContinent = "AF" | "AN" | "AS" | "EU" | "NA" | "OC" | "SA";

export const ATLAS_CONTINENTS: Record<AtlasContinent, string> = ${JSON.stringify(
  countriesList.continents,
  null,
  2
)};

/** ISO 3166-1 alpha-2 -> display name + continent. */
export const ATLAS_COUNTRIES: Record<string, { name: string; continent: AtlasContinent }> = ${JSON.stringify(
  countries
)};

/** Visual centre [lat, lng] per country / US state, for whole-area stops. */
export const ATLAS_COUNTRY_CENTERS: Record<string, [number, number]> = ${JSON.stringify(
  countryCentroids
)};
export const ATLAS_US_STATE_CENTERS: Record<string, [number, number]> = ${JSON.stringify(
  stateCentroids
)};

/** US state and DC postal codes -> name. Region codes are "US-" + code. */
export const ATLAS_US_STATES: Record<string, string> = ${JSON.stringify(US_STATES)};
`;
writeFileSync(out("packages/shared/src/atlasGeoData.ts"), ts);

// ---------------------------------------------------------------- airports

const csvUrl = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const csv = await (await fetch(csvUrl)).text();
const parseCsvLine = (line) => {
  const cells = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
};
const [header, ...rows] = csv.trim().split("\n");
const cols = parseCsvLine(header);
const col = (name) => cols.indexOf(name);
const airports = [];
for (const line of rows) {
  const r = parseCsvLine(line);
  const type = r[col("type")];
  const iata = r[col("iata_code")];
  if (!iata || !/^[A-Z]{3}$/.test(iata)) continue;
  if (type !== "large_airport" && type !== "medium_airport") continue;
  if (r[col("scheduled_service")] !== "yes") continue;
  airports.push([
    iata,
    r[col("name")],
    r[col("municipality")],
    r[col("iso_country")],
    r[col("iso_region")],
    Math.round(Number(r[col("latitude_deg")]) * 1e4) / 1e4,
    Math.round(Number(r[col("longitude_deg")]) * 1e4) / 1e4,
    type === "large_airport" ? 1 : 0
  ]);
}
airports.sort((a, b) => b[7] - a[7] || a[0].localeCompare(b[0]));
writeFileSync(out("services/api/src/lib/airports.json"), JSON.stringify(airports));

console.log(
  `countries ${shapeCountries.length} (unmatched: ${unmatched.join(", ") || "none"}), ` +
    `states ${shapeStates.length}, airports ${airports.length}, ` +
    `geo ${(geo.length / 1024).toFixed(0)} KB`
);
