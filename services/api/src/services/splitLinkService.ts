// Split links: an itemized expense gets a public URL where guests — no
// account, no app — pick the items they had, see their share (items plus
// tax/tip pro-rated against the whole bill), get the payer's payment
// handles, and mark the payment sent. Access control is capability-based
// like Meet respond links: unguessable shareId + per-guest secret.

import { nanoid } from "nanoid";
import { z } from "zod";
import { applyGuestClaims, computeSplitShares } from "../lib/splitClaims.js";
import { TripStore, type TripDetails } from "../data/tripStore.js";
import {
  SplitLinkStore,
  type StoredSplitLinkGuest
} from "../data/splitLinkStore.js";
import { UserStore } from "../data/userStore.js";
import type {
  Expense,
  ExpenseSplitLink,
  Settlement,
  SplitLinkJoinResponse,
  SplitLinkSnapshot,
  TripMember
} from "../types.js";
import {
  ValidationError,
  ForbiddenError,
  NotFoundError
} from "../lib/errors.js";
import { hashMeetSecret, verifyMeetSecret } from "./meetService.js";
import { TripService } from "./tripService.js";
import { notifyUsersSafely } from "./pushService.js";
import type { AuthContext } from "../auth.js";

let tripStoreInstance: TripStore | null = null;
let splitLinkStoreInstance: SplitLinkStore | null = null;
let userStoreInstance: UserStore | null = null;

const getTripStore = (): TripStore => {
  if (!tripStoreInstance) {
    tripStoreInstance = new TripStore();
  }
  return tripStoreInstance;
};

const getSplitLinkStore = (): SplitLinkStore => {
  if (!splitLinkStoreInstance) {
    splitLinkStoreInstance = new SplitLinkStore();
  }
  return splitLinkStoreInstance;
};

const getUserStore = (): UserStore => {
  if (!userStoreInstance) {
    userStoreInstance = new UserStore();
  }
  return userStoreInstance;
};

const isoNow = () => new Date().toISOString();

const firstName = (name: string): string =>
  name.trim().split(/\s+/)[0] || name;

const formatAmount = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};

const joinSchema = z
  .object({
    memberId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(60).optional()
  })
  .refine((value) => Boolean(value.memberId) !== Boolean(value.name), {
    message: "Send either a memberId or a name"
  });

const claimsSchema = z.object({
  lineItemIds: z.array(z.string().min(1))
});

const sessionSchema = z
  .object({
    // Merge an unclaimed placeholder member ("Are you Sarah?") into the
    // signed-in account while joining.
    claimMemberId: z.string().min(1).optional()
  })
  .nullable()
  .optional();

interface SplitLinkContext {
  link: ExpenseSplitLink;
  details: TripDetails;
  expense: Expense;
}

export class SplitLinkService {
  // ------------------------------------------------------------- authed

  /** Fetch-or-create, like trip invites: any trip member can share an
   *  itemized expense; the link is stable until revoked. */
  async getOrCreateSplitLink(
    tripId: string,
    expenseId: string,
    auth: AuthContext
  ): Promise<ExpenseSplitLink> {
    await getUserStore().ensureUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    if (!details.members.some((m) => m.memberId === auth.userId)) {
      throw new ForbiddenError("You do not have access to this trip");
    }
    const expense = details.expenses.find((e) => e.expenseId === expenseId);
    if (!expense) {
      throw new ValidationError("Expense not found");
    }
    if (!expense.lineItems?.length) {
      throw new ValidationError(
        "Only itemized expenses can be shared as a split link"
      );
    }

    const existing = await getSplitLinkStore().getSplitLinkByExpense(
      tripId,
      expenseId
    );
    if (existing) {
      return existing;
    }

    const link: ExpenseSplitLink = {
      tripId,
      expenseId,
      shareId: `spl_${nanoid(14)}`,
      createdBy: auth.userId,
      createdAt: isoNow()
    };
    await getSplitLinkStore().createSplitLink(link);
    return link;
  }

  /** Kills the link and every guest session under it. Claims already made
   *  and settlements already recorded stay on the expense. */
  async revokeSplitLink(
    tripId: string,
    expenseId: string,
    auth: AuthContext
  ): Promise<void> {
    await getUserStore().ensureUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const link = await getSplitLinkStore().getSplitLinkByExpense(
      tripId,
      expenseId
    );
    if (!link) return;
    if (
      link.createdBy !== auth.userId &&
      details.trip.ownerId !== auth.userId
    ) {
      throw new ForbiddenError(
        "Only whoever shared this link (or the trip owner) can revoke it"
      );
    }
    await getSplitLinkStore().deleteSplitLink(link);
  }

