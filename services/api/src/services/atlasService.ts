import { nanoid } from "nanoid";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AuthContext } from "../auth.js";
import { loadConfig } from "../config.js";
import { AtlasStore } from "../data/atlasStore.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import {
  assertOwnCoverKey,
  circleSchema,
  createTripSchema,
  normalizeCircleIds,
  normalizeDates,
  parseWith,
  personSchema,
  profileSchema,
  updateCircleSchema,
  updatePersonSchema,
  updateTripSchema,
  updateWishSchema,
  uploadSchema,
  wishSchema
} from "../lib/atlasValidation.js";
import {
  ATLAS_SOLO_CIRCLE_ID,
  sortTrips,
  type AtlasCircle,
  type AtlasPerson,
  type AtlasProfile,
  type AtlasSnapshot,
  type AtlasTrip,
  type AtlasWish
} from "../types.js";

const id = (prefix: string) => `${prefix}_${nanoid(12)}`;
const now = () => new Date().toISOString();

/** Cover GET urls outlive a cached snapshot by a comfortable margin. */
const COVER_URL_SECONDS = 6 * 60 * 60;

let s3: S3Client | null = null;
const getS3 = () => {
  if (!s3) s3 = new S3Client({ region: loadConfig().region });
  return s3;
};

const soloCircle = (): AtlasCircle => ({
  circleId: ATLAS_SOLO_CIRCLE_ID,
  name: "Solo",
  color: "slate",
  sortOrder: 999,
  builtIn: true,
  createdAt: now()
});

const DEFAULT_PROFILE: AtlasProfile = { units: "mi" };

export class AtlasService {
  constructor(private readonly store = new AtlasStore()) {}

  // ---------------------------------------------------------------- snapshot

  async getSnapshot(auth: AuthContext): Promise<AtlasSnapshot> {
    const records = await this.store.loadAll(auth.userId);
    if (!records.circles.some((c) => c.circleId === ATLAS_SOLO_CIRCLE_ID)) {
      const solo = soloCircle();
      await this.store.putCircle(auth.userId, solo);
      records.circles.push(solo);
    }
    return {
      profile: records.profile ?? DEFAULT_PROFILE,
      circles: [...records.circles].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
      ),
      people: [...records.people].sort((a, b) => a.name.localeCompare(b.name)),
      trips: await Promise.all(sortTrips(records.trips).map((t) => this.withCoverUrl(t))),
      wishes: [...records.wishes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    };
  }

  private async withCoverUrl(trip: AtlasTrip): Promise<AtlasTrip> {
    if (!trip.coverKey) return trip;
    const coverUrl = await getSignedUrl(
      getS3(),
      new GetObjectCommand({ Bucket: loadConfig().receiptBucket, Key: trip.coverKey }),
      { expiresIn: COVER_URL_SECONDS }
    );
    return { ...trip, coverUrl };
  }

  private async circleIdSet(userId: string): Promise<Set<string>> {
    const records = await this.store.loadAll(userId);
    return new Set([ATLAS_SOLO_CIRCLE_ID, ...records.circles.map((c) => c.circleId)]);
  }

  private async knownIds(
    userId: string
  ): Promise<{ circles: Set<string>; people: Set<string> }> {
    const records = await this.store.loadAll(userId);
    return {
      circles: new Set([ATLAS_SOLO_CIRCLE_ID, ...records.circles.map((c) => c.circleId)]),
      people: new Set(records.people.map((p) => p.personId))
    };
  }

  // ---------------------------------------------------------------- trips

