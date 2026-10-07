import {
  AutocompleteCommand,
  GeoPlacesClient,
  GetPlaceCommand
} from "@aws-sdk/client-geo-places";
import { loadConfig } from "../config.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import {
  airportByIata,
  resolveLocal,
  searchAirports,
  searchAreas,
  splitLabel
} from "../lib/atlasPlaces.js";
import type { AtlasPlace, AtlasPlaceSuggestion } from "../types.js";

// City search goes to Amazon Location Places (v2, no place index needed);
// airports, countries and US states are answered locally first.

let client: GeoPlacesClient | null = null;
const getClient = () => {
  if (!client) client = new GeoPlacesClient({ region: loadConfig().region });
  return client;
};

/** Test hook. */
export const setGeoPlacesClientForTesting = (fake: GeoPlacesClient | null) => {
  client = fake;
};

// Warm-Lambda cache: a resolved place never changes.
const resolved = new Map<string, AtlasPlace>();

export class PlacesService {
  async search(
    query: string,
    near?: { lat: number; lng: number }
  ): Promise<AtlasPlaceSuggestion[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    if (q.length > 120) throw new ValidationError("Query is too long");

    const airports = searchAirports(q);
    const areas = searchAreas(q);
    let cities: AtlasPlaceSuggestion[] = [];
    if (q.length >= 3) {
      const response = await getClient().send(
        new AutocompleteCommand({
          QueryText: q,
          MaxResults: 6,
          Language: "en",
          Filter: { IncludePlaceTypes: ["Locality"] },
          // Unbiased results rank by prominence ("lisb" -> Lisbon, Portugal);
          // a bias pulls small nearby towns ahead, so only send one on request.
          ...(near ? { BiasPosition: [near.lng, near.lat] } : {})
        })
      );
      cities = (response.ResultItems ?? []).flatMap((item) => {
        if (!item.PlaceId) return [];
        const [title, ...rest] = splitLabel(item.Address?.Label ?? item.Title ?? "");
        if (!title) return [];
        return [
          {
            providerId: item.PlaceId,
            kind: "city" as const,
            title,
            subtitle: rest.join(", ") || undefined
          }
        ];
      });
    }

    // An exact IATA code is almost certainly an airport; otherwise cities
    // lead, then whole countries / states, then airports by name.
    const exactAirport =
      /^[A-Za-z]{3}$/.test(q) && airports[0]?.place?.iata === q.toUpperCase();
    const ordered = exactAirport
      ? [airports[0], ...cities, ...areas, ...airports.slice(1)]
      : [...areas.filter((a) => a.title.toLowerCase() === q.toLowerCase()), ...cities,
         ...areas.filter((a) => a.title.toLowerCase() !== q.toLowerCase()), ...airports];
    const seen = new Set<string>();
    return ordered.filter((s) => !seen.has(s.providerId) && seen.add(s.providerId)).slice(0, 8);
  }

  async resolve(providerId: string): Promise<AtlasPlace> {
    const local = resolveLocal(providerId);
    if (local) return local;
    const cached = resolved.get(providerId);
    if (cached) return cached;

    const place = await getClient()
      .send(new GetPlaceCommand({ PlaceId: providerId, Language: "en" }))
      .catch((error: { name?: string }) => {
        if (error?.name === "ResourceNotFoundException" || error?.name === "ValidationException") {
          throw new NotFoundError("Place not found");
        }
        throw error;
      });

    const country = place.Address?.Country?.Code2;
    const [lng, lat] = place.Position ?? [];
    if (!country || lat === undefined || lng === undefined) {
      throw new NotFoundError("Place has no location");
    }
    const regionCode = place.Address?.Region?.Code
      ? `${country}-${place.Address.Region.Code}`.toUpperCase()
      : undefined;
    const locality = place.Address?.Locality;
    const result: AtlasPlace = {
      providerId,
      name: locality ?? splitLabel(place.Title ?? "")[0] ?? "Unknown place",
      kind: place.PlaceType === "Locality" ? "city" : "poi",
      locality,
      regionCode:
        regionCode && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(regionCode) ? regionCode : undefined,
      regionName: place.Address?.Region?.Name,
      countryCode: country,
      lat,
      lng
    };
    resolved.set(providerId, result);
    return result;
  }

  /**
   * Best single match for free text ("Lisbon, Portugal", "SFO"). Used by
   * quick add; returns undefined rather than guessing badly.
   */
  async resolveText(text: string): Promise<AtlasPlace | undefined> {
    const q = text.trim();
    if (/^[A-Za-z]{3}$/.test(q)) {
      const airport = airportByIata(q);
      if (airport) return airport;
    }
    const [best] = await this.search(q);
    if (!best) return undefined;
    return best.place ?? this.resolve(best.providerId).catch(() => undefined);
  }
}
