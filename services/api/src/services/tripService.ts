import { Buffer } from "node:buffer";
import { nanoid } from "nanoid";
import { z } from "zod";
import { TripStore } from "../data/tripStore.js";
import { UserStore } from "../data/userStore.js";
import {
  Trip,
  TripMember,
  TripInvite,
  ExpenseComment,
  Expense,
  ExpenseLineItem,
  Receipt,
  Settlement,
  UserProfile,
  type TextractExtraction,
  PaymentMethods
} from "../types.js";
import { ValidationError, ForbiddenError, NotFoundError } from "../lib/errors.js";
import { buildItemizedAllocations } from "../lib/splitMath.js";
import {
  rewriteExpenseMember,
  rewriteSettlementMember
} from "../lib/memberMerge.js";
import { convertCurrency } from "../lib/fx.js";
import type { AuthContext } from "../auth.js";
import { generateReceiptUpload, generateReceiptDownloadUrl } from "./uploadService.js";
import { analyzeReceiptBytes } from "./textractService.js";

let tripStoreInstance: TripStore | null = null;
let userStoreInstance: UserStore | null = null;

const getTripStore = (): TripStore => {
  if (!tripStoreInstance) {
    tripStoreInstance = new TripStore();
  }
  return tripStoreInstance;
};

const getUserStore = (): UserStore => {
  if (!userStoreInstance) {
    userStoreInstance = new UserStore();
  }
  return userStoreInstance;
};

const isoNow = () => new Date().toISOString();

const createTripSchema = z.object({
  name: z.string().min(1),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  currency: z.string().default("USD"),
  members: z
    .array(
      z.object({
        userId: z.string().min(1)
      })
    )
    .optional()
});

const updateTripSchema = z
  .object({
    name: z.string().min(1).optional(),
    startDate: z.union([z.string().min(1), z.null()]).optional(),
    endDate: z.union([z.string().min(1), z.null()]).optional()
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.startDate !== undefined ||
      value.endDate !== undefined,
    {
      message: "No updates provided"
    }
  );

const addMembersSchema = z.object({
  members: z
    .array(
      z
        .object({
          userId: z.string().min(1).optional(),
          // Placeholder member: added by name before they have an account.
          name: z.string().trim().min(1).max(60).optional()
        })
        .refine((member) => Boolean(member.userId) !== Boolean(member.name), {
          message: "Each member needs either a userId or a name"
        })
    )
    .min(1)
});

const redeemInviteSchema = z
  .object({
    // Claim one of the trip's placeholder members while joining.
    claimMemberId: z.string().min(1).optional()
  })
  .nullable()
  .optional();

const lineItemSchema = z.object({
  lineItemId: z.string().optional(),
  description: z.string().min(1),
  quantity: z.number().positive().optional(),
  unitPrice: z.number().nonnegative().optional(),
  total: z.number().nonnegative(),
  assignedMemberIds: z.array(z.string().min(1)).nonempty()
});

const extrasSplitModeSchema = z.enum(["proportional", "even"]);

const expenseSchema = z.object({
  description: z.string().min(1),
  vendor: z.string().optional(),
  category: z.string().optional(),
  total: z.number().positive(),
  currency: z.string().default("USD"),
  tax: z.number().nonnegative().optional(),
  tip: z.number().nonnegative().optional(),
  paidByMemberId: z.string().min(1),
  sharedWithMemberIds: z.array(z.string().min(1)).nonempty(),
  allocations: z
    .array(
      z.object({
        memberId: z.string().min(1),
        amount: z.number().nonnegative()
      })
    )
    .optional(),
  splitEvenly: z.boolean().optional(),
  lineItems: z.array(lineItemSchema).nonempty().optional(),
  extrasSplitMode: extrasSplitModeSchema.optional(),
  receiptId: z.string().optional(),
  remainderMemberId: z.string().optional(),
  draft: z.boolean().optional()
});

const updateExpenseSchema = z.object({
  description: z.string().min(1).optional(),
  // Empty string clears the field (renders treat "" as absent).
  vendor: z.string().optional(),
  category: z.string().optional(),
  currency: z.string().min(1).optional(),
  paidByMemberId: z.string().min(1).optional(),
  total: z.number().positive().optional(),
  tax: z.number().nonnegative().optional(),
  tip: z.number().nonnegative().optional(),
  sharedWithMemberIds: z.array(z.string().min(1)).nonempty().optional(),
  allocations: z
    .array(
      z.object({
        memberId: z.string().min(1),
        amount: z.number().nonnegative()
      })
    )
    .optional(),
  // An explicit empty array clears stored line items (e.g. an itemized
  // expense edited back to an even/custom split); omitting leaves them.
  lineItems: z.array(lineItemSchema).optional(),
  extrasSplitMode: extrasSplitModeSchema.optional(),
  receiptId: z.string().optional(),
  remainderMemberId: z.string().optional(),
  // draft:false publishes; draft:true on a published expense is rejected.
  draft: z.boolean().optional()
});

const receiptSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  draft: z.boolean().optional()
});

const liveReceiptSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().optional(),
  data: z.string().min(1)
});

const settlementSchema = z.object({
  fromMemberId: z.string().min(1),
  toMemberId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().default("USD"),
  note: z.string().optional()
});

const confirmSettlementSchema = z.object({
  confirmed: z.boolean()
});

const paymentMethodField = z.union([z.string().trim().min(1), z.null()]).optional();

const paymentMethodsSchema = z
  .object({
    venmo: paymentMethodField,
    paypal: paymentMethodField,
    zelle: paymentMethodField
  })
  .refine(
    (methods) =>
      methods.venmo !== undefined ||
      methods.paypal !== undefined ||
      methods.zelle !== undefined,
    { message: "No payment methods provided" }
  );