  async createTrip(body: unknown, auth: AuthContext): Promise<AtlasTrip> {
    const input = parseWith(createTripSchema, body);
    assertOwnCoverKey(auth.userId, input.coverKey);
    if (!input.stops.length && !input.legs.length) {
      throw new ValidationError("A trip needs at least one place");
    }
    const known = await this.knownIds(auth.userId);
    const timestamp = now();
    const trip: AtlasTrip = {
      tripId: id("atrip"),
      title: input.title,
      ...normalizeDates(input.start, input.end),
      circleIds: normalizeCircleIds(input.circleIds, known.circles),
      personIds: input.personIds.filter((p) => known.people.has(p)),
      stops: input.stops.map((s) => ({ stopId: s.stopId ?? id("stop"), place: s.place })),
      legs: input.legs.map((l) => ({ ...l, legId: l.legId ?? id("leg") })),
      rating: input.rating ?? undefined,
      notes: input.notes || undefined,
      coverKey: input.coverKey || undefined,
      expenseTripId: input.expenseTripId || undefined,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.store.putTrip(auth.userId, trip);
    return this.withCoverUrl(trip);
  }

  async updateTrip(tripId: string, body: unknown, auth: AuthContext): Promise<AtlasTrip> {
    const input = parseWith(updateTripSchema, body);
    assertOwnCoverKey(auth.userId, input.coverKey);
    const existing = await this.store.getTrip(auth.userId, tripId);
    if (!existing) throw new NotFoundError("Trip not found");
    const known = await this.knownIds(auth.userId);

    const dates =
      input.start !== undefined || input.end !== undefined
        ? normalizeDates(
            input.start ?? existing.start,
            input.end === undefined ? existing.end : input.end
          )
        : { start: existing.start, end: existing.end, datePrecision: existing.datePrecision };

    const trip: AtlasTrip = {
      ...existing,
      ...dates,
      title: input.title ?? existing.title,
      circleIds:
        input.circleIds !== undefined
          ? normalizeCircleIds(input.circleIds, known.circles)
          : existing.circleIds,
      personIds:
        input.personIds !== undefined
          ? input.personIds.filter((p) => known.people.has(p))
          : existing.personIds,
      stops:
        input.stops !== undefined
          ? input.stops.map((s) => ({ stopId: s.stopId ?? id("stop"), place: s.place }))
          : existing.stops,
      legs:
        input.legs !== undefined
          ? input.legs.map((l) => ({ ...l, legId: l.legId ?? id("leg") }))
          : existing.legs,
      rating: input.rating === undefined ? existing.rating : input.rating ?? undefined,
      notes: input.notes === undefined ? existing.notes : input.notes || undefined,
      coverKey: input.coverKey === undefined ? existing.coverKey : input.coverKey || undefined,
      expenseTripId:
        input.expenseTripId === undefined
          ? existing.expenseTripId
          : input.expenseTripId || undefined,
      updatedAt: now()
    };
    if (!trip.stops.length && !trip.legs.length) {
      throw new ValidationError("A trip needs at least one place");
    }
    await this.store.putTrip(auth.userId, trip);
    if (existing.coverKey && existing.coverKey !== trip.coverKey) {
      await this.deleteObject(existing.coverKey);
    }
    return this.withCoverUrl(trip);
  }

  async deleteTrip(tripId: string, auth: AuthContext): Promise<void> {
    const existing = await this.store.getTrip(auth.userId, tripId);
    if (!existing) return;
    await this.store.deleteTrip(auth.userId, tripId);
    if (existing.coverKey) await this.deleteObject(existing.coverKey);
    // A wish this trip fulfilled goes back to "want to go".
    const { wishes } = await this.store.loadAll(auth.userId);
    const reopened = wishes
      .filter((w) => w.fulfilledByTripId === tripId)
      .map((w) => ({ kind: "wish" as const, value: { ...w, fulfilledByTripId: undefined } }));
    if (reopened.length) await this.store.putMany(auth.userId, reopened);
  }

  private async deleteObject(key: string): Promise<void> {
    try {
      await getS3().send(
        new DeleteObjectCommand({ Bucket: loadConfig().receiptBucket, Key: key })
      );
    } catch (error) {
      console.warn("Atlas cover delete failed", { key, error });
    }
  }

  async createCoverUpload(
    body: unknown,
    auth: AuthContext
  ): Promise<{ coverKey: string; uploadUrl: string }> {
    const input = parseWith(uploadSchema, body);
    const extension = input.contentType.split("/")[1].replace("jpeg", "jpg");
    const coverKey = `atlas/${auth.userId}/covers/${nanoid(16)}.${extension}`;
    const uploadUrl = await getSignedUrl(
      getS3(),
      new PutObjectCommand({
        Bucket: loadConfig().receiptBucket,
        Key: coverKey,
        ContentType: input.contentType
      }),
      { expiresIn: loadConfig().signedUrlExpirySeconds }
    );
    return { coverKey, uploadUrl };
  }

  // ---------------------------------------------------------------- circles

  async createCircle(body: unknown, auth: AuthContext): Promise<AtlasCircle> {
    const input = parseWith(circleSchema, body);
    const { circles } = await this.store.loadAll(auth.userId);
    if (circles.length >= 24) throw new ValidationError("That's a lot of circles — 24 max");
    const circle: AtlasCircle = {
      circleId: id("circle"),
      name: input.name,
      color: input.color,
      sortOrder:
        input.sortOrder ??
        Math.max(0, ...circles.filter((c) => !c.builtIn).map((c) => c.sortOrder + 1)),
      createdAt: now()
    };
    await this.store.putCircle(auth.userId, circle);
    return circle;
  }

  async updateCircle(circleId: string, body: unknown, auth: AuthContext): Promise<AtlasCircle> {
    const input = parseWith(updateCircleSchema, body);
    const existing = await this.store.getCircle(auth.userId, circleId);
    if (!existing) throw new NotFoundError("Circle not found");
    const circle: AtlasCircle = {
      ...existing,
      name: input.name ?? existing.name,
      color: input.color ?? existing.color,
      sortOrder: input.sortOrder ?? existing.sortOrder
    };
    await this.store.putCircle(auth.userId, circle);
    return circle;
  }

  /** Deleting a circle untags it everywhere; the trips themselves stay. */
  async deleteCircle(circleId: string, auth: AuthContext): Promise<void> {
    if (circleId === ATLAS_SOLO_CIRCLE_ID) {
      throw new ValidationError("Solo is built in and can't be deleted");
    }
    const records = await this.store.loadAll(auth.userId);
    const without = (ids: string[]) => ids.filter((c) => c !== circleId);
    const rewrites = [
      ...records.trips
        .filter((t) => t.circleIds.includes(circleId))
        .map((t) => ({ kind: "trip" as const, value: { ...t, circleIds: without(t.circleIds) } })),
      ...records.people
        .filter((p) => p.circleIds.includes(circleId))
        .map((p) => ({ kind: "person" as const, value: { ...p, circleIds: without(p.circleIds) } })),
      ...records.wishes
        .filter((w) => w.circleIds.includes(circleId))
        .map((w) => ({ kind: "wish" as const, value: { ...w, circleIds: without(w.circleIds) } }))
    ];
    await this.store.putMany(auth.userId, rewrites);
    await this.store.deleteCircle(auth.userId, circleId);
  }

  // ---------------------------------------------------------------- people

  async createPerson(body: unknown, auth: AuthContext): Promise<AtlasPerson> {
    const input = parseWith(personSchema, body);
    const circles = await this.circleIdSet(auth.userId);
    const person: AtlasPerson = {
      personId: id("person"),
      name: input.name,
      circleIds: input.circleIds.filter((c) => circles.has(c) && c !== ATLAS_SOLO_CIRCLE_ID),
      createdAt: now()
    };
    await this.store.putPerson(auth.userId, person);
    return person;
  }

  async updatePerson(personId: string, body: unknown, auth: AuthContext): Promise<AtlasPerson> {
    const input = parseWith(updatePersonSchema, body);
    const existing = await this.store.getPerson(auth.userId, personId);
    if (!existing) throw new NotFoundError("Person not found");
    const circles = await this.circleIdSet(auth.userId);
    const person: AtlasPerson = {
      ...existing,
      name: input.name ?? existing.name,
      circleIds:
        input.circleIds?.filter((c) => circles.has(c) && c !== ATLAS_SOLO_CIRCLE_ID) ??
        existing.circleIds
    };
    await this.store.putPerson(auth.userId, person);
    return person;
  }

  async deletePerson(personId: string, auth: AuthContext): Promise<void> {
    const records = await this.store.loadAll(auth.userId);
    const rewrites = records.trips
      .filter((t) => t.personIds.includes(personId))
      .map((t) => ({
        kind: "trip" as const,
        value: { ...t, personIds: t.personIds.filter((p) => p !== personId) }
      }));
    await this.store.putMany(auth.userId, rewrites);
    await this.store.deletePerson(auth.userId, personId);
  }

  // ---------------------------------------------------------------- wishes

  async createWish(body: unknown, auth: AuthContext): Promise<AtlasWish> {
    const input = parseWith(wishSchema, body);
    const circles = await this.circleIdSet(auth.userId);
    const wish: AtlasWish = {
      wishId: id("wish"),
      place: input.place,
      circleIds: input.circleIds.filter((c) => circles.has(c)),
      note: input.note || undefined,
      createdAt: now()
    };
    await this.store.putWish(auth.userId, wish);
    return wish;
  }

  async updateWish(wishId: string, body: unknown, auth: AuthContext): Promise<AtlasWish> {
    const input = parseWith(updateWishSchema, body);
    const existing = await this.store.getWish(auth.userId, wishId);
    if (!existing) throw new NotFoundError("Wish not found");
    if (input.fulfilledByTripId) {
      const trip = await this.store.getTrip(auth.userId, input.fulfilledByTripId);
      if (!trip) throw new ValidationError("fulfilledByTripId: trip not found");
    }
    const circles =
      input.circleIds !== undefined ? await this.circleIdSet(auth.userId) : undefined;
    const wish: AtlasWish = {
      ...existing,
      place: input.place ?? existing.place,
      circleIds: circles
        ? (input.circleIds ?? []).filter((c) => circles.has(c))
        : existing.circleIds,
      note: input.note === undefined ? existing.note : input.note || undefined,
      fulfilledByTripId:
        input.fulfilledByTripId === undefined
          ? existing.fulfilledByTripId
          : input.fulfilledByTripId || undefined
    };
    await this.store.putWish(auth.userId, wish);
    return wish;
  }

  async deleteWish(wishId: string, auth: AuthContext): Promise<void> {
    await this.store.deleteWish(auth.userId, wishId);
  }

  // ---------------------------------------------------------------- profile

  async updateProfile(body: unknown, auth: AuthContext): Promise<AtlasProfile> {
    const input = parseWith(profileSchema, body);
    const existing = (await this.store.getProfile(auth.userId)) ?? DEFAULT_PROFILE;
    const profile: AtlasProfile = {
      ...existing,
      homePlace: input.homePlace === undefined ? existing.homePlace : input.homePlace ?? undefined,
      units: input.units ?? existing.units,
      lastLens: input.lastLens === undefined ? existing.lastLens : input.lastLens ?? undefined
    };
    await this.store.putProfile(auth.userId, profile);
    return profile;
  }
}
