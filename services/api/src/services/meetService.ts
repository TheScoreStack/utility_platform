import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  MeetStore,
  type MeetSummary,
  type StoredMeetParticipant
} from "../data/meetStore.js";
import { UserStore } from "../data/userStore.js";
import {
  MeetEvent,
  MeetParticipant,
  MeetSlotRef,
  MeetSuggestion,
  UserProfile,
  MEET_SLOT_MINUTES_OPTIONS,
  normalizeMeetAvailability,
  suggestMeetSlots
} from "../types.js";
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError
} from "../lib/errors.js";
import type { AuthContext } from "../auth.js";

let meetStoreInstance: MeetStore | null = null;
let userStoreInstance: UserStore | null = null;

const getMeetStore = (): MeetStore => {
  if (!meetStoreInstance) {
    meetStoreInstance = new MeetStore();
  }
  return meetStoreInstance;
};

const getUserStore = (): UserStore => {
  if (!userStoreInstance) {
    userStoreInstance = new UserStore();
  }
  return userStoreInstance;
};

const isoNow = () => new Date().toISOString();

const ensureCurrentUserProfile = (auth: AuthContext) =>
  getUserStore().ensureUserProfile(auth);

const getDisplayName = (profile: UserProfile): string =>
  profile.displayName ?? profile.email ?? profile.userId;

const MAX_PARTICIPANTS = 100;
const SUGGESTION_LIMIT = 3;

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD");

const settingsSchema = z.object({
  responseDeadline: z.string().optional(),
  quorum: z.number().int().positive().optional(),
  allowIfNeedBe: z.boolean().optional(),
  locked: z.boolean().optional()
});

const createEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().optional(),
  mode: z.enum(["time-grid", "all-day"]),
  timezone: z.string().min(1),
  dates: z.array(dateSchema).min(1).max(60),
  startMinute: z.number().int().optional(),
  endMinute: z.number().int().optional(),
  slotMinutes: z.number().int().optional(),
  settings: settingsSchema.optional()
});

const updateEventSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().optional(),
    settings: settingsSchema.optional()
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.settings !== undefined,
    { message: "No updates provided" }
  );

const finalizeSchema = z.object({
  date: dateSchema,
  startMinute: z.number().int(),
  endMinute: z.number().int()
});

const availabilitySchema = z.object({
  availability: z.record(z.string(), z.string()),
  displayName: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().min(1).optional()
});

const joinSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  timezone: z.string().min(1).optional()
});

export interface ParsedMeetEventInput {
  title: string;
  description?: string;
  mode: MeetEvent["mode"];
  timezone: string;
  dates: string[];
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  settings?: MeetEvent["settings"];
}

/** Validates and normalizes a create-event body: dates dedupe + sort
 *  ascending, "all-day" forces the full-day pseudo-grid, and "time-grid"
 *  windows must align with the slot size. Pure, so it's unit-testable. */
export const parseCreateMeetEventInput = (
  body: unknown
): ParsedMeetEventInput => {
  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.message);
  }

  const dates = Array.from(new Set(parsed.data.dates)).sort();

  if (parsed.data.mode === "all-day") {
    return {
      title: parsed.data.title,
      description: parsed.data.description,
      mode: "all-day",
      timezone: parsed.data.timezone,
      dates,
      startMinute: 0,
      endMinute: 24 * 60,
      slotMinutes: 24 * 60,
      settings: parsed.data.settings
    };
  }

  const slotMinutes = parsed.data.slotMinutes ?? 30;
  if (
    !(MEET_SLOT_MINUTES_OPTIONS as readonly number[]).includes(slotMinutes)
  ) {
    throw new ValidationError(
      `slotMinutes must be one of ${MEET_SLOT_MINUTES_OPTIONS.join(", ")}`
    );
  }
  const startMinute = parsed.data.startMinute ?? 0;
  const endMinute = parsed.data.endMinute ?? 24 * 60;
  if (startMinute < 0 || endMinute > 24 * 60 || startMinute >= endMinute) {
    throw new ValidationError(
      "Grid window must satisfy 0 <= startMinute < endMinute <= 1440"
    );
  }
  if (startMinute % slotMinutes !== 0 || endMinute % slotMinutes !== 0) {
    throw new ValidationError(
      "startMinute and endMinute must be multiples of slotMinutes"
    );
  }

  return {
    title: parsed.data.title,
    description: parsed.data.description,
    mode: "time-grid",
    timezone: parsed.data.timezone,
    dates,
    startMinute,
    endMinute,
    slotMinutes,
    settings: parsed.data.settings
  };
};