const ensureMember = (members: TripMember[], memberId: string) => {
  const member = members.find((m) => m.memberId === memberId);
  if (!member) {
    throw new ValidationError(`Member ${memberId} not part of trip`);
  }
  return member;
};

const ensureCurrentUserProfile = (auth: AuthContext) =>
  getUserStore().ensureUserProfile(auth);

export interface BalanceRow {
  memberId: string;
  displayName: string;
  balance: number;
}

export interface TripSummary {
  trip: Trip;
  members: TripMember[];
  expenses: Expense[];
  /** The requesting user's own unpublished drafts. */
  draftExpenses: Expense[];
  deletedExpenses: Expense[];
  receipts: Receipt[];
  settlements: Settlement[];
  deletedSettlements: Settlement[];
  balances: BalanceRow[];
  pendingSettlements: Settlement[];
  currentUserId: string;
}

export interface TripListItem extends Trip {
  outstandingBalance: number;
  owedToYou: number;
  hasPendingActions: boolean;
}

const roundCents = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const getDisplayName = (profile: UserProfile): string =>
  profile.displayName ??
  profile.email ??
  profile.userId;

const computeBalances = (
  members: TripMember[],
  expenses: Expense[],
  settlements: Settlement[],
  tripCurrency: string
): BalanceRow[] => {
  const balances = new Map<string, number>();
  for (const member of members) {
    balances.set(member.memberId, 0);
  }

  for (const expense of expenses) {
    const expCurrency = expense.currency || tripCurrency;
    const paid = convertCurrency(expense.total, expCurrency, tripCurrency);
    balances.set(
      expense.paidByMemberId,
      roundCents((balances.get(expense.paidByMemberId) || 0) + paid)
    );

    for (const allocation of expense.allocations) {
      const owed = convertCurrency(allocation.amount, expCurrency, tripCurrency);
      balances.set(
        allocation.memberId,
        roundCents((balances.get(allocation.memberId) || 0) - owed)
      );
    }
  }

  for (const settlement of settlements) {
    if (!settlement.confirmedAt) {
      continue;
    }
    const stlCurrency = settlement.currency || tripCurrency;
    const amount = convertCurrency(settlement.amount, stlCurrency, tripCurrency);
    balances.set(
      settlement.fromMemberId,
      roundCents((balances.get(settlement.fromMemberId) || 0) + amount)
    );
    balances.set(
      settlement.toMemberId,
      roundCents((balances.get(settlement.toMemberId) || 0) - amount)
    );
  }

  return members.map((member) => ({
    memberId: member.memberId,
    displayName: member.displayName,
    balance: roundCents(balances.get(member.memberId) || 0)
  }));
};

const resolveRemainderTarget = (
  memberIds: string[],
  preferredId?: string,
  fallbackId?: string
): string | undefined => {
  if (!memberIds.length) return undefined;
  if (preferredId && memberIds.includes(preferredId)) {
    return preferredId;
  }
  if (fallbackId && memberIds.includes(fallbackId)) {
    return fallbackId;
  }
  return memberIds[memberIds.length - 1];
};

const buildEvenSplitAllocations = (
  total: number,
  memberIds: string[],
  remainderMemberId?: string
) => {
  if (!memberIds.length) return [];

  const totalCents = Math.round(total * 100);
  const absoluteCents = Math.abs(totalCents);
  const baseShare = Math.floor(absoluteCents / memberIds.length);
  let remainder = absoluteCents - baseShare * memberIds.length;
  const sign = totalCents < 0 ? -1 : 1;
  const target = remainderMemberId && memberIds.includes(remainderMemberId)
    ? remainderMemberId
    : memberIds[memberIds.length - 1];

  return memberIds.map((memberId) => {
    let cents = baseShare;
    if (remainder > 0 && memberId === target) {
      cents += remainder;
      remainder = 0;
    }
    return {
      memberId,
      amount: roundCents((cents * sign) / 100)
    };
  });
};

type LineItemInput = z.infer<typeof lineItemSchema>;

const finalizeLineItems = (
  items: LineItemInput[],
  members: TripMember[],
  sharedWithMemberIds: string[]
): ExpenseLineItem[] => {
  const shared = new Set(sharedWithMemberIds);
  return items.map((item) => {
    item.assignedMemberIds.forEach((memberId) => {
      ensureMember(members, memberId);
      if (!shared.has(memberId)) {
        throw new ValidationError(
          `Item "${item.description}" is assigned to a member not included in the split`
        );
      }
    });
    return {
      lineItemId: item.lineItemId ?? `li_${nanoid(8)}`,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: roundCents(item.total),
      assignedMemberIds: item.assignedMemberIds
    };
  });
};

export class TripService {
  async listTrips(auth: AuthContext): Promise<TripListItem[]> {
    await ensureCurrentUserProfile(auth);
    const trips = await getTripStore().listTripsForMember(auth.userId);

    const enrichedTrips = await Promise.all(
      trips.map(async (trip) => {
        const details = await getTripStore().getTripDetails(trip.tripId);
        const balances = computeBalances(
          details.members,
          details.expenses,
          details.settlements,
          details.trip.currency
        );
        const userBalance =
          balances.find((row) => row.memberId === auth.userId)?.balance ?? 0;
        const outstandingBalance =
          userBalance < -0.01 ? Math.abs(userBalance) : 0;
        const owedToYou = userBalance > 0.01 ? userBalance : 0;
        const hasPendingActions = details.settlements.some(
          (settlement) =>
            !settlement.confirmedAt &&
            (settlement.fromMemberId === auth.userId ||
              settlement.toMemberId === auth.userId)
        );

        return {
          ...details.trip,
          outstandingBalance: roundCents(outstandingBalance),
          owedToYou: roundCents(owedToYou),
          hasPendingActions
        };
      })
    );

    return enrichedTrips;
  }

