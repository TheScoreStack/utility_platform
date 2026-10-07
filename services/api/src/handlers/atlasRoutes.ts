import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import type { AuthContext } from "../auth.js";
import { corsHeaders, json, parseBody } from "../lib/http.js";
import { ValidationError } from "../lib/errors.js";
import { AtlasService } from "../services/atlasService.js";
import { AtlasQuickAddService } from "../services/atlasQuickAdd.js";
import { PlacesService } from "../services/placesService.js";

const atlasService = new AtlasService();
const quickAddService = new AtlasQuickAddService();
const placesService = new PlacesService();

const COLLECTIONS = {
  trips: {
    create: atlasService.createTrip.bind(atlasService),
    update: atlasService.updateTrip.bind(atlasService),
    remove: atlasService.deleteTrip.bind(atlasService)
  },
  circles: {
    create: atlasService.createCircle.bind(atlasService),
    update: atlasService.updateCircle.bind(atlasService),
    remove: atlasService.deleteCircle.bind(atlasService)
  },
  people: {
    create: atlasService.createPerson.bind(atlasService),
    update: atlasService.updatePerson.bind(atlasService),
    remove: atlasService.deletePerson.bind(atlasService)
  },
  wishes: {
    create: atlasService.createWish.bind(atlasService),
    update: atlasService.updateWish.bind(atlasService),
    remove: atlasService.deleteWish.bind(atlasService)
  }
} as const;

const nearFrom = (query: Record<string, string | undefined>) => {
  const lat = Number(query.lat);
  const lng = Number(query.lng);
  return query.lat && query.lng && Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng }
    : undefined;
};

/**
 * Dispatches /atlas/* for an authenticated caller. Returns undefined when
 * no Atlas route matches so the main router can fall through to its 404.
 */
export const routeAtlas = async (
  path: string,
  method: string,
  event: APIGatewayProxyEventV2,
  auth: AuthContext,
  origin: string
): Promise<APIGatewayProxyResultV2 | undefined> => {
  if (!path.startsWith("/atlas/")) return undefined;
  const ok = (body: unknown) => json(200, body, origin);
  const created = (body: unknown) => json(201, body, origin);
  const noContent = (): APIGatewayProxyResultV2 => ({
    statusCode: 204,
    headers: corsHeaders(origin)
  });

  if (path === "/atlas/snapshot" && method === "GET") {
    return ok(await atlasService.getSnapshot(auth));
  }
  if (path === "/atlas/profile" && method === "PATCH") {
    return ok({ profile: await atlasService.updateProfile(parseBody(event), auth) });
  }
  if (path === "/atlas/places/search" && method === "GET") {
    const query = event.queryStringParameters ?? {};
    const results = await placesService.search(query.q ?? "", nearFrom(query));
    return ok({ results });
  }
  const placeMatch = path.match(/^\/atlas\/places\/(.+)$/);
  if (placeMatch && method === "GET") {
    const place = await placesService.resolve(decodeURIComponent(placeMatch[1]));
    return ok({ place });
  }
  if (path === "/atlas/photos/upload-url" && method === "POST") {
    return created(await atlasService.createCoverUpload(parseBody(event), auth));
  }
  if (path === "/atlas/quick-add" && method === "POST") {
    return ok(await quickAddService.parse(parseBody(event), auth));
  }

  const collectionMatch = path.match(/^\/atlas\/(trips|circles|people|wishes)(?:\/([^/]+))?$/);
  if (collectionMatch) {
    const handlers = COLLECTIONS[collectionMatch[1] as keyof typeof COLLECTIONS];
    const itemId = collectionMatch[2] ? decodeURIComponent(collectionMatch[2]) : undefined;
    if (!itemId && method === "POST") {
      return created(await handlers.create(parseBody(event), auth));
    }
    if (itemId && method === "PATCH") {
      return ok(await handlers.update(itemId, parseBody(event), auth));
    }
    if (itemId && method === "DELETE") {
      await handlers.remove(itemId, auth);
      return noContent();
    }
    if (method === "GET") {
      throw new ValidationError("Read the atlas with GET /atlas/snapshot");
    }
  }
  return undefined;
};