  // ------------------------------------------------------------- public

  private async loadContext(shareId: string): Promise<SplitLinkContext> {
    const link = await getSplitLinkStore().getSplitLinkById(shareId);
    if (!link) {
      throw new NotFoundError("This split link is no longer valid");
    }
    const details = await getTripStore().getTripDetails(link.tripId);
    const expense = details.expenses.find(
      (e) => e.expenseId === link.expenseId
    );
    // Deleted (and draft) expenses fall out of details.expenses — the link
    // dies with them rather than leaking a stale bill.
    if (!expense || !expense.lineItems?.length) {
      throw new NotFoundError("This split link is no longer valid");
    }
    return { link, details, expense };
  }

  private async buildSnapshot(
    context: SplitLinkContext,
    guests?: StoredSplitLinkGuest[]
  ): Promise<SplitLinkSnapshot> {
    const { link, details, expense } = context;
    const payerMember = details.members.find(
      (m) => m.memberId === expense.paidByMemberId
    );
    const payerProfile = payerMember?.placeholder
      ? null
      : await getUserStore().getUser(expense.paidByMemberId);
    const guestRows =
      guests ?? (await getSplitLinkStore().listGuests(link.shareId));

    return {
      shareId: link.shareId,
      expense: {
        description: expense.description,
        vendor: expense.vendor,
        currency: expense.currency,
        total: expense.total,
        tax: expense.tax,
        tip: expense.tip,
        extrasSplitMode: expense.extrasSplitMode ?? "proportional",
        lineItems: (expense.lineItems ?? []).map((item) => ({
          lineItemId: item.lineItemId,
          description: item.description,
          quantity: item.quantity,
          total: item.total,
          assignedMemberIds: item.assignedMemberIds
        }))
      },
      payer: {
        memberId: expense.paidByMemberId,
        displayName: payerMember?.displayName ?? "The payer",
        placeholder: payerMember?.placeholder,
        paymentMethods:
          payerProfile?.paymentMethods ?? payerMember?.paymentMethods
      },
      members: details.members.map((member) => ({
        memberId: member.memberId,
        displayName: member.displayName,
        placeholder: member.placeholder
      })),
      shares: computeSplitShares(expense),
      guests: guestRows.map((guest) => {
        const settlement = guest.settlementId
          ? details.settlements.find(
              (item) => item.settlementId === guest.settlementId
            )
          : undefined;
        return {
          memberId: guest.memberId,
          completedAt: guest.completedAt,
          completedAmount: guest.completedAmount,
          verified: guest.userId ? true : undefined,
          completedConfirmed: settlement?.confirmedAt ? true : undefined
        };
      })
    };
  }

  async getPublicSnapshot(shareId: string): Promise<SplitLinkSnapshot> {
    const context = await this.loadContext(shareId);
    return this.buildSnapshot(context);
  }

  /** Guest picks who they are (an existing member, or a new name that
   *  becomes a placeholder member). Returns the write secret exactly once;
   *  re-joining the same identity rotates the secret so a guest who lost
   *  their device is never locked out. */
  async join(shareId: string, body: unknown): Promise<SplitLinkJoinResponse> {
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const context = await this.loadContext(shareId);
    const { link, details } = context;

    let member: TripMember | undefined;
    if (parsed.data.memberId) {
      member = details.members.find(
        (m) => m.memberId === parsed.data.memberId
      );
      if (!member) {
        throw new ValidationError("That person is not part of this trip");
      }
    } else {
      const name = (parsed.data.name as string).trim();
      // A typed name that matches an existing member IS that member —
      // otherwise "Sarah" joining twice would split into two people.
      member = details.members.find(
        (m) => m.displayName.trim().toLowerCase() === name.toLowerCase()
      );
      if (!member) {
        member = {
          tripId: link.tripId,
          memberId: `pm_${nanoid(10)}`,
          displayName: name,
          addedBy: link.createdBy,
          createdAt: isoNow(),
          placeholder: true
        };
        await getTripStore().addMembers(details.trip, [member]);
      }
    }

    const existing = await getSplitLinkStore().getGuest(
      shareId,
      member.memberId
    );
    // An account-backed claim session can't be displaced by someone who
    // merely knows the name — rotating its secret requires signing in.
    if (existing?.userId) {
      throw new ForbiddenError(
        "That person is claiming from their account — sign in to continue as them"
      );
    }

    const secret = nanoid(32);
    await getSplitLinkStore().putGuest(shareId, {
      memberId: member.memberId,
      displayName: member.displayName,
      createdAt: existing?.createdAt ?? isoNow(),
      completedAt: existing?.completedAt,
      settlementId: existing?.settlementId,
      completedAmount: existing?.completedAmount,
      secretHash: hashMeetSecret(secret)
    });

    return {
      memberId: member.memberId,
      displayName: member.displayName,
      secret
    };
  }