  async createTrip(body: unknown, auth: AuthContext): Promise<Trip> {
    const parsed = createTripSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const ownerProfile = await ensureCurrentUserProfile(auth);

    const now = isoNow();
    const trip: Trip = {
      tripId: `trip_${nanoid(10)}`,
      ownerId: auth.userId,
      name: parsed.data.name,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      createdAt: now,
      updatedAt: now,
      currency: parsed.data.currency ?? "USD"
    };

    const ownerMember: TripMember = {
      tripId: trip.tripId,
      memberId: auth.userId,
      displayName: getDisplayName(ownerProfile),
      email: ownerProfile.email,
      addedBy: auth.userId,
      createdAt: now
    };

    const requestedMemberIds = Array.from(
      new Set(
        (parsed.data.members ?? [])
          .map((member) => member.userId)
          .filter((userId) => userId !== auth.userId)
      )
    );

    const extraProfiles = await getUserStore().getUsersByIds(requestedMemberIds);

    if (extraProfiles.length !== requestedMemberIds.length) {
      const foundIds = new Set(extraProfiles.map((profile) => profile.userId));
      const missing = requestedMemberIds.filter((id) => !foundIds.has(id));
      throw new ValidationError(
        `Some members do not exist: ${missing.join(", ")}`
      );
    }

    const extraMembers: TripMember[] = extraProfiles.map((profile) => ({
      tripId: trip.tripId,
      memberId: profile.userId,
      displayName: getDisplayName(profile),
      email: profile.email,
      addedBy: auth.userId,
      createdAt: now
    }));

    await getTripStore().createTrip(trip, ownerMember);
    if (extraMembers.length) {
      await getTripStore().addMembers(trip, extraMembers);
    }

    return trip;
  }

  async updateTrip(
    tripId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<Trip> {
    const parsed = updateTripSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isOwner = details.trip.ownerId === auth.userId;
    if (!isOwner) {
      throw new ForbiddenError("Only trip owners can edit details");
    }

    const updates: {
      name?: string;
      startDate?: string | null;
      endDate?: string | null;
      updatedAt: string;
    } = {
      updatedAt: isoNow()
    };

    if (parsed.data.name !== undefined) {
      updates.name = parsed.data.name;
    }
    if (parsed.data.startDate !== undefined) {
      updates.startDate = parsed.data.startDate;
    }
    if (parsed.data.endDate !== undefined) {
      updates.endDate = parsed.data.endDate;
    }

    await getTripStore().updateTripMetadata(tripId, details.members, updates);

    const nextTrip: Trip = {
      ...details.trip,
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      startDate:
        updates.startDate !== undefined
          ? updates.startDate ?? undefined
          : details.trip.startDate,
      endDate:
        updates.endDate !== undefined
          ? updates.endDate ?? undefined
          : details.trip.endDate,
      updatedAt: updates.updatedAt
    };

    return nextTrip;
  }

  async archiveTrip(tripId: string, auth: AuthContext): Promise<void> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    if (details.trip.ownerId !== auth.userId) {
      throw new ForbiddenError("Only the trip owner can archive this trip");
    }
    if (details.trip.archivedAt) {
      return;
    }
    await getTripStore().archiveTrip(tripId, auth.userId);
  }

