import { Buffer } from "node:buffer";
import { nanoid } from "nanoid";
import { z } from "zod";
import { TripStore } from "../data/tripStore.js";
import { UserStore } from "../data/userStore.js";
import {
  Trip,
  TripMember,
  TripInvite,
  Expense,
  Receipt,
  Settlement,
  UserProfile,
  type TextractExtraction,
  PaymentMethods
} from "../types.js";
import { ValidationError, ForbiddenError, NotFoundError } from "../lib/errors.js";
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
      z.object({
        userId: z.string().min(1)
      })
    )
    .min(1)
});

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
  receiptId: z.string().optional(),
  remainderMemberId: z.string().optional()
});

const updateExpenseSchema = z.object({
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
  remainderMemberId: z.string().optional()
});

const receiptSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1)
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
  settlements: Settlement[]
): BalanceRow[] => {
  const balances = new Map<string, number>();
  for (const member of members) {
    balances.set(member.memberId, 0);
  }

  for (const expense of expenses) {
    balances.set(
      expense.paidByMemberId,
      roundCents((balances.get(expense.paidByMemberId) || 0) + expense.total)
    );

    for (const allocation of expense.allocations) {
      balances.set(
        allocation.memberId,
        roundCents((balances.get(allocation.memberId) || 0) - allocation.amount)
      );
    }
  }

  for (const settlement of settlements) {
    if (!settlement.confirmedAt) {
      continue;
    }
    balances.set(
      settlement.fromMemberId,
      roundCents(
        (balances.get(settlement.fromMemberId) || 0) + settlement.amount
      )
    );
    balances.set(
      settlement.toMemberId,
      roundCents(
        (balances.get(settlement.toMemberId) || 0) - settlement.amount
      )
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
          details.settlements
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

  async getTripInvite(tripId: string, auth: AuthContext): Promise<TripInvite | null> {
    await ensureCurrentUserProfile(auth);
    const details = await getTripStore().getTripDetails(tripId);
    const isMember = details.members.some((m) => m.memberId === auth.userId);
    if (!isMember) {
      throw new ForbiddenError("You do not have access to this trip");
    }
    return getTripStore().getTripInvite(tripId);
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
      alreadyMember: details.members.some((m) => m.memberId === auth.userId)
    };
  }

  async redeemInvite(
    inviteId: string,
    auth: AuthContext
  ): Promise<{ tripId: string }> {
    const profile = await ensureCurrentUserProfile(auth);
    const invite = await getTripStore().getInviteById(inviteId);
    if (!invite) {
      throw new NotFoundError("This invite link is no longer valid");
    }
    const details = await getTripStore().getTripDetails(invite.tripId);
    const alreadyMember = details.members.some(
      (m) => m.memberId === auth.userId
    );
    if (alreadyMember) {
      return { tripId: details.trip.tripId };
    }
    const newMember: TripMember = {
      tripId: details.trip.tripId,
      memberId: auth.userId,
      displayName: getDisplayName(profile),
      email: profile.email,
      addedBy: invite.createdBy,
      createdAt: isoNow()
    };
    await getTripStore().addMembers(details.trip, [newMember]);
    return { tripId: details.trip.tripId };
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
      details.settlements
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
    const expensesWithPreview = await Promise.all(
      sortedExpenses.map(async (expense) => {
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
    if (!isOwner) {
      throw new ForbiddenError("Only trip owners can add members");
    }

    const existingMemberIds = new Set(
      details.members.map((member) => member.memberId)
    );

    const requestedMemberIds = Array.from(
      new Set(
        parsed.data.members
          .map((member) => member.userId)
          .filter((userId) => userId !== auth.userId)
      )
    );

    const filteredIds = requestedMemberIds.filter(
      (userId) => !existingMemberIds.has(userId)
    );

    if (!filteredIds.length) {
      throw new ValidationError("All selected members are already in the trip");
    }

    const profiles = await getUserStore().getUsersByIds(filteredIds);

    if (profiles.length !== filteredIds.length) {
      const foundIds = new Set(profiles.map((profile) => profile.userId));
      const missing = filteredIds.filter((id) => !foundIds.has(id));
      throw new ValidationError(
        `Some members do not exist: ${missing.join(", ")}`
      );
    }

    const now = isoNow();
    const newMembers: TripMember[] = profiles.map((profile) => ({
      tripId,
      memberId: profile.userId,
      displayName: getDisplayName(profile),
      email: profile.email,
      addedBy: auth.userId,
      createdAt: now
    }));

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
      if (!attachedReceipt) {
        throw new ValidationError("Receipt not found on this trip");
      }
    }

    const splitWith = parsed.data.sharedWithMemberIds;
    let allocations = parsed.data.allocations ?? [];
    if (parsed.data.splitEvenly || !allocations.length) {
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
      receiptId: parsed.data.receiptId
    };

    await getTripStore().saveExpense(expense);

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

    const expense = details.expenses.find(
      (item) => item.expenseId === expenseId
    );
    if (!expense) {
      throw new ValidationError("Expense not found");
    }

    let allocations = parsed.data.allocations ?? expense.allocations;
    if (parsed.data.sharedWithMemberIds) {
      parsed.data.sharedWithMemberIds.forEach((memberId) =>
        ensureMember(details.members, memberId)
      );
    }

    if (parsed.data.allocations) {
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

    if (parsed.data.total ?? parsed.data.allocations) {
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
      total: parsed.data.total,
      tax: parsed.data.tax,
      tip: parsed.data.tip,
      sharedWithMemberIds: parsed.data.sharedWithMemberIds,
      allocations,
      updatedAt: isoNow()
    });
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
    if (!receipt) {
      throw new ValidationError("Receipt not found");
    }
    if (!receipt.storageKey) {
      throw new ValidationError("Receipt is missing storage location");
    }

    const url = await generateReceiptDownloadUrl(receipt.storageKey);
    return { url };
  }
}