/** Checks a finalize target against the event's grid: the date must be a
 *  candidate and the window must start/end on slot boundaries inside it. */
export const assertValidMeetFinalizeSlot = (
  event: Pick<
    MeetEvent,
    "mode" | "dates" | "startMinute" | "endMinute" | "slotMinutes"
  >,
  slot: MeetSlotRef
): void => {
  if (!event.dates.includes(slot.date)) {
    throw new ValidationError(
      `${slot.date} is not a candidate date for this event`
    );
  }
  if (event.mode === "all-day") {
    if (slot.startMinute !== 0 || slot.endMinute !== 24 * 60) {
      throw new ValidationError(
        "All-day events finalize to the whole day (0-1440)"
      );
    }
    return;
  }
  if (
    slot.startMinute < event.startMinute ||
    slot.endMinute > event.endMinute ||
    slot.startMinute >= slot.endMinute
  ) {
    throw new ValidationError("Finalized window falls outside the grid");
  }
  if (
    (slot.startMinute - event.startMinute) % event.slotMinutes !== 0 ||
    (slot.endMinute - event.startMinute) % event.slotMinutes !== 0
  ) {
    throw new ValidationError(
      "Finalized window must align with the slot grid"
    );
  }
};

export const hashMeetSecret = (secret: string): string =>
  createHash("sha256").update(secret, "utf8").digest("hex");

/** Constant-time comparison of a presented guest secret against the stored
 *  sha256 hex hash. */
export const verifyMeetSecret = (
  secret: string,
  secretHash: string
): boolean => {
  const presented = Buffer.from(hashMeetSecret(secret), "hex");
  const stored = Buffer.from(secretHash, "hex");
  if (presented.length !== stored.length || stored.length === 0) {
    return false;
  }
  return timingSafeEqual(presented, stored);
};

/** What anonymous respond pages may see about a participant: no userId, no
 *  email, and never the secret hash. */
export interface PublicMeetParticipant {
  participantId: string;
  displayName: string;
  timezone?: string;
  role: MeetParticipant["role"];
  availability: MeetParticipant["availability"];
  respondedAt?: string;
}

export const sanitizeMeetParticipantPublic = (
  participant: StoredMeetParticipant
): PublicMeetParticipant => ({
  participantId: participant.participantId,
  displayName: participant.displayName,
  timezone: participant.timezone,
  role: participant.role,
  availability: participant.availability,
  respondedAt: participant.respondedAt
});

/** Authed view: the secret hash is always stripped; userId and email are
 *  included only on the caller's own row. */
export const sanitizeMeetParticipantForUser = (
  participant: StoredMeetParticipant,
  callerUserId: string
): MeetParticipant => {
  const isSelf = participant.userId === callerUserId;
  return {
    eventId: participant.eventId,
    participantId: participant.participantId,
    displayName: participant.displayName,
    userId: isSelf ? participant.userId : undefined,
    email: isSelf ? participant.email : undefined,
    timezone: participant.timezone,
    role: participant.role,
    availability: participant.availability,
    respondedAt: participant.respondedAt,
    createdAt: participant.createdAt,
    updatedAt: participant.updatedAt
  };
};

export interface MeetEventDetail {
  event: MeetEvent;
  participants: MeetParticipant[];
  suggestions: MeetSuggestion[];
}

export interface PublicMeetEventResponse {
  event: MeetEvent;
  participants: PublicMeetParticipant[];
  suggestions: MeetSuggestion[];
  version: number;
}

export interface PublicMeetUnchangedResponse {
  version: number;
  unchanged: true;
}