  async unarchiveTrip(tripId: string, auth: AuthContext): Promise<void> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    if (details.trip.ownerId !== auth.userId) {
      throw new ForbiddenError("Only the trip owner can unarchive this trip");
    }
    if (!details.trip.archivedAt) {
      return;
    }
    await getTripStore().unarchiveTrip(tripId);
  }

  async getTripInvite(tripId: string, auth: AuthContext): Promise<TripInvite> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isMember = details.members.some((m) => m.memberId === auth.userId);
    if (!isMember) {
      throw new ForbiddenError("You do not have access to this trip");
    }
    // Every trip has a shareable link by construction: fetching it creates
    // it on first use, for any member. Rotation/revocation stays owner-only
    // so one member can't invalidate a link others already shared.
    const existing = await getTripStore().getTripInvite(tripId);
    if (existing) {
      return existing;
    }
    const invite: TripInvite = {
      tripId,
      inviteId: `inv_${nanoid(14)}`,
      createdBy: auth.userId,
      createdAt: isoNow()
    };
    await getTripStore().createInvite(invite);
    return invite;
  }

  async createOrRotateInvite(tripId: string, auth: AuthContext): Promise<TripInvite> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    if (details.trip.ownerId !== auth.userId) {
      throw new ForbiddenError("Only the trip owner can create or rotate invite links");
    }
    const existing = await getTripStore().getTripInvite(tripId);
    if (existing) {
      await getTripStore().deleteInvite(tripId, existing.inviteId);
    }
    const invite: TripInvite = {
      tripId,
      inviteId: `inv_${nanoid(14)}`,
      createdBy: auth.userId,
      createdAt: isoNow()
    };
    await getTripStore().createInvite(invite);
    return invite;
  }

  async revokeInvite(tripId: string, auth: AuthContext): Promise<void> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    if (details.trip.ownerId !== auth.userId) {
      throw new ForbiddenError("Only the trip owner can revoke invite links");
    }
    const existing = await getTripStore().getTripInvite(tripId);
    if (!existing) return;
    await getTripStore().deleteInvite(tripId, existing.inviteId);
  }

  async previewInvite(
    inviteId: string,
    auth: AuthContext
  ): Promise<{
    tripId: string;
    tripName: string;
    memberCount: number;
    alreadyMember: boolean;
    placeholders: Array<{ memberId: string; displayName: string }>;
  }> {
    await ensureCurrentUserProfile(auth);
    const invite = await getTripStore().getInviteById(inviteId);
    if (!invite) {
      throw new NotFoundError("This invite link is no longer valid");
    }
    const details = await getTripStore().getTripDetails(invite.tripId);
    return {
      tripId: details.trip.tripId,
      tripName: details.trip.name,
      memberCount: details.members.length,
      alreadyMember: details.members.some((m) => m.memberId === auth.userId),
      // Unclaimed placeholder members the joiner might be ("Are you Sarah?").
      placeholders: details.members
        .filter((member) => member.placeholder)
        .map((member) => ({
          memberId: member.memberId,
          displayName: member.displayName
        }))
    };
  }

  async redeemInvite(
    inviteId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<{ tripId: string }> {
    const parsed = redeemInviteSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const claimMemberId = parsed.data?.claimMemberId;

    const profile = await ensureCurrentUserProfile(auth);
    const invite = await getTripStore().getInviteById(inviteId);
    if (!invite) {
      throw new NotFoundError("This invite link is no longer valid");
    }
    const details = await getTripStore().getTripDetails(invite.tripId);
    const alreadyMember = details.members.some(
      (m) => m.memberId === auth.userId
    );
    if (!alreadyMember) {
      const newMember: TripMember = {
        tripId: details.trip.tripId,
        memberId: auth.userId,
        displayName: getDisplayName(profile),
        email: profile.email,
        addedBy: invite.createdBy,
        createdAt: isoNow()
      };
      await getTripStore().addMembers(details.trip, [newMember]);
    }
    if (claimMemberId) {
      await this.claimPlaceholder(details.trip.tripId, claimMemberId, auth);
    }
    return { tripId: details.trip.tripId };
  }

  /**
   * Merges a placeholder member into the calling user: every expense share,
   * allocation, item assignment, and settlement that referenced the
   * placeholder is rewritten to the caller, and the placeholder member
   * record is removed. The caller inherits the placeholder's entire balance.
   */
  async claimPlaceholder(
    tripId: string,
    memberId: string,
    auth: AuthContext
  ): Promise<void> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isMember = details.members.some(
      (member) => member.memberId === auth.userId
    );
    if (!isMember) {
      throw new ForbiddenError("You are not part of this trip");
    }
    const target = details.members.find(
      (member) => member.memberId === memberId
    );
    if (!target || !target.placeholder) {
      throw new ValidationError("That member can no longer be claimed");
    }

    const allExpenses = [
      ...details.expenses,
      ...details.draftExpenses,
      ...details.deletedExpenses
    ];
    const changedExpenses = allExpenses
      .map((expense) => rewriteExpenseMember(expense, memberId, auth.userId))
      .filter((expense): expense is Expense => expense !== null);

    const allSettlements = [
      ...details.settlements,
      ...details.deletedSettlements
    ];
    const changedSettlements = allSettlements
      .map((settlement) =>
        rewriteSettlementMember(settlement, memberId, auth.userId)
      )
      .filter((settlement): settlement is Settlement => settlement !== null);

    await getTripStore().applyMemberMerge(
      tripId,
      changedExpenses,
      changedSettlements,
      memberId
    );
  }

  async getTripSummary(tripId: string, auth: AuthContext): Promise<TripSummary> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isMember = details.members.some(
      (member) => member.memberId === auth.userId
    );
    if (!isMember) {
      throw new ForbiddenError("You do not have access to this trip");
    }

    const balances = computeBalances(
      details.members,
      details.expenses,
      details.settlements,
      details.trip.currency
    );
    const pendingSettlements = details.settlements.filter(
      (settlement) => !settlement.confirmedAt
    );

    const sortedExpenses = [...details.expenses].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );

    const receiptById = new Map(
      details.receipts.map((receipt) => [receipt.receiptId, receipt])
    );
    const addPreviews = (expenses: Expense[]) =>
      Promise.all(
        expenses.map(async (expense) => {
          if (!expense.receiptId) {
            return expense;
          }
          const receipt = receiptById.get(expense.receiptId);
          if (!receipt?.storageKey || receipt.status === "FAILED") {
            return expense;
          }
          try {
            const previewUrl = await generateReceiptDownloadUrl(
              receipt.storageKey
            );
            return {
              ...expense,
              receiptPreviewUrl: previewUrl
            };
          } catch (error) {
            console.warn("Failed to generate receipt preview URL", {
              tripId,
              receiptId: expense.receiptId,
              error
            });
            return expense;
          }
        })
      );
    const expensesWithPreview = await addPreviews(sortedExpenses);

    const ownDrafts = details.draftExpenses
      .filter((expense) => expense.createdBy === auth.userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const draftsWithPreview = await addPreviews(ownDrafts);

    const visibleReceipts = details.receipts.filter(
      (receipt) => !receipt.draft || receipt.createdBy === auth.userId
    );

    const userProfiles = await getUserStore().getUsersByIds(
      Array.from(new Set(details.members.map((member) => member.memberId)))
    );
    const paymentMethodsByMember = new Map(
      userProfiles.map((profile) => [profile.userId, profile.paymentMethods])
    );

    const membersWithPayments = details.members.map((member) => ({
      ...member,
      paymentMethods: paymentMethodsByMember.get(member.memberId)
    }));

    return {
      ...details,
      members: membersWithPayments,
      expenses: expensesWithPreview,
      draftExpenses: draftsWithPreview,
      receipts: visibleReceipts,
      balances,
      pendingSettlements,
      currentUserId: auth.userId
    };
  }

  async updatePaymentMethods(
    tripId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<void> {
    const parsed = paymentMethodsSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isMember = details.members.some(
      (member) => member.memberId === auth.userId
    );
    if (!isMember) {
      throw new ForbiddenError("You are not part of this trip");
    }

    const cleaned: Partial<Record<keyof PaymentMethods, string | null>> = {};
    (["venmo", "paypal", "zelle"] as Array<keyof PaymentMethods>).forEach((key) => {
      const value = parsed.data[key];
      if (value === undefined) return;
      cleaned[key] = value === null ? null : value.trim();
    });

    await getUserStore().updatePaymentMethods(auth.userId, cleaned);
  }

  async addMembers(
    tripId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<TripMember[]> {
    const parsed = addMembersSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isOwner = details.trip.ownerId === auth.userId;
    const isMember = details.members.some(
      (member) => member.memberId === auth.userId
    );

    const userEntries = parsed.data.members.filter((member) => member.userId);
    const nameEntries = parsed.data.members.filter((member) => member.name);

    // Real-account adds stay owner-only; placeholders (added by name, no
    // account yet) can be created by any member — that's the at-the-table
    // "add Sarah so we can split now" move.
    if (userEntries.length && !isOwner) {
      throw new ForbiddenError("Only trip owners can add members");
    }
    if (nameEntries.length && !isMember) {
      throw new ForbiddenError("You are not part of this trip");
    }

    const existingMemberIds = new Set(
      details.members.map((member) => member.memberId)
    );
    const now = isoNow();
    const newMembers: TripMember[] = [];

    if (userEntries.length) {
      const requestedMemberIds = Array.from(
        new Set(
          userEntries
            .map((member) => member.userId as string)
            .filter((userId) => userId !== auth.userId)
        )
      );
      const filteredIds = requestedMemberIds.filter(
        (userId) => !existingMemberIds.has(userId)
      );
      if (!filteredIds.length && !nameEntries.length) {
        throw new ValidationError(
          "All selected members are already in the trip"
        );
      }

      const profiles = await getUserStore().getUsersByIds(filteredIds);
      if (profiles.length !== filteredIds.length) {
        const foundIds = new Set(profiles.map((profile) => profile.userId));
        const missing = filteredIds.filter((id) => !foundIds.has(id));
        throw new ValidationError(
          `Some members do not exist: ${missing.join(", ")}`
        );
      }

      newMembers.push(
        ...profiles.map((profile) => ({
          tripId,
          memberId: profile.userId,
          displayName: getDisplayName(profile),
          email: profile.email,
          addedBy: auth.userId,
          createdAt: now
        }))
      );
    }

    for (const entry of nameEntries) {
      newMembers.push({
        tripId,
        memberId: `pm_${nanoid(10)}`,
        displayName: (entry.name as string).trim(),
        addedBy: auth.userId,
        createdAt: now,
        placeholder: true
      });
    }

    if (!newMembers.length) {
      throw new ValidationError("No members to add");
    }

    await getTripStore().addMembers(details.trip, newMembers);

    return newMembers;
  }

  async removeMember(
    tripId: string,
    memberId: string,
    auth: AuthContext
  ): Promise<void> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isOwner = details.trip.ownerId === auth.userId;
    if (!isOwner) {
      throw new ForbiddenError("Only trip owners can remove members");
    }

    if (memberId === details.trip.ownerId) {
      throw new ValidationError("Cannot remove the trip owner");
    }

    const member = details.members.find(
      (item) => item.memberId === memberId
    );
    if (!member) {
      throw new ValidationError("Member not found on this trip");
    }

    const involvedInExpenses = details.expenses.some(
      (expense) =>
        expense.paidByMemberId === memberId ||
        expense.sharedWithMemberIds.includes(memberId) ||
        expense.allocations.some(
          (allocation) => allocation.memberId === memberId
        )
    );
    if (involvedInExpenses) {
      throw new ValidationError(
        "Cannot remove member with recorded expenses"
      );
    }

    const involvedInSettlements = details.settlements.some(
      (settlement) =>
        settlement.fromMemberId === memberId ||
        settlement.toMemberId === memberId
    );
    if (involvedInSettlements) {
      throw new ValidationError(
        "Cannot remove member with recorded settlements"
      );
    }

    await getTripStore().deleteMember(tripId, memberId);
  }

  async createExpense(
    tripId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<Expense> {
    const parsed = expenseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isMember = details.members.some(
      (member) => member.memberId === auth.userId
    );
    if (!isMember) {
      throw new ForbiddenError("You are not part of this trip");
    }

    ensureMember(details.members, parsed.data.paidByMemberId);
    parsed.data.sharedWithMemberIds.forEach((memberId) =>
      ensureMember(details.members, memberId)
    );

    let attachedReceipt: Receipt | undefined;
    if (parsed.data.receiptId) {
      attachedReceipt = details.receipts.find(
        (item) => item.receiptId === parsed.data.receiptId
      );
      // Someone else's draft receipt is invisible — treat it as missing.
      if (
        !attachedReceipt ||
        (attachedReceipt.draft && attachedReceipt.createdBy !== auth.userId)
      ) {
        throw new ValidationError("Receipt not found on this trip");
      }
    }

    const splitWith = parsed.data.sharedWithMemberIds;
    let allocations = parsed.data.allocations ?? [];
    let lineItems: ExpenseLineItem[] | undefined;
    if (parsed.data.lineItems?.length) {
      // Itemized split: allocations are derived server-side from the item
      // assignments so stored amounts always match the item math.
      lineItems = finalizeLineItems(
        parsed.data.lineItems,
        details.members,
        splitWith
      );
      allocations = buildItemizedAllocations({
        lineItems,
        tax: parsed.data.tax,
        tip: parsed.data.tip,
        extrasSplitMode: parsed.data.extrasSplitMode
      }).allocations;
    } else if (parsed.data.splitEvenly || !allocations.length) {
      const remainderTarget = resolveRemainderTarget(
        splitWith,
        parsed.data.remainderMemberId,
        parsed.data.paidByMemberId
      );
      allocations = buildEvenSplitAllocations(
        parsed.data.total,
        splitWith,
        remainderTarget
      );
    }

    const allocatedTotal = roundCents(
      allocations.reduce((sum, allocation) => sum + allocation.amount, 0)
    );
    if (Math.abs(allocatedTotal - parsed.data.total) > 0.05) {
      throw new ValidationError(
        `Allocated total ${allocatedTotal} does not match expense total ${parsed.data.total}`
      );
    }

    const now = isoNow();
    const expense: Expense = {
      tripId,
      expenseId: `exp_${nanoid(10)}`,
      createdAt: now,
      updatedAt: now,
      description: parsed.data.description,
      vendor: parsed.data.vendor,
      category: parsed.data.category,
      total: parsed.data.total,
      currency: parsed.data.currency ?? details.trip.currency,
      tax: parsed.data.tax,
      tip: parsed.data.tip,
      paidByMemberId: parsed.data.paidByMemberId,
      sharedWithMemberIds: parsed.data.sharedWithMemberIds,
      allocations,
      lineItems,
      extrasSplitMode: lineItems ? parsed.data.extrasSplitMode ?? "proportional" : undefined,
      receiptId: parsed.data.receiptId,
      draft: parsed.data.draft ? true : undefined,
      createdBy: auth.userId
    };

    await getTripStore().saveExpense(expense);

    // Scanned receipts upload as drafts before the user decides whether to
    // publish; creating a published expense reveals its receipt.
    if (!expense.draft && attachedReceipt?.draft) {
      await getTripStore().updateReceiptExtraction(
        tripId,
        attachedReceipt.receiptId,
        { draft: false, updatedAt: isoNow() }
      );
    }

    const response: Expense = { ...expense };
    if (
      attachedReceipt?.storageKey &&
      attachedReceipt.status !== "FAILED"
    ) {
      try {
        response.receiptPreviewUrl = await generateReceiptDownloadUrl(
          attachedReceipt.storageKey
        );
      } catch (error) {
        console.warn("Failed to generate receipt preview URL", {
          tripId,
          receiptId: attachedReceipt.receiptId,
          error
        });
      }
    }

    return response;
  }

  async updateExpense(
    tripId: string,
    expenseId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<void> {
    const parsed = updateExpenseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isMember = details.members.some(
      (member) => member.memberId === auth.userId
    );
    if (!isMember) {
      throw new ForbiddenError("Not authorized");
    }

    const expense =
      details.expenses.find((item) => item.expenseId === expenseId) ??
      details.draftExpenses.find(
        (item) =>
          item.expenseId === expenseId && item.createdBy === auth.userId
      );
    if (!expense) {
      // Covers both "does not exist" and "someone else's draft" — drafts are
      // invisible to non-creators, so don't reveal their existence.
      throw new ValidationError("Expense not found");
    }

    if (parsed.data.draft === true && !expense.draft) {
      throw new ValidationError(
        "A published expense cannot be turned back into a draft"
      );
    }
    const isPublishing = expense.draft === true && parsed.data.draft === false;

    let allocations = parsed.data.allocations ?? expense.allocations;
    if (parsed.data.sharedWithMemberIds) {
      parsed.data.sharedWithMemberIds.forEach((memberId) =>
        ensureMember(details.members, memberId)
      );
    }
    if (parsed.data.paidByMemberId) {
      ensureMember(details.members, parsed.data.paidByMemberId);
    }
    if (
      parsed.data.receiptId &&
      !details.receipts.some(
        (item) => item.receiptId === parsed.data.receiptId
      )
    ) {
      throw new ValidationError("Receipt not found on this trip");
    }

    let lineItems: ExpenseLineItem[] | undefined;
    if (parsed.data.lineItems?.length) {
      lineItems = finalizeLineItems(
        parsed.data.lineItems,
        details.members,
        parsed.data.sharedWithMemberIds ?? expense.sharedWithMemberIds
      );
      allocations = buildItemizedAllocations({
        lineItems,
        tax: parsed.data.tax ?? expense.tax,
        tip: parsed.data.tip ?? expense.tip,
        extrasSplitMode:
          parsed.data.extrasSplitMode ?? expense.extrasSplitMode
      }).allocations;
    } else if (parsed.data.allocations) {
      allocations = parsed.data.allocations;
    } else if (
      parsed.data.total !== undefined &&
      parsed.data.sharedWithMemberIds &&
      parsed.data.sharedWithMemberIds.length > 0
    ) {
      const sharedMembers = parsed.data.sharedWithMemberIds;
      const total = parsed.data.total;
      const remainderTarget = resolveRemainderTarget(
        sharedMembers,
        parsed.data.remainderMemberId,
        expense.paidByMemberId
      );
      allocations = buildEvenSplitAllocations(
        total,
        sharedMembers,
        remainderTarget
      );
    }

    if (parsed.data.total ?? parsed.data.allocations ?? parsed.data.lineItems) {
      const total = parsed.data.total ?? expense.total;
      const allocatedTotal = roundCents(
        allocations.reduce((sum, allocation) => sum + allocation.amount, 0)
      );
      if (Math.abs(allocatedTotal - total) > 0.05) {
        throw new ValidationError(
          `Allocated total ${allocatedTotal} does not match expense total ${total}`
        );
      }
    }

    await getTripStore().updateExpenseAllocations(tripId, expenseId, {
      description: parsed.data.description,
      vendor: parsed.data.vendor,
      category: parsed.data.category,
      currency: parsed.data.currency,
      paidByMemberId: parsed.data.paidByMemberId,
      receiptId: parsed.data.receiptId,
      total: parsed.data.total,
      tax: parsed.data.tax,
      tip: parsed.data.tip,
      sharedWithMemberIds: parsed.data.sharedWithMemberIds,
      allocations,
      lineItems:
        lineItems ??
        (parsed.data.lineItems && parsed.data.lineItems.length === 0
          ? []
          : undefined),
      extrasSplitMode: lineItems
        ? parsed.data.extrasSplitMode ?? expense.extrasSplitMode ?? "proportional"
        : undefined,
      draft: isPublishing ? false : undefined,
      updatedAt: isoNow()
    });

    // Publishing an expense also reveals its receipt to the rest of the trip.
    const publishedReceiptId = parsed.data.receiptId ?? expense.receiptId;
    if (isPublishing && publishedReceiptId) {
      await getTripStore().updateReceiptExtraction(tripId, publishedReceiptId, {
        draft: false,
        updatedAt: isoNow()
      });
    }
  }

  async deleteExpense(
    tripId: string,
    expenseId: string,
    auth: AuthContext
  ): Promise<void> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isMember = details.members.some(
      (member) => member.memberId === auth.userId
    );
    if (!isMember) {
      throw new ForbiddenError("Not authorized");
    }

    const draft = details.draftExpenses.find(
      (item) =>
        item.expenseId === expenseId && item.createdBy === auth.userId
    );
    if (draft) {
      // Drafts were never visible to the trip, so skip the recoverable
      // soft-delete stage and remove them outright.
      await getTripStore().purgeExpense(tripId, expenseId);
      return;
    }

    const expense = details.expenses.find(
      (item) => item.expenseId === expenseId
    );
    if (!expense) {
      throw new ValidationError("Expense not found");
    }

    const canDelete =
      expense.paidByMemberId === auth.userId ||
      details.trip.ownerId === auth.userId;
    if (!canDelete) {
      throw new ForbiddenError("Not authorized to delete this expense");
    }

    await getTripStore().softDeleteExpense(tripId, expenseId, auth.userId);
  }

  async restoreExpense(
    tripId: string,
    expenseId: string,
    auth: AuthContext
  ): Promise<void> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isMember = details.members.some(
      (member) => member.memberId === auth.userId
    );
    if (!isMember) {
      throw new ForbiddenError("Not authorized");
    }
    const expense = details.deletedExpenses.find(
      (item) => item.expenseId === expenseId
    );
    if (!expense) {
      throw new ValidationError("Deleted expense not found");
    }
    const canRestore =
      expense.paidByMemberId === auth.userId ||
      expense.deletedBy === auth.userId ||
      details.trip.ownerId === auth.userId;
    if (!canRestore) {
      throw new ForbiddenError("Not authorized to restore this expense");
    }
    await getTripStore().restoreExpense(tripId, expenseId);
  }

  async purgeExpense(
    tripId: string,
    expenseId: string,
    auth: AuthContext
  ): Promise<void> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const expense = details.deletedExpenses.find(
      (item) => item.expenseId === expenseId
    );
    if (!expense) {
      throw new ValidationError("Deleted expense not found");
    }
    const canPurge =
      expense.paidByMemberId === auth.userId ||
      expense.deletedBy === auth.userId ||
      details.trip.ownerId === auth.userId;
    if (!canPurge) {
      throw new ForbiddenError("Not authorized to permanently delete this expense");
    }
    await getTripStore().purgeExpense(tripId, expenseId);
  }

  async createReceipt(
    tripId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<Receipt> {
    const parsed = receiptSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isMember = details.members.some(
      (member) => member.memberId === auth.userId
    );
    if (!isMember) {
      throw new ForbiddenError("Not authorized");
    }

    const { uploadUrl, storageKey, receiptId } = await generateReceiptUpload(
      tripId,
      parsed.data.fileName,
      parsed.data.contentType
    );

    const now = isoNow();
    const receipt: Receipt = {
      tripId,
      receiptId,
      storageKey,
      uploadUrl,
      fileName: parsed.data.fileName,
      status: "PENDING_UPLOAD",
      draft: parsed.data.draft ? true : undefined,
      createdBy: auth.userId,
      createdAt: now,
      updatedAt: now
    };

    await getTripStore().saveReceipt(receipt);
    return receipt;
  }

  async recordSettlement(
    tripId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<Settlement> {
    const parsed = settlementSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isMember = details.members.some(
      (member) => member.memberId === auth.userId
    );
    if (!isMember) {
      throw new ForbiddenError("Not authorized");
    }

    ensureMember(details.members, parsed.data.fromMemberId);
    ensureMember(details.members, parsed.data.toMemberId);

    if (parsed.data.fromMemberId === parsed.data.toMemberId) {
      throw new ValidationError("Settlement participants must be different members");
    }

    const settlement: Settlement = {
      tripId,
      settlementId: `set_${nanoid(10)}`,
      fromMemberId: parsed.data.fromMemberId,
      toMemberId: parsed.data.toMemberId,
      amount: parsed.data.amount,
      currency: parsed.data.currency ?? details.trip.currency,
      note: parsed.data.note,
      createdAt: isoNow(),
      createdBy: auth.userId
    };

    await getTripStore().saveSettlement(settlement);
    return settlement;
  }

  async confirmSettlement(
    tripId: string,
    settlementId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<void> {
    const parsed = confirmSettlementSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const settlement = details.settlements.find(
      (item) => item.settlementId === settlementId
    );
    if (!settlement) {
      throw new ValidationError("Settlement not found");
    }

    if (
      settlement.fromMemberId !== auth.userId &&
      settlement.toMemberId !== auth.userId &&
      details.trip.ownerId !== auth.userId
    ) {
      throw new ForbiddenError("Not authorized to confirm this settlement");
    }

    if (parsed.data.confirmed) {
      await getTripStore().markSettlementConfirmation(
        tripId,
        settlementId,
        isoNow()
      );
    } else {
      await getTripStore().markSettlementConfirmation(tripId, settlementId);
    }
  }

  async deleteSettlement(
    tripId: string,
    settlementId: string,
    auth: AuthContext
  ): Promise<void> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const settlement = details.settlements.find(
      (item) => item.settlementId === settlementId
    );
    if (!settlement) {
      throw new ValidationError("Settlement not found");
    }

    const canDelete =
      settlement.fromMemberId === auth.userId ||
      settlement.toMemberId === auth.userId ||
      details.trip.ownerId === auth.userId;
    if (!canDelete) {
      throw new ForbiddenError("Not authorized to delete this settlement");
    }

    await getTripStore().softDeleteSettlement(tripId, settlementId, auth.userId);
  }

  async restoreSettlement(
    tripId: string,
    settlementId: string,
    auth: AuthContext
  ): Promise<void> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const settlement = details.deletedSettlements.find(
      (item) => item.settlementId === settlementId
    );
    if (!settlement) {
      throw new ValidationError("Deleted settlement not found");
    }
    const canRestore =
      settlement.fromMemberId === auth.userId ||
      settlement.toMemberId === auth.userId ||
      settlement.deletedBy === auth.userId ||
      details.trip.ownerId === auth.userId;
    if (!canRestore) {
      throw new ForbiddenError("Not authorized to restore this settlement");
    }
    await getTripStore().restoreSettlement(tripId, settlementId);
  }

  async purgeSettlement(
    tripId: string,
    settlementId: string,
    auth: AuthContext
  ): Promise<void> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const settlement = details.deletedSettlements.find(
      (item) => item.settlementId === settlementId
    );
    if (!settlement) {
      throw new ValidationError("Deleted settlement not found");
    }
    const canPurge =
      settlement.fromMemberId === auth.userId ||
      settlement.toMemberId === auth.userId ||
      settlement.deletedBy === auth.userId ||
      details.trip.ownerId === auth.userId;
    if (!canPurge) {
      throw new ForbiddenError("Not authorized to permanently delete this settlement");
    }
    await getTripStore().purgeSettlement(tripId, settlementId);
  }

  async analyzeReceiptLive(
    tripId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<TextractExtraction> {
    const parsed = liveReceiptSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isMember = details.members.some(
      (member) => member.memberId === auth.userId
    );
    if (!isMember) {
      throw new ForbiddenError("Not authorized");
    }

    const buffer = Buffer.from(parsed.data.data, "base64");
    if (!buffer.length) {
      throw new ValidationError("Empty receipt data");
    }
    if (buffer.length > 5 * 1024 * 1024) {
      throw new ValidationError("Receipt file is too large (limit 5 MB)");
    }

    const extraction = await analyzeReceiptBytes(new Uint8Array(buffer));
    return extraction;
  }

  async getReceiptDownloadUrl(
    tripId: string,
    receiptId: string,
    auth: AuthContext
  ): Promise<{ url: string }> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isMember = details.members.some(
      (member) => member.memberId === auth.userId
    );
    if (!isMember) {
      throw new ForbiddenError("Not authorized");
    }

    const receipt = details.receipts.find(
      (item) => item.receiptId === receiptId
    );
    // Draft receipts are invisible to everyone but their uploader.
    if (!receipt || (receipt.draft && receipt.createdBy !== auth.userId)) {
      throw new ValidationError("Receipt not found");
    }
    if (!receipt.storageKey) {
      throw new ValidationError("Receipt is missing storage location");
    }

    const url = await generateReceiptDownloadUrl(receipt.storageKey);
    return { url };
  }

  /** Returns the receipt record itself — used by the mobile scan flow to
   *  poll for the async Textract extraction after a presigned upload. */
  async getReceipt(
    tripId: string,
    receiptId: string,
    auth: AuthContext
  ): Promise<{ receipt: Receipt }> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isMember = details.members.some(
      (member) => member.memberId === auth.userId
    );
    if (!isMember) {
      throw new ForbiddenError("Not authorized");
    }

    const receipt = details.receipts.find(
      (item) => item.receiptId === receiptId
    );
    if (!receipt || (receipt.draft && receipt.createdBy !== auth.userId)) {
      throw new ValidationError("Receipt not found");
    }
    return { receipt };
  }

  async listExpenseComments(
    tripId: string,
    expenseId: string,
    auth: AuthContext
  ): Promise<ExpenseComment[]> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    if (!details.members.some((m) => m.memberId === auth.userId)) {
      throw new ForbiddenError("You do not have access to this trip");
    }
    return getTripStore().listExpenseComments(tripId, expenseId);
  }

  async createExpenseComment(
    tripId: string,
    expenseId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<ExpenseComment> {
    const profile = await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    if (!details.members.some((m) => m.memberId === auth.userId)) {
      throw new ForbiddenError("You do not have access to this trip");
    }
    if (!details.expenses.some((e) => e.expenseId === expenseId)) {
      throw new ValidationError("Expense not found");
    }
    const parsed = z
      .object({ body: z.string().min(1).max(2000) })
      .safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const comment: ExpenseComment = {
      tripId,
      expenseId,
      commentId: `cmt_${nanoid(12)}`,
      authorId: auth.userId,
      authorName: getDisplayName(profile),
      body: parsed.data.body.trim(),
      createdAt: isoNow()
    };
    await getTripStore().createComment(comment);
    return comment;
  }

  async deleteExpenseComment(
    tripId: string,
    expenseId: string,
    commentId: string,
    auth: AuthContext
  ): Promise<void> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    if (!details.members.some((m) => m.memberId === auth.userId)) {
      throw new ForbiddenError("You do not have access to this trip");
    }
    const comment = await getTripStore().getComment(tripId, expenseId, commentId);
    if (!comment) {
      throw new NotFoundError("Comment not found");
    }
    const canDelete =
      comment.authorId === auth.userId ||
      details.trip.ownerId === auth.userId;
    if (!canDelete) {
      throw new ForbiddenError("Not authorized to delete this comment");
    }
    await getTripStore().deleteComment(tripId, expenseId, commentId);
  }
}
