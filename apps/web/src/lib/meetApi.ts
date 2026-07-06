// Meet module API bindings. Authed organizer/participant routes ride the
// shared `api` client (Cognito JWT); the /meet-public routes deliberately
// skip it — guests on /m/<slug> have no Amplify session, so those calls go
// out with no Authorization header and authenticate writes via the
// per-participant secret issued at join time.

import { api, ApiError } from "./api";
import { appConfig } from "../config";
import type {
  MeetAvailability,
  MeetEventDetailResponse,
  MeetEventResponse,
  MeetEventSettings,
  MeetJoinResponse,
  MeetListResponse,
  MeetMode,
  MeetPublicPollResponse,
  MeetPublicSnapshot
} from "../types";

export interface CreateMeetEventInput {
  title: string;
  description?: string;
  mode: MeetMode;
  timezone: string;
  dates: string[];
  startMinute?: number;
  endMinute?: number;
  slotMinutes?: number;
  settings?: MeetEventSettings;
}

export interface UpdateMeetEventInput {
  title?: string;
  description?: string;
  settings?: MeetEventSettings;
}

export interface SaveAvailabilityInput {
  availability: MeetAvailability;
  displayName?: string;
  timezone?: string;
}

export const meetApi = {
  list: () => api.get<MeetListResponse>("/meet/events"),
  create: (input: CreateMeetEventInput) =>
    api.post<MeetEventResponse>("/meet/events", input),
  detail: (eventId: string) =>
    api.get<MeetEventDetailResponse>(`/meet/events/${eventId}`),
  update: (eventId: string, input: UpdateMeetEventInput) =>
    api.patch<MeetEventResponse>(`/meet/events/${eventId}`, input),
  remove: (eventId: string) => api.delete<void>(`/meet/events/${eventId}`),
  finalize: (
    eventId: string,
    slot: { date: string; startMinute: number; endMinute: number }
  ) => api.post<MeetEventResponse>(`/meet/events/${eventId}/finalize`, slot),
  reopen: (eventId: string) =>
    api.post<MeetEventResponse>(`/meet/events/${eventId}/reopen`),
  saveAvailability: (eventId: string, input: SaveAvailabilityInput) =>
    api.put<{ participant: MeetEventDetailResponse["participants"][number] }>(
      `/meet/events/${eventId}/availability`,
      input
    )
};

// ---------------------------------------------------------------- public

const publicRequest = async <T>(
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {}
): Promise<T> => {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${appConfig.apiUrl}${path}`, {
    method,
    headers,
    body
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : (undefined as T);
  if (!response.ok) {
    const message = (data as { message?: string } | undefined)?.message;
    throw new ApiError(message ?? response.statusText, response.status);
  }
  return data;
};

export const meetPublicApi = {
  get: (slug: string) =>
    publicRequest<MeetPublicSnapshot>("GET", `/meet-public/${slug}`),
  poll: (slug: string, since: number) =>
    publicRequest<MeetPublicPollResponse>(
      "GET",
      `/meet-public/${slug}?since=${since}`
    ),
  join: (slug: string, input: { displayName: string; timezone?: string }) =>
    publicRequest<MeetJoinResponse>(
      "POST",
      `/meet-public/${slug}/participants`,
      { body: input }
    ),
  saveAvailability: (
    slug: string,
    participantId: string,
    secret: string,
    input: SaveAvailabilityInput
  ) =>
    publicRequest<{ participant: MeetPublicSnapshot["participants"][number] }>(
      "PUT",
      `/meet-public/${slug}/participants/${participantId}/availability`,
      { body: input, headers: { "x-meet-participant-secret": secret } }
    )
};

// Guest identity for the public respond page, keyed by slug so one browser
// can hold rows on several events. The secret is issued exactly once.
export interface MeetGuestIdentity {
  participantId: string;
  secret: string;
  displayName: string;
}

const guestKey = (slug: string) => `meet-respondent:${slug}`;

export const loadMeetGuest = (slug: string): MeetGuestIdentity | null => {
  try {
    const raw = window.localStorage.getItem(guestKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MeetGuestIdentity>;
    if (!parsed.participantId || !parsed.secret) return null;
    return {
      participantId: parsed.participantId,
      secret: parsed.secret,
      displayName: parsed.displayName ?? ""
    };
  } catch {
    return null;
  }
};

export const saveMeetGuest = (slug: string, identity: MeetGuestIdentity) => {
  try {
    window.localStorage.setItem(guestKey(slug), JSON.stringify(identity));
  } catch {
    // Private-mode storage failures just mean the visitor re-joins next time.
  }
};

export const clearMeetGuest = (slug: string) => {
  try {
    window.localStorage.removeItem(guestKey(slug));
  } catch {
    // ignore
  }
};
