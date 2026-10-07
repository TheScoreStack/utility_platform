import { useEffect, useState } from "react";
import type { Feature, MultiPolygon } from "geojson";

// Country and US state outlines built by scripts/geo/build-geo.mjs. The file
// stores each polygon's rings as flat [lon, lat, …] arrays to stay small.

export type AtlasFeature = Feature<MultiPolygon, { id: string }>;
export interface AtlasGeo {
  countries: AtlasFeature[];
  regions: AtlasFeature[];
}

interface CompactShape {
  id: string;
  p: number[][][];
}

const toFeature = ({ id, p }: CompactShape): AtlasFeature => ({
  type: "Feature",
  id,
  properties: { id },
  geometry: {
    type: "MultiPolygon",
    coordinates: p.map((poly) =>
      poly.map((ring) => {
        const points: [number, number][] = [];
        for (let i = 0; i < ring.length; i += 2) points.push([ring[i], ring[i + 1]]);
        return points;
      })
    )
  }
});

let cache: Promise<AtlasGeo> | null = null;
const loadGeo = () => {
  if (!cache) {
    cache = fetch("/geo/atlas-geo.json")
      .then((r) => {
        if (!r.ok) throw new Error("Map outlines failed to load");
        return r.json() as Promise<{ countries: CompactShape[]; regions: CompactShape[] }>;
      })
      .then((raw) => ({
        countries: raw.countries.map(toFeature),
        regions: raw.regions.map(toFeature)
      }))
      .catch((error) => {
        cache = null;
        throw error;
      });
  }
  return cache;
};

export const useAtlasGeo = () => {
  const [geo, setGeo] = useState<AtlasGeo | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let live = true;
    loadGeo().then(
      (g) => live && setGeo(g),
      (e: Error) => live && setError(e)
    );
    return () => {
      live = false;
    };
  }, []);
  return { geo, error };
};
