// Split-link API bindings. The authed route (mint/revoke a link) rides the
// shared `api` client; the /split-public routes deliberately skip it —
// guests on /s/<shareId> have no Amplify session, so those calls go out
// with no Authorization header and authenticate writes via the per-guest
// secret issued at join time (mirroring the Meet respond page).

import { api, ApiError } from "./api";
import { appConfig } from "../config";
import type {
  ExpenseSplitLink,
  SplitLinkJoinResponse,
  SplitLinkSnapshot
} from "../types";

export const splitLinkApi = {
  getOrCreate: (tripId: string, expenseId: string) =>
    api.get<{ link: ExpenseSplitLink }>(
      `/trips/${tripId}/expenses/${expenseId}/split-link`
    ),
  revoke: (tripId: string, expenseId: string) =>
    api.delete<void>(`/trips/${tripId}/expenses/${expenseId}/split-link`),
  /** Signed-in join: binds the claim session to the caller's account and
   *  adds them to the trip if they aren't on it yet. Pass claimMemberId to
   *  merge an unclaimed placeholder ("Are you Sarah?") into the account. */
  claimSession: (shareId: string, claimMemberId?: string) =>
    api.post<SplitLinkJoinResponse>(
      `/split-links/${shareId}/session`,
      claimMemberId ? { claimMemberId } : {}
    )
};

export const splitLinkUrl = (shareId: string): string =>
  `${window.location.origin}/s/${shareId}`;

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

export const splitPublicApi = {
  get: (shareId: string) =>
    publicRequest<SplitLinkSnapshot>("GET", `/split-public/${shareId}`),
  join: (shareId: string, input: { memberId?: string; name?: string }) =>
    publicRequest<SplitLinkJoinResponse>(
      "POST",
      `/split-public/${shareId}/guests`,
      { body: input }
    ),
  saveClaims: (
    shareId: string,
    memberId: string,
    secret: string,
    lineItemIds: string[]
  ) =>
    publicRequest<SplitLinkSnapshot>(
      "PUT",
      `/split-public/${shareId}/guests/${memberId}/claims`,
      { body: { lineItemIds }, headers: { "x-split-guest-secret": secret } }
    ),
  complete: (shareId: string, memberId: string, secret: string) =>
    publicRequest<SplitLinkSnapshot>(
      "POST",
      `/split-public/${shareId}/guests/${memberId}/complete`,
      { headers: { "x-split-guest-secret": secret } }
    ),
  /** Walk back "I've paid" — allowed until the payer confirms. */
  uncomplete: (shareId: string, memberId: string, secret: string) =>
    publicRequest<SplitLinkSnapshot>(
      "POST",
      `/split-public/${shareId}/guests/${memberId}/uncomplete`,
      { headers: { "x-split-guest-secret": secret } }
    )
};

// Guest identity for the public claim page, keyed by shareId so one browser
// can hold claims on several bills. The secret is issued exactly once.
export interface SplitGuestIdentity {
  memberId: string;
  secret: string;
  displayName: string;
}

const guestKey = (shareId: string) => `split-guest:${shareId}`;

export const loadSplitGuest = (shareId: string): SplitGuestIdentity | null => {
  try {
    const raw = window.localStorage.getItem(guestKey(shareId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SplitGuestIdentity>;
    if (!parsed.memberId || !parsed.secret) return null;
    return {
      memberId: parsed.memberId,
      secret: parsed.secret,
      displayName: parsed.displayName ?? ""
    };
  } catch {
    return null;
  }
};

export const saveSplitGuest = (
  shareId: string,
  identity: SplitGuestIdentity
) => {
  try {
    window.localStorage.setItem(guestKey(shareId), JSON.stringify(identity));
  } catch {
    // Private-mode storage failures just mean the visitor re-joins next time.
  }
};

export const clearSplitGuest = (shareId: string) => {
  try {
    window.localStorage.removeItem(guestKey(shareId));
  } catch {
    // ignore
  }
};
