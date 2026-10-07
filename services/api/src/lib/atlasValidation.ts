import { z } from "zod";
import {
  ATLAS_CIRCLE_COLORS,
  ATLAS_COUNTRIES,
  ATLAS_SOLO_CIRCLE_ID,
  type AtlasDatePrecision
} from "@utility-platform/shared";
import { ValidationError } from "./errors.js";

// Request schemas and pure normalizers for Atlas. Kept free of I/O so the
// rules (fuzzy dates, solo exclusivity, place shape) are unit-testable.

const FUZZY_DATE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

export const placeSchema = z.object({
  providerId: z.string().min(1).max(512),
  name: z.string().trim().min(1).max(160),
  kind: z.enum(["city", "region", "country", "airport", "poi"]),
  locality: z.string().trim().max(160).optional(),
  regionCode: z
    .string()
    .regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/, "regionCode must look like US-CA")
    .optional(),
  regionName: z.string().trim().max(160).optional(),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .refine((code) => code in ATLAS_COUNTRIES, "Unknown country code"),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  iata: z.string().regex(/^[A-Z]{3}$/).optional()
});

const idList = (max: number) => z.array(z.string().min(1).max(64)).max(max);

const legSchema = z.object({
  legId: z.string().min(1).max(64).optional(),
  mode: z.enum(["flight", "drive", "train", "boat", "other"]),
  from: placeSchema,
  to: placeSchema,
  airline: z.string().trim().max(80).optional(),
  flightNumber: z.string().trim().max(16).optional()
});

const tripFields = {
  title: z.string().trim().min(1).max(120),
  start: z.string().regex(FUZZY_DATE, "start must be YYYY, YYYY-MM or YYYY-MM-DD"),
  end: z
    .string()
    .regex(FUZZY_DATE, "end must be YYYY, YYYY-MM or YYYY-MM-DD")
    .nullable()
    .optional(),
  circleIds: idList(12).default([]),
  personIds: idList(60).default([]),
  stops: z
    .array(z.object({ stopId: z.string().min(1).max(64).optional(), place: placeSchema }))
    .max(60)
    .default([]),
  legs: z.array(legSchema).max(40).default([]),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  coverKey: z.string().max(300).nullable().optional(),
  expenseTripId: z.string().max(64).nullable().optional()
};

export const createTripSchema = z.object(tripFields);
export const updateTripSchema = z.object(tripFields).partial();

export const circleSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.enum(ATLAS_CIRCLE_COLORS),
  sortOrder: z.number().int().min(0).max(1000).optional()
});
export const updateCircleSchema = circleSchema.partial();

export const personSchema = z.object({
  name: z.string().trim().min(1).max(80),
  circleIds: idList(12).default([])
});
export const updatePersonSchema = personSchema.partial();

export const wishSchema = z.object({
  place: placeSchema,
  circleIds: idList(12).default([]),
  note: z.string().max(500).nullable().optional()
});
export const updateWishSchema = wishSchema.partial().extend({
  fulfilledByTripId: z.string().max(64).nullable().optional()
});

const lensSchema = z.object({
  mode: z.enum(["footprint", "flights"]),
  circle: z.string().min(1).max(64),
  fromYear: z.number().int().min(1900).max(2100).optional(),
  toYear: z.number().int().min(1900).max(2100).optional()
});

export const profileSchema = z.object({
  homePlace: placeSchema.nullable().optional(),
  units: z.enum(["mi", "km"]).optional(),
  lastLens: lensSchema.nullable().optional()
});

export const uploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().regex(/^image\/(jpeg|png|webp|heic|heif)$/, "Cover must be an image")
});

export const quickAddSchema = z.object({
  text: z.string().trim().min(1).max(4000)
});

export const parseWith = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown): T => {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
    throw new ValidationError(`${where}${issue.message}`);
  }
  return result.data;
};

/** Precision follows the shape of the start date: "2018" is a year. */
export const precisionOf = (start: string): AtlasDatePrecision =>
  start.length === 4 ? "year" : start.length === 7 ? "month" : "day";

/**
 * Normalizes a trip's dates: end is dropped unless it is a full day at the
 * same precision as start, and must not come before it.
 */
export const normalizeDates = (
  start: string,
  end: string | null | undefined
): { start: string; end?: string; datePrecision: AtlasDatePrecision } => {
  const datePrecision = precisionOf(start);
  if (!end || datePrecision !== "day" || end.length !== 10) {
    return { start, datePrecision };
  }
  if (end < start) throw new ValidationError("end must not be before start");
  return { start, end: end === start ? undefined : end, datePrecision };
};

/**
 * Solo means "no companions", so it can't share a trip with another circle;
 * when both are sent, the explicit companions win. Unknown ids are dropped.
 */
export const normalizeCircleIds = (
  circleIds: string[],
  knownCircleIds: Set<string>
): string[] => {
  const known = [...new Set(circleIds)].filter((id) => knownCircleIds.has(id));
  const others = known.filter((id) => id !== ATLAS_SOLO_CIRCLE_ID);
  return others.length ? others : known;
};

/** Cover keys must live under the caller's own atlas prefix. */
export const assertOwnCoverKey = (userId: string, key: string | null | undefined) => {
  if (key && !key.startsWith(`atlas/${userId}/`)) {
    throw new ValidationError("coverKey does not belong to you");
  }
};
