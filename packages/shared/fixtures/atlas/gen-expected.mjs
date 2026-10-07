// Regenerates expected-stats.json from the shared implementation. Only run
// this after deliberately changing a stats rule; review the diff.
import { readFileSync, writeFileSync } from "node:fs";
import { applyLens, computeStats } from "../../dist/index.js";

const atlas = JSON.parse(readFileSync(new URL("./sample-atlas.json", import.meta.url)));
const lenses = {
  all: { mode: "footprint", circle: "all" },
  wife: { mode: "footprint", circle: "circle_wife" },
  shopFlights: { mode: "flights", circle: "circle_shop" },
  solo: { mode: "footprint", circle: "solo" },
  since2025: { mode: "footprint", circle: "all", fromYear: 2025 }
};
const expected = {};
for (const [name, lens] of Object.entries(lenses)) {
  const trips = applyLens(atlas.trips, lens);
  expected[name] = { lens, tripIds: trips.map((t) => t.tripId), stats: computeStats(trips) };
}
writeFileSync(new URL("./expected-stats.json", import.meta.url), JSON.stringify(expected, null, 2) + "\n");