export class MeetService {
  async createEvent(body: unknown, auth: AuthContext): Promise<MeetEvent> {
    const input = parseCreateMeetEventInput(body);
    const organizerProfile = await ensureCurrentUserProfile(auth);

    const now = isoNow();
    const event: MeetEvent = {
      eventId: `meet_${nanoid(10)}`,
      slug: `mt_${nanoid(14)}`,
      organizerId: auth.userId,
      organizerName: getDisplayName(organizerProfile),
      title: input.title,
      description: input.description,
      mode: input.mode,
      timezone: input.timezone,
      dates: input.dates,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      slotMinutes: input.slotMinutes,
      settings: input.settings,
      status: "open",
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    const organizer: MeetParticipant = {
      eventId: event.eventId,
      participantId: auth.userId,
      displayName: getDisplayName(organizerProfile),
      userId: auth.userId,
      email: organizerProfile.email,
      role: "organizer",
      availability: normalizeMeetAvailability(event, undefined),
      createdAt: now,
      updatedAt: now
    };

    await getMeetStore().createEvent(event, organizer);
    return event;
  }

  async listEvents(auth: AuthContext): Promise<MeetSummary[]> {
    await ensureCurrentUserProfile(auth);
    return getMeetStore().listMeetsForUser(auth.userId);
  }

  async getEvent(
    eventId: string,
    auth: AuthContext
  ): Promise<MeetEventDetail> {
    await ensureCurrentUserProfile(auth);
    const event = await getMeetStore().getEvent(eventId);
    const participants = await getMeetStore().listParticipants(eventId);
    const isParticipant = participants.some(
      (participant) => participant.userId === auth.userId
    );
    if (!isParticipant) {
      throw new ForbiddenError("You do not have access to this event");
    }

    return {
      event,
      participants: participants.map((participant) =>
        sanitizeMeetParticipantForUser(participant, auth.userId)
      ),
      suggestions: suggestMeetSlots(event, participants, SUGGESTION_LIMIT)
    };
  }

  async updateEvent(
    eventId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<MeetEvent> {
    const parsed = updateEventSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    await ensureCurrentUserProfile(auth);
    const event = await getMeetStore().getEvent(eventId);
    if (event.organizerId !== auth.userId) {
      throw new ForbiddenError("Only the organizer can edit this event");
    }

    const updatedAt = isoNow();
    await getMeetStore().updateEventFields(eventId, {
      title: parsed.data.title,
      description: parsed.data.description,
      settings: parsed.data.settings,
      updatedAt
    });

    if (parsed.data.title !== undefined && parsed.data.title !== event.title) {
      const participants = await getMeetStore().listParticipants(eventId);
      await getMeetStore().updateParticipantsDenorm(eventId, participants, {
        title: parsed.data.title
      });
    }

    return {
      ...event,
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
      ...(parsed.data.settings !== undefined
        ? { settings: parsed.data.settings }
        : {}),
      version: event.version + 1,
      updatedAt
    };
  }

  async deleteEvent(eventId: string, auth: AuthContext): Promise<void> {
    await ensureCurrentUserProfile(auth);
    const event = await getMeetStore().getEvent(eventId);
    if (event.organizerId !== auth.userId) {
      throw new ForbiddenError("Only the organizer can delete this event");
    }
    await getMeetStore().deleteEvent(event);
  }

  async finalizeEvent(
    eventId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<MeetEvent> {
    const parsed = finalizeSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    await ensureCurrentUserProfile(auth);
    const event = await getMeetStore().getEvent(eventId);
    if (event.organizerId !== auth.userId) {
      throw new ForbiddenError("Only the organizer can finalize this event");
    }

    const slot: MeetSlotRef = {
      date: parsed.data.date,
      startMinute: parsed.data.startMinute,
      endMinute: parsed.data.endMinute
    };
    assertValidMeetFinalizeSlot(event, slot);

    const updatedAt = isoNow();
    await getMeetStore().finalizeEvent(eventId, slot, updatedAt);
    const participants = await getMeetStore().listParticipants(eventId);
    await getMeetStore().updateParticipantsDenorm(eventId, participants, {
      status: "finalized"
    });

    return {
      ...event,
      status: "finalized",
      finalizedSlot: slot,
      version: event.version + 1,
      updatedAt
    };
  }

  async reopenEvent(eventId: string, auth: AuthContext): Promise<MeetEvent> {
    await ensureCurrentUserProfile(auth);
    const event = await getMeetStore().getEvent(eventId);
    if (event.organizerId !== auth.userId) {
      throw new ForbiddenError("Only the organizer can reopen this event");
    }

    const updatedAt = isoNow();
    await getMeetStore().reopenEvent(eventId, updatedAt);
    const participants = await getMeetStore().listParticipants(eventId);
    await getMeetStore().updateParticipantsDenorm(eventId, participants, {
      status: "open"
    });

    return {
      ...event,
      status: "open",
      finalizedSlot: undefined,
      version: event.version + 1,
      updatedAt
    };
  }

  /** Upserts the signed-in caller's response, keyed by userId. First write
   *  joins the event (unless it's locked); every write is normalized to the
   *  event's grid. */
  async putMyAvailability(
    eventId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<MeetParticipant> {
    const parsed = availabilitySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const profile = await ensureCurrentUserProfile(auth);
    const event = await getMeetStore().getEvent(eventId);
    const availability = normalizeMeetAvailability(
      event,
      parsed.data.availability
    );
    const now = isoNow();

    const existing = await getMeetStore().getParticipant(
      eventId,
      auth.userId
    );
    if (existing) {
      const updated: StoredMeetParticipant = {
        ...existing,
        displayName: parsed.data.displayName ?? existing.displayName,
        timezone: parsed.data.timezone ?? existing.timezone,
        availability,
        respondedAt: now,
        updatedAt: now
      };
      await getMeetStore().updateParticipant(event, updated);
      return sanitizeMeetParticipantForUser(updated, auth.userId);
    }

    if (event.settings?.locked) {
      throw new ConflictError("This event is locked to new participants");
    }
    const participants = await getMeetStore().listParticipants(eventId);
    if (participants.length >= MAX_PARTICIPANTS) {
      throw new ConflictError("This event is full");
    }

    const participant: StoredMeetParticipant = {
      eventId,
      participantId: auth.userId,
      displayName: parsed.data.displayName ?? getDisplayName(profile),
      userId: auth.userId,
      email: profile.email,
      timezone: parsed.data.timezone,
      role: "participant",
      availability,
      respondedAt: now,
      createdAt: now,
      updatedAt: now
    };
    await getMeetStore().createParticipant(event, participant);
    return sanitizeMeetParticipantForUser(participant, auth.userId);
  }

  // ---------- Public (unauthenticated) respond-page routes ----------

  private async getEventBySlug(slug: string): Promise<MeetEvent> {
    const eventId = await getMeetStore().getEventIdBySlug(slug);
    if (!eventId) {
      throw new NotFoundError("This event link is no longer valid");
    }
    return getMeetStore().getEvent(eventId);
  }

  async getPublicEvent(
    slug: string,
    since?: string
  ): Promise<PublicMeetEventResponse | PublicMeetUnchangedResponse> {
    const event = await this.getEventBySlug(slug);

    // Cheap polling: when the caller's version is current, skip the
    // participant query entirely.
    if (since !== undefined && Number(since) === event.version) {
      return { version: event.version, unchanged: true };
    }

    const participants = await getMeetStore().listParticipants(
      event.eventId
    );
    return {
      event,
      participants: participants.map((participant) =>
        sanitizeMeetParticipantPublic(participant)
      ),
      suggestions: suggestMeetSlots(event, participants, SUGGESTION_LIMIT),
      version: event.version
    };
  }

  /** Guest join: creates a participant and returns the secret exactly once;
   *  only its sha256 hash is stored. */
  async joinPublicEvent(
    slug: string,
    body: unknown
  ): Promise<{ participant: PublicMeetParticipant; secret: string }> {
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const event = await this.getEventBySlug(slug);
    if (event.settings?.locked) {
      throw new ConflictError("This event is locked to new participants");
    }
    if (event.status === "finalized") {
      throw new ConflictError("This event has already been finalized");
    }
    const participants = await getMeetStore().listParticipants(
      event.eventId
    );
    if (participants.length >= MAX_PARTICIPANTS) {
      throw new ConflictError("This event is full");
    }

    const secret = nanoid(32);
    const now = isoNow();
    const participant: StoredMeetParticipant = {
      eventId: event.eventId,
      participantId: `pt_${nanoid(10)}`,
      displayName: parsed.data.displayName,
      timezone: parsed.data.timezone,
      role: "participant",
      availability: normalizeMeetAvailability(event, undefined),
      secretHash: hashMeetSecret(secret),
      createdAt: now,
      updatedAt: now
    };
    await getMeetStore().createParticipant(event, participant);

    return {
      participant: sanitizeMeetParticipantPublic(participant),
      secret
    };
  }

  /** Guest availability write, authenticated by the participant secret. */
  async putGuestAvailability(
    slug: string,
    participantId: string,
    secret: string | undefined,
    body: unknown
  ): Promise<PublicMeetParticipant> {
    const parsed = availabilitySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const event = await this.getEventBySlug(slug);
    const participant = await getMeetStore().getParticipant(
      event.eventId,
      participantId
    );
    if (!participant) {
      throw new NotFoundError("Participant not found");
    }
    // Signed-in rows are managed through the authed route only.
    if (participant.userId || !participant.secretHash) {
      throw new ForbiddenError("Invalid participant secret");
    }
    if (!secret || !verifyMeetSecret(secret, participant.secretHash)) {
      throw new ForbiddenError("Invalid participant secret");
    }

    const now = isoNow();
    const updated: StoredMeetParticipant = {
      ...participant,
      displayName: parsed.data.displayName ?? participant.displayName,
      timezone: parsed.data.timezone ?? participant.timezone,
      availability: normalizeMeetAvailability(
        event,
        parsed.data.availability
      ),
      respondedAt: now,
      updatedAt: now
    };
    await getMeetStore().updateParticipant(event, updated);
    return sanitizeMeetParticipantPublic(updated);
  }
}