  /** Signed-in join: the claim session is bound to the caller's account.
   *  Account holders who aren't on the trip yet are added as full members
   *  first — possessing the split link is treated as joinable capability,
   *  the same trust level as the invite link every member can share. With
   *  claimMemberId, an unclaimed placeholder ("Sarah") merges into the
   *  account, claims and settlement included. */
  async joinWithAccount(
    shareId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<SplitLinkJoinResponse> {
    const parsed = sessionSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const claimMemberId = parsed.data?.claimMemberId;

    const profile = await getUserStore().ensureUserProfile(auth);
    const context = await this.loadContext(shareId);
    const { link, details } = context;

    let member = details.members.find((m) => m.memberId === auth.userId);
    if (!member) {
      member = {
        tripId: link.tripId,
        memberId: auth.userId,
        displayName: profile.displayName ?? profile.email ?? auth.userId,
        email: profile.email,
        addedBy: link.createdBy,
        createdAt: isoNow()
      };
      await getTripStore().addMembers(details.trip, [member]);
      await notifyUsersSafely(
        details.members
          .filter((m) => !m.placeholder && m.memberId !== auth.userId)
          .map((m) => m.memberId),
        {
          title: details.trip.name,
          body:
            `${firstName(member.displayName)} joined via the ` +
            `${context.expense.description} split link`,
          data: { tripId: link.tripId }
        }
      );
    }

    // Merge the placeholder BEFORE creating the account's guest row: item
    // assignments and the settlement rewrite to the account, and any
    // completion the placeholder had carries over.
    let inherited: StoredSplitLinkGuest | null = null;
    if (claimMemberId && claimMemberId !== auth.userId) {
      await new TripService().claimPlaceholder(link.tripId, claimMemberId, auth);
      inherited = await getSplitLinkStore().getGuest(shareId, claimMemberId);
      if (inherited) {
        await getSplitLinkStore().deleteGuest(shareId, claimMemberId);
      }
    }

    const secret = nanoid(32);
    const existing = await getSplitLinkStore().getGuest(
      shareId,
      member.memberId
    );
    await getSplitLinkStore().putGuest(shareId, {
      memberId: member.memberId,
      displayName: member.displayName,
      createdAt: existing?.createdAt ?? inherited?.createdAt ?? isoNow(),
      userId: auth.userId,
      completedAt: existing?.completedAt ?? inherited?.completedAt,
      settlementId: existing?.settlementId ?? inherited?.settlementId,
      completedAmount:
        existing?.completedAmount ?? inherited?.completedAmount,
      secretHash: hashMeetSecret(secret)
    });

    return {
      memberId: member.memberId,
      displayName: member.displayName,
      secret
    };
  }

  private async requireGuest(
    shareId: string,
    memberId: string,
    secret: string | undefined
  ): Promise<StoredSplitLinkGuest> {
    const guest = await getSplitLinkStore().getGuest(shareId, memberId);
    if (!guest || !secret || !verifyMeetSecret(secret, guest.secretHash)) {
      throw new ForbiddenError("Invalid guest secret");
    }
    return guest;
  }

  /** Replaces the guest's item selection: they're added to every chosen
   *  item (sharing it with anyone else who also picked it) and removed
   *  from the rest. Allocations are re-derived server-side so the stored
   *  expense always balances to the cent. */
  async updateClaims(
    shareId: string,
    memberId: string,
    secret: string | undefined,
    body: unknown
  ): Promise<SplitLinkSnapshot> {
    const parsed = claimsSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const context = await this.loadContext(shareId);
    const { link, expense } = context;
    const guest = await this.requireGuest(shareId, memberId, secret);
    if (guest.completedAt) {
      throw new ValidationError(
        "You already marked this paid — ask whoever covered the bill to adjust it"
      );
    }

    const itemIds = new Set((expense.lineItems ?? []).map((i) => i.lineItemId));
    for (const lineItemId of parsed.data.lineItemIds) {
      if (!itemIds.has(lineItemId)) {
        throw new ValidationError("One of those items is no longer on the bill");
      }
    }

    const lineItems = applyGuestClaims(
      expense.lineItems ?? [],
      memberId,
      new Set(parsed.data.lineItemIds)
    );

    const updatedExpense: Expense = { ...expense, lineItems };
    const allocations = computeSplitShares(updatedExpense).map(
      ({ memberId: id, amount }) => ({ memberId: id, amount })
    );
    const sharedWithMemberIds = expense.sharedWithMemberIds.includes(memberId)
      ? expense.sharedWithMemberIds
      : [...expense.sharedWithMemberIds, memberId];

    await getTripStore().updateExpenseAllocations(
      link.tripId,
      link.expenseId,
      {
        lineItems,
        allocations,
        sharedWithMemberIds,
        updatedAt: isoNow()
      }
    );

    return this.buildSnapshot({
      ...context,
      expense: { ...updatedExpense, allocations, sharedWithMemberIds }
    });
  }

  /** Guest says "I've sent the money": records an unconfirmed settlement to
   *  the payer for their current share and pings the payer to confirm it —
   *  the same flow settlements recorded in-app already follow. */
  async complete(
    shareId: string,
    memberId: string,
    secret: string | undefined
  ): Promise<SplitLinkSnapshot> {
    const context = await this.loadContext(shareId);
    const { link, details, expense } = context;
    const guest = await this.requireGuest(shareId, memberId, secret);

    if (guest.completedAt) {
      return this.buildSnapshot(context);
    }
    if (memberId === expense.paidByMemberId) {
      throw new ValidationError(
        "You covered this bill — there's nothing to pay yourself"
      );
    }

    const share = computeSplitShares(expense).find(
      (row) => row.memberId === memberId
    );
    if (!share || share.amount <= 0) {
      throw new ValidationError("Pick your items before marking it paid");
    }

    const settlement: Settlement = {
      tripId: link.tripId,
      settlementId: `set_${nanoid(10)}`,
      fromMemberId: memberId,
      toMemberId: expense.paidByMemberId,
      amount: share.amount,
      currency: expense.currency,
      note: `Split link · ${expense.description}`,
      createdAt: isoNow(),
      createdBy: memberId,
      splitShareId: shareId
    };
    await getTripStore().saveSettlement(settlement);
    await getSplitLinkStore().markGuestCompleted(shareId, memberId, {
      completedAt: settlement.createdAt,
      settlementId: settlement.settlementId,
      completedAmount: share.amount
    });

    const payerMember = details.members.find(
      (m) => m.memberId === expense.paidByMemberId
    );
    if (payerMember && !payerMember.placeholder) {
      await notifyUsersSafely([payerMember.memberId], {
        title: details.trip.name,
        body:
          `${firstName(guest.displayName)} sent you ` +
          `${formatAmount(share.amount, expense.currency)} for ` +
          `${expense.description} — confirm when it lands`,
        data: { tripId: link.tripId }
      });
    }

    return this.buildSnapshot(context);
  }

  /** Guest walks back "I've paid" — allowed until the payer confirms the
   *  settlement. The settlement is removed outright (it never represented
   *  confirmed money) and the claim session unlocks for edits. */
  async uncomplete(
    shareId: string,
    memberId: string,
    secret: string | undefined
  ): Promise<SplitLinkSnapshot> {
    const context = await this.loadContext(shareId);
    const { link, details, expense } = context;
    const guest = await this.requireGuest(shareId, memberId, secret);

    if (!guest.completedAt) {
      return this.buildSnapshot(context);
    }

    const settlement = guest.settlementId
      ? details.settlements.find(
          (item) => item.settlementId === guest.settlementId
        )
      : undefined;
    if (settlement?.confirmedAt) {
      throw new ValidationError(
        "The payment was already confirmed — ask whoever covered the bill to adjust it"
      );
    }
    if (settlement) {
      await getTripStore().purgeSettlement(
        link.tripId,
        settlement.settlementId
      );
      context.details = {
        ...details,
        settlements: details.settlements.filter(
          (item) => item.settlementId !== settlement.settlementId
        )
      };
    }
    await getSplitLinkStore().clearGuestCompletion(shareId, memberId);

    const payerMember = details.members.find(
      (m) => m.memberId === expense.paidByMemberId
    );
    if (payerMember && !payerMember.placeholder) {
      await notifyUsersSafely([payerMember.memberId], {
        title: details.trip.name,
        body:
          `${firstName(guest.displayName)} unmarked their ` +
          `${expense.description} payment`,
        data: { tripId: link.tripId }
      });
    }

    return this.buildSnapshot(context);
  }
}
