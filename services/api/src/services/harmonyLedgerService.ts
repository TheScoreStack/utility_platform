import { nanoid } from "nanoid";
import { z } from "zod";
import type { AuthContext } from "../auth.js";
import { HarmonyLedgerStore } from "../data/harmonyLedgerStore.js";
import { HarmonyStatementStore } from "../data/harmonyStatementStore.js";
import { UserStore } from "../data/userStore.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError
} from "../lib/errors.js";
import {
  deleteObject,
  generateReceiptDownloadUrl,
  generateStatementUpload
} from "./uploadService.js";
import { invokeStatementParser } from "./invokeStatementParser.js";
import { advanceCadence } from "../lib/recurrence.js";
import type {
  HarmonyRecurringTemplate,
  HarmonyLedgerAccessRecord,
  HarmonyLedgerEntry,
  HarmonyLedgerEntryType,
  HarmonyLedgerGroup,
  HarmonyLedgerTransfer,
  HarmonyLedgerUnallocatedSummary,
  HarmonyStagedTransaction,
  HarmonyStatement,
  HarmonyStatementCounts,
  HarmonyStatementFileType,
  HarmonyStatementSourceType,
  HarmonyTxnDirection,
  UserProfile
} from "../types.js";

const DEFAULT_ADMIN_EMAILS = ["hunter.j.adam@gmail.com"].map((email) =>
  email.toLowerCase()
);
const ledgerEntryTypes = [
  "DONATION",
  "INCOME",
  "EXPENSE",
  "REIMBURSEMENT"
] as const;
const DEFAULT_GROUPS: Array<{ groupId: string; name: string }> = [
  { groupId: "highlyte", name: "Highlyte" },
  { groupId: "verse", name: "Verse" },
  { groupId: "golden-ratio", name: "Golden Ratio" },
  { groupId: "out-of-range", name: "Out of Range" },
  { groupId: "counterpoint", name: "Counterpoint" }
];

const entrySchema = z.object({
  type: z.enum(ledgerEntryTypes),
  amount: z.number().positive(),
  currency: z.string().default("USD"),
  description: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
  memberName: z.string().min(1).optional(),
  groupId: z.string().min(1).optional()
});

const addAccessSchema = z.object({
  userId: z.string().min(1),
  isAdmin: z.boolean().optional()
});

const updateEntryGroupSchema = z.object({
  recordedAt: z.string().min(1),
  groupId: z.union([z.string().min(1), z.null()]).optional()
});

const clearableText = z.union([z.string().min(1), z.null()]).optional();

const updateEntrySchema = z.object({
  recordedAt: z.string().min(1),
  type: z.enum(ledgerEntryTypes).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().min(1).optional(),
  description: clearableText,
  source: clearableText,
  category: clearableText,
  notes: clearableText,
  memberName: clearableText,
  groupId: z.union([z.string().min(1), z.null()]).optional()
});

const transferSchema = z
  .object({
    fromGroupId: z.string().min(1).optional(),
    toGroupId: z.string().min(1).optional(),
    amount: z.number().positive(),
    currency: z.string().default("USD"),
    note: z.string().optional()
  })
  .refine((value) => (value.fromGroupId || value.toGroupId) && value.fromGroupId !== value.toGroupId, {
    message: "Provide different source and destination"
  });

const deleteTransferSchema = z.object({
  createdAt: z.string().min(1)
});

const createStatementSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  sourceType: z.enum(["BANK", "VENMO", "PAYPAL", "OTHER"])
});

const confirmTxnSchema = z.object({
  txnDate: z.string().min(1),
  type: z.enum(ledgerEntryTypes).optional(),
  groupId: z.union([z.string().min(1), z.null()]).optional(),
  description: z.string().min(1).optional(),
  // null suppresses the AI-suggested category; omitted keeps it.
  category: z.union([z.string().min(1), z.null()]).optional(),
  memberName: z.string().min(1).optional(),
  notes: z.string().min(1).optional()
});

const dismissTxnSchema = z.object({
  txnDate: z.string().min(1)
});

const bulkConfirmSchema = z
  .object({
    includeDuplicates: z.boolean().optional()
  })
  .nullish();

/** Max entries created per bulk-confirm call (stays within the HTTP timeout). */
const BULK_CONFIRM_CAP = 200;

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

export const statementFileTypeFrom = (
  fileName: string,
  contentType: string
): HarmonyStatementFileType => {
  const lowerName = fileName.toLowerCase();
  const lowerType = contentType.toLowerCase();
  if (lowerType.includes("pdf") || lowerName.endsWith(".pdf")) {
    return "PDF";
  }
  if (lowerType.includes("csv") || lowerName.endsWith(".csv")) {
    return "CSV";
  }
  if (
    lowerType.startsWith("image/") ||
    IMAGE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))
  ) {
    return "IMAGE";
  }
  throw new ValidationError(
    "Only PDF, CSV, and photo (JPEG/PNG) statements are supported."
  );
};

export const entrySourceForStatement = (
  sourceType: HarmonyStatementSourceType
): string => {
  switch (sourceType) {
    case "VENMO":
      return "Venmo";
    case "PAYPAL":
      return "PayPal";
    case "BANK":
      return "Bank import";
    default:
      return "Statement import";
  }
};

export const allowedTypesForDirection = (
  direction: HarmonyTxnDirection
): HarmonyLedgerEntryType[] =>
  direction === "OUT"
    ? ["EXPENSE"]
    : ["DONATION", "INCOME", "REIMBURSEMENT"];

export const computeStagedCounts = (
  txns: HarmonyStagedTransaction[]
): HarmonyStatementCounts => ({
  total: txns.length,
  pending: txns.filter((txn) => txn.status === "PENDING").length,
  confirmed: txns.filter((txn) => txn.status === "CONFIRMED").length,
  dismissed: txns.filter((txn) => txn.status === "DISMISSED").length,
  duplicates: txns.filter((txn) => Boolean(txn.duplicateOf)).length
});

export interface HarmonyStatementCreateResponse {
  statement: HarmonyStatement;
  uploadUrl: string;
}

export interface HarmonyStatementDetailResponse {
  statement: HarmonyStatement;
  transactions: HarmonyStagedTransaction[];
  groups: HarmonyLedgerGroup[];
}

export interface HarmonyBulkConfirmResponse {
  confirmed: number;
  skipped: number;
  remaining: number;
  counts: HarmonyStatementCounts;
}

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(40)
});

const updateGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    isActive: z.boolean().optional()
  })
  .refine((value) => value.name !== undefined || value.isActive !== undefined, {
    message: "Provide a new name or an active flag."
  });

const recurringCadences = ["weekly", "monthly"] as const;

const createRecurringSchema = z.object({
  type: z.enum(ledgerEntryTypes),
  amount: z.number().positive(),
  currency: z.string().default("USD"),
  description: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  cadence: z.enum(recurringCadences)
});

const updateRecurringSchema = z
  .object({
    amount: z.number().positive().optional(),
    description: clearableText,
    category: clearableText,
    groupId: z.union([z.string().min(1), z.null()]).optional(),
    cadence: z.enum(recurringCadences).optional(),
    isActive: z.boolean().optional()
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "Provide at least one field to update."
  });

/** Safety cap on catch-up materializations per template per run. */
const MAX_CATCHUP_RUNS = 12;

/** "Golden Ratio!" -> "golden-ratio". */
export const slugifyGroupName = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

export interface HarmonyLedgerAccessResponse {
  allowed: boolean;
  isAdmin: boolean;
  members?: HarmonyLedgerAccessRecord[];
  currentAccessId?: string;
}

export interface HarmonyLedgerEntriesResponse {
  entries: HarmonyLedgerEntry[];
  totals: {
    donations: number;
    income: number;
    expenses: number;
    reimbursements: number;
    net: number;
  };
  groups: HarmonyLedgerGroup[];
  groupSummaries: HarmonyLedgerGroupSummary[];
  unallocated: HarmonyLedgerUnallocatedSummary;
  transfers: HarmonyLedgerTransfer[];
}

export interface HarmonyLedgerOverviewResponse {
  totals: HarmonyLedgerEntriesResponse["totals"];
  groups: HarmonyLedgerGroupSummary[];
  unallocated: HarmonyLedgerUnallocatedSummary;
  transfers: HarmonyLedgerTransfer[];
}

export interface HarmonyLedgerGroupSummary {
  groupId: string;
  name: string;
  donations: number;
  income: number;
  expenses: number;
  reimbursements: number;
  transfersIn: number;
  transfersOut: number;
  net: number;
}

const isoNow = () => new Date().toISOString();

const displayNameFromProfile = (profile: UserProfile): string =>
  profile.displayName ?? profile.email ?? profile.userId;

export class HarmonyLedgerService {
  private readonly store = new HarmonyLedgerStore();
  private readonly statementStore = new HarmonyStatementStore();
  private readonly userStore = new UserStore();
  private bootstrapPromise: Promise<void> | null = null;
  private groupBootstrapPromise: Promise<void> | null = null;

  private normalizeEmail(email?: string | null): string | null {
    return email ? email.trim().toLowerCase() : null;
  }

  private async ensureDefaultAdminAccess(): Promise<void> {
    if (this.bootstrapPromise) {
      await this.bootstrapPromise;
      return;
    }

    this.bootstrapPromise = (async () => {
      for (const email of DEFAULT_ADMIN_EMAILS) {
        const existing = await this.store.findAccessByEmail(email);
        if (!existing) {
          await this.store.createAccessRecord({
            accessId: nanoid(12),
            email,
            normalizedEmail: email,
            displayName: "Harmony Admin",
            isAdmin: true,
            addedAt: isoNow(),
            addedBy: "system",
            addedByName: "System"
          });
        }
      }
    })();

    await this.bootstrapPromise;
    this.bootstrapPromise = null;
  }

  private async ensureDefaultGroups(): Promise<void> {
    if (this.groupBootstrapPromise) {
      await this.groupBootstrapPromise;
      return;
    }

    this.groupBootstrapPromise = (async () => {
      const existingGroups = await this.store.listGroups();
      const existingIds = new Set(existingGroups.map((group) => group.groupId));
      for (const group of DEFAULT_GROUPS) {
        if (!existingIds.has(group.groupId)) {
          const now = isoNow();
          await this.store.createGroup({
            groupId: group.groupId,
            name: group.name,
            isActive: true,
            createdAt: now,
            createdBy: "system"
          });
        }
      }
    })();

    await this.groupBootstrapPromise;
    this.groupBootstrapPromise = null;
  }

  private async resolveAccessForProfile(
    profile: UserProfile
  ): Promise<HarmonyLedgerAccessRecord | null> {
    await this.ensureDefaultAdminAccess();
    let access = await this.store.findAccessByUserId(profile.userId);
    if (access) {
      return access;
    }

    const normalizedEmail = this.normalizeEmail(profile.email);
    if (!normalizedEmail) {
      return null;
    }

    access = await this.store.findAccessByEmail(normalizedEmail);
    if (access && !access.userId) {
      await this.store.updateAccessMetadata(access.accessId, {
        userId: profile.userId
      });
      access = { ...access, userId: profile.userId };
    }
    return access;
  }

  private async requireAccess(auth: AuthContext): Promise<{
    profile: UserProfile;
    access: HarmonyLedgerAccessRecord;
  }> {
    const profile = await this.userStore.ensureUserProfile(auth);
    const access = await this.resolveAccessForProfile(profile);
    if (!access) {
      throw new ForbiddenError("You do not have access to Harmony Collective yet.");
    }
    return { profile, access };
  }

  private async requireAdmin(auth: AuthContext): Promise<{
    profile: UserProfile;
    access: HarmonyLedgerAccessRecord;
  }> {
    const context = await this.requireAccess(auth);
    if (!context.access.isAdmin) {
      throw new ForbiddenError("Only Harmony Collective admins can manage access.");
    }
    return context;
  }

  private computeTotals(
    entries: HarmonyLedgerEntry[],
    transfers: HarmonyLedgerTransfer[]
  ): {
    overall: HarmonyLedgerEntriesResponse["totals"];
    groupSummaries: HarmonyLedgerGroupSummary[];
    unallocated: HarmonyLedgerUnallocatedSummary;
  } {
    const totals = {
      donations: 0,
      income: 0,
      expenses: 0,
      reimbursements: 0,
      net: 0
    };
    const groupMap = new Map<string, HarmonyLedgerGroupSummary>();
    const unallocated = {
      donations: 0,
      income: 0,
      expenses: 0,
      reimbursements: 0,
      transfersIn: 0,
      transfersOut: 0,
      net: 0
    } satisfies HarmonyLedgerUnallocatedSummary;

    const ensureGroupBucket = (groupId?: string, groupName?: string) => {
      if (!groupId) {
        return unallocated;
      }
      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, {
          groupId,
          name: groupName ?? groupId,
          donations: 0,
          income: 0,
          expenses: 0,
          reimbursements: 0,
          transfersIn: 0,
          transfersOut: 0,
          net: 0
        });
      }
      return groupMap.get(groupId)!;
    };

    for (const entry of entries) {
      switch (entry.type) {
        case "DONATION":
          totals.donations += entry.amount;
          break;
        case "INCOME":
          totals.income += entry.amount;
          break;
        case "EXPENSE":
          totals.expenses += entry.amount;
          break;
        case "REIMBURSEMENT":
          totals.reimbursements += entry.amount;
          break;
      }

      const bucket = ensureGroupBucket(entry.groupId, entry.groupName);

      switch (entry.type) {
        case "DONATION":
          bucket.donations += entry.amount;
          break;
        case "INCOME":
          bucket.income += entry.amount;
          break;
        case "EXPENSE":
          bucket.expenses += entry.amount;
          break;
        case "REIMBURSEMENT":
          bucket.reimbursements += entry.amount;
          break;
      }
    }
    for (const transfer of transfers) {
      const sourceBucket = ensureGroupBucket(transfer.fromGroupId, transfer.fromGroupName);
      const targetBucket = ensureGroupBucket(transfer.toGroupId, transfer.toGroupName);
      sourceBucket.transfersOut += transfer.amount;
      targetBucket.transfersIn += transfer.amount;
    }

    totals.net = totals.donations + totals.income + totals.reimbursements - totals.expenses;
    unallocated.net =
      unallocated.donations +
      unallocated.income +
      unallocated.reimbursements +
      unallocated.transfersIn -
      (unallocated.expenses + unallocated.transfersOut);
    const groupSummaries = Array.from(groupMap.values()).map((summary) => ({
      ...summary,
      net:
        summary.donations +
        summary.income +
        summary.reimbursements +
        summary.transfersIn -
        (summary.expenses + summary.transfersOut)
    }));
    return { overall: totals, groupSummaries, unallocated };
  }

  async getEntries(auth: AuthContext): Promise<HarmonyLedgerEntriesResponse> {
    await this.requireAccess(auth);
    await this.ensureDefaultGroups();
    const [entries, groups, transfers] = await Promise.all([
      this.store.listEntries(),
      this.store.listGroups(),
      this.store.listTransfers()
    ]);
    const { overall, groupSummaries, unallocated } = this.computeTotals(entries, transfers);
    return {
      entries,
      totals: overall,
      groups,
      groupSummaries,
      unallocated,
      transfers
    };
  }

  async getOverview(auth: AuthContext): Promise<HarmonyLedgerOverviewResponse> {
    const data = await this.getEntries(auth);
    return {
      totals: data.totals,
      groups: data.groupSummaries,
      unallocated: data.unallocated,
      transfers: data.transfers
    };
  }

  async createEntry(
    body: unknown,
    auth: AuthContext
  ): Promise<HarmonyLedgerEntry> {
    const { profile } = await this.requireAccess(auth);
    const parsed = entrySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const payload = parsed.data;
    let groupName: string | undefined;
    if (payload.groupId) {
      await this.ensureDefaultGroups();
      const group = await this.store.getGroup(payload.groupId);
      if (!group) {
        throw new ValidationError("Unknown Harmony Collective group.");
      }
      groupName = group.name;
    }

    const entry: HarmonyLedgerEntry = {
      entryId: nanoid(12),
      type: payload.type,
      amount: payload.amount,
      currency: payload.currency,
      description: payload.description,
      source: payload.source,
      category: payload.category,
      notes: payload.notes,
      memberName: payload.memberName,
      groupId: payload.groupId,
      groupName,
      recordedAt: isoNow(),
      recordedBy: profile.userId,
      recordedByName: displayNameFromProfile(profile)
    };

    await this.store.createEntry(entry);
    return entry;
  }

  /**
   * Partial entry update. Text fields clear when explicitly null; `groupId`
   * is tri-state (undefined = untouched, null = unallocate, id = reassign) —
   * backward compatible with the old group-reallocation payloads.
   */
  async updateEntry(
    entryId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<HarmonyLedgerEntry> {
    await this.requireAccess(auth);
    const parsed = updateEntrySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const { recordedAt, groupId, ...fields } = parsed.data;

    let group: { groupId: string; groupName: string } | null | undefined;
    if (groupId === null) {
      group = null;
    } else if (groupId) {
      await this.ensureDefaultGroups();
      const found = await this.store.getGroup(groupId);
      if (!found) {
        throw new ValidationError("Unknown Harmony Collective group.");
      }
      group = { groupId: found.groupId, groupName: found.name };
    }

    try {
      return await this.store.updateEntry(entryId, recordedAt, {
        ...fields,
        group
      });
    } catch (error) {
      if ((error as Error).name === "ConditionalCheckFailedException") {
        throw new NotFoundError("Entry not found");
      }
      throw error;
    }
  }

  async deleteEntry(
    entryId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<void> {
    await this.requireAccess(auth);
    const parsed = updateEntryGroupSchema.pick({ recordedAt: true }).safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    await this.store.deleteEntry(entryId, parsed.data.recordedAt);
  }

  async createTransfer(body: unknown, auth: AuthContext): Promise<HarmonyLedgerTransfer> {
    const { profile } = await this.requireAccess(auth);
    const parsed = transferSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const { fromGroupId, toGroupId, amount, currency, note } = parsed.data;

    if (!fromGroupId && !toGroupId) {
      throw new ValidationError("Provide at least one source or destination group.");
    }

    await this.ensureDefaultGroups();

    const fromGroup = fromGroupId ? await this.store.getGroup(fromGroupId) : null;
    if (fromGroupId && !fromGroup) {
      throw new ValidationError("Source group not found");
    }
    const toGroup = toGroupId ? await this.store.getGroup(toGroupId) : null;
    if (toGroupId && !toGroup) {
      throw new ValidationError("Destination group not found");
    }

    const transfer: HarmonyLedgerTransfer = {
      transferId: nanoid(12),
      amount,
      currency,
      fromGroupId: fromGroup?.groupId,
      fromGroupName: fromGroup?.name,
      toGroupId: toGroup?.groupId,
      toGroupName: toGroup?.name,
      note,
      createdAt: isoNow(),
      createdBy: profile.userId,
      createdByName: displayNameFromProfile(profile)
    };

    await this.store.createTransfer(transfer);
    return transfer;
  }

  async deleteTransfer(
    transferId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<void> {
    await this.requireAccess(auth);
    const parsed = deleteTransferSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    await this.store.deleteTransfer(transferId, parsed.data.createdAt);
  }

  async getAccessOverview(auth: AuthContext): Promise<HarmonyLedgerAccessResponse> {
    const profile = await this.userStore.ensureUserProfile(auth);
    const access = await this.resolveAccessForProfile(profile);
    if (!access) {
      return {
        allowed: false,
        isAdmin: false
      };
    }

    const members = await this.store.listAccessRecords();
    return {
      allowed: true,
      isAdmin: access.isAdmin,
      members,
      currentAccessId: access.accessId
    };
  }

  async addAccess(body: unknown, auth: AuthContext): Promise<HarmonyLedgerAccessRecord> {
    const { profile } = await this.requireAdmin(auth);
    const parsed = addAccessSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const payload = parsed.data;
    const existing = await this.store.findAccessByUserId(payload.userId);
    if (existing) {
      throw new ValidationError("This person already has access.");
    }

    const targetProfile = await this.userStore.getUser(payload.userId);
    if (!targetProfile) {
      throw new ValidationError("Unable to find that user profile.");
    }

    const displayName = targetProfile.displayName ?? targetProfile.email ?? targetProfile.userId;

    const accessRecord = await this.store.createAccessRecord({
      accessId: nanoid(12),
      userId: targetProfile.userId,
      email: targetProfile.email,
      normalizedEmail: this.normalizeEmail(targetProfile.email) ?? undefined,
      displayName,
      isAdmin: payload.isAdmin ?? false,
      addedAt: isoNow(),
      addedBy: profile.userId,
      addedByName: displayNameFromProfile(profile)
    });

    return accessRecord;
  }

  async removeAccess(accessId: string, auth: AuthContext): Promise<void> {
    const { access: actingAccess } = await this.requireAdmin(auth);
    if (actingAccess.accessId === accessId) {
      throw new ValidationError("You cannot remove your own access.");
    }
    await this.store.deleteAccessRecord(accessId);
  }

  async listGroups(auth: AuthContext): Promise<HarmonyLedgerGroup[]> {
    await this.requireAccess(auth);
    await this.ensureDefaultGroups();
    return this.store.listGroups();
  }

  async createGroup(
    body: unknown,
    auth: AuthContext
  ): Promise<HarmonyLedgerGroup> {
    const { profile } = await this.requireAdmin(auth);
    const parsed = createGroupSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const name = parsed.data.name;
    const groupId = slugifyGroupName(name);
    if (!groupId) {
      throw new ValidationError("Group names need at least one letter or number.");
    }

    await this.ensureDefaultGroups();
    const existing = await this.store.getGroup(groupId);
    if (existing) {
      throw new ValidationError(
        `A group with a similar name already exists (${existing.name}).`
      );
    }

    const group: HarmonyLedgerGroup = {
      groupId,
      name,
      isActive: true,
      createdAt: isoNow(),
      createdBy: profile.userId
    };
    await this.store.createGroup(group);
    return group;
  }

  async updateGroup(
    groupId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<HarmonyLedgerGroup> {
    await this.requireAdmin(auth);
    const parsed = updateGroupSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const existing = await this.store.getGroup(groupId);
    if (!existing) {
      throw new NotFoundError("Group not found");
    }

    const group = await this.store.updateGroup(groupId, parsed.data);
    // Entries and transfers snapshot the group name; keep history readable.
    if (parsed.data.name !== undefined && parsed.data.name !== existing.name) {
      await this.store.updateGroupNameReferences(groupId, parsed.data.name);
    }
    return group;
  }

  async listRecurringTemplates(
    auth: AuthContext
  ): Promise<HarmonyRecurringTemplate[]> {
    await this.requireAccess(auth);
    const templates = await this.store.listRecurringTemplates();
    return templates.sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
  }

  async createRecurringTemplate(
    body: unknown,
    auth: AuthContext
  ): Promise<HarmonyRecurringTemplate> {
    const { profile } = await this.requireAccess(auth);
    const parsed = createRecurringSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const payload = parsed.data;
    let groupName: string | undefined;
    if (payload.groupId) {
      await this.ensureDefaultGroups();
      const group = await this.store.getGroup(payload.groupId);
      if (!group) {
        throw new ValidationError("Unknown Harmony Collective group.");
      }
      groupName = group.name;
    }

    const now = isoNow();
    const template: HarmonyRecurringTemplate = {
      templateId: `hrt_${nanoid(10)}`,
      type: payload.type,
      amount: payload.amount,
      currency: payload.currency,
      description: payload.description,
      source: payload.source,
      category: payload.category,
      groupId: payload.groupId,
      groupName,
      cadence: payload.cadence,
      // First materialization is one cadence out — creating a template
      // alongside a just-recorded entry must not double-post today.
      nextRunAt: advanceCadence(now, payload.cadence),
      isActive: true,
      createdAt: now,
      createdBy: profile.userId,
      createdByName: displayNameFromProfile(profile)
    };

    await this.store.createRecurringTemplate(template);
    return template;
  }

  async updateRecurringTemplate(
    templateId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<HarmonyRecurringTemplate> {
    await this.requireAccess(auth);
    const parsed = updateRecurringSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const { groupId, ...fields } = parsed.data;
    let group: { groupId: string; groupName: string } | null | undefined;
    if (groupId === null) {
      group = null;
    } else if (groupId) {
      await this.ensureDefaultGroups();
      const found = await this.store.getGroup(groupId);
      if (!found) {
        throw new ValidationError("Unknown Harmony Collective group.");
      }
      group = { groupId: found.groupId, groupName: found.name };
    }

    try {
      return await this.store.updateRecurringTemplate(templateId, {
        ...fields,
        group
      });
    } catch (error) {
      if ((error as Error).name === "ConditionalCheckFailedException") {
        throw new NotFoundError("Recurring entry not found");
      }
      throw error;
    }
  }

  async deleteRecurringTemplate(
    templateId: string,
    auth: AuthContext
  ): Promise<void> {
    await this.requireAccess(auth);
    await this.store.deleteRecurringTemplate(templateId);
  }

  /**
   * Materializes every due active template into a ledger entry and advances
   * its schedule. Called from the daily EventBridge target (no auth).
   */
  async materializeDueRecurringEntries(): Promise<number> {
    const templates = await this.store.listRecurringTemplates();
    const now = isoNow();
    let created = 0;

    for (const template of templates) {
      if (!template.isActive) continue;

      let nextRunAt = template.nextRunAt;
      let runs = 0;
      while (nextRunAt <= now && runs < MAX_CATCHUP_RUNS) {
        const entry: HarmonyLedgerEntry = {
          entryId: nanoid(12),
          type: template.type,
          amount: template.amount,
          currency: template.currency,
          description: template.description,
          source: template.source ?? "Recurring",
          category: template.category,
          groupId: template.groupId,
          groupName: template.groupName,
          recordedAt: isoNow(),
          recordedBy: template.createdBy,
          recordedByName: template.createdByName
            ? `${template.createdByName} (recurring)`
            : "Recurring",
          occurredAt: nextRunAt.slice(0, 10)
        };
        await this.store.createEntry(entry);
        created += 1;
        runs += 1;
        nextRunAt = advanceCadence(nextRunAt, template.cadence);
      }

      if (runs > 0) {
        await this.store.updateRecurringTemplate(template.templateId, {
          nextRunAt
        });
      }
    }

    return created;
  }

  async createStatement(
    body: unknown,
    auth: AuthContext
  ): Promise<HarmonyStatementCreateResponse> {
    const { profile } = await this.requireAccess(auth);
    const parsed = createStatementSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const { fileName, contentType, sourceType } = parsed.data;
    const fileType = statementFileTypeFrom(fileName, contentType);
    const statementId = `stmt_${nanoid(10)}`;
    const { storageKey, uploadUrl } = await generateStatementUpload(
      statementId,
      fileName,
      contentType
    );

    const statement: HarmonyStatement = {
      statementId,
      fileName,
      fileType,
      contentType,
      sourceType,
      storageKey,
      status: "PENDING_UPLOAD",
      uploadedAt: isoNow(),
      uploadedBy: profile.userId,
      uploadedByName: displayNameFromProfile(profile)
    };

    await this.statementStore.createStatement(statement);
    return { statement, uploadUrl };
  }

  async listStatements(auth: AuthContext): Promise<HarmonyStatement[]> {
    await this.requireAccess(auth);
    return this.statementStore.listStatements();
  }

  async getStatementDetail(
    statementId: string,
    auth: AuthContext
  ): Promise<HarmonyStatementDetailResponse> {
    await this.requireAccess(auth);
    await this.ensureDefaultGroups();
    const statement = await this.statementStore.getStatement(statementId);
    if (!statement) {
      throw new NotFoundError("Statement not found");
    }
    const [transactions, groups] = await Promise.all([
      this.statementStore.listStagedTransactions(statementId),
      this.store.listGroups()
    ]);
    return { statement, transactions, groups };
  }

  /** Short-lived download URL for the originally uploaded statement file. */
  async getStatementFileUrl(
    statementId: string,
    auth: AuthContext
  ): Promise<{ url: string; fileName: string; contentType: string }> {
    await this.requireAccess(auth);
    const statement = await this.statementStore.getStatement(statementId);
    if (!statement) {
      throw new NotFoundError("Statement not found");
    }
    const url = await generateReceiptDownloadUrl(statement.storageKey);
    return {
      url,
      fileName: statement.fileName,
      contentType: statement.contentType
    };
  }

  private async requirePendingStagedTxn(
    statementId: string,
    txnDate: string,
    txnId: string
  ): Promise<{ statement: HarmonyStatement; txn: HarmonyStagedTransaction }> {
    const statement = await this.statementStore.getStatement(statementId);
    if (!statement) {
      throw new NotFoundError("Statement not found");
    }
    const txn = await this.statementStore.getStagedTransaction(
      statementId,
      txnDate,
      txnId
    );
    if (!txn) {
      throw new NotFoundError("Transaction not found");
    }
    if (txn.status !== "PENDING") {
      throw new ValidationError("This transaction has already been reviewed.");
    }
    return { statement, txn };
  }

  private async createEntryFromStagedTxn(
    statement: HarmonyStatement,
    txn: HarmonyStagedTransaction,
    profile: UserProfile,
    overrides: {
      type?: HarmonyLedgerEntryType;
      group?: { groupId: string; groupName: string } | null;
      description?: string;
      category?: string | null;
      memberName?: string;
      notes?: string;
    }
  ): Promise<HarmonyLedgerEntry> {
    const type = overrides.type ?? txn.suggestedType;
    if (!allowedTypesForDirection(txn.direction).includes(type)) {
      throw new ValidationError(
        txn.direction === "OUT"
          ? "Money going out must be recorded as an EXPENSE."
          : "Money coming in must be a DONATION, INCOME, or REIMBURSEMENT."
      );
    }

    // undefined = use the AI suggestion; null = explicitly unallocated.
    let group: { groupId: string; groupName: string } | undefined;
    if (overrides.group === undefined) {
      if (txn.suggestedGroupId) {
        const suggested = await this.store.getGroup(txn.suggestedGroupId);
        if (suggested) {
          group = { groupId: suggested.groupId, groupName: suggested.name };
        }
      }
    } else if (overrides.group !== null) {
      group = overrides.group;
    }

    const entry: HarmonyLedgerEntry = {
      entryId: nanoid(12),
      type,
      amount: txn.amount,
      currency: txn.currency,
      description: overrides.description ?? txn.rawDescription,
      source: entrySourceForStatement(statement.sourceType),
      category:
        overrides.category === undefined
          ? txn.suggestedCategory
          : (overrides.category ?? undefined),
      notes: overrides.notes,
      memberName: overrides.memberName ?? txn.counterparty,
      groupId: group?.groupId,
      groupName: group?.groupName,
      recordedAt: isoNow(),
      recordedBy: profile.userId,
      recordedByName: displayNameFromProfile(profile),
      occurredAt: txn.txnDate,
      importFingerprint: txn.fingerprint,
      importStatementId: statement.statementId
    };

    await this.store.createEntry(entry);
    if (!txn.duplicateOf) {
      await this.statementStore.attachEntryToFingerprint(
        txn.fingerprint,
        entry.entryId
      );
    }
    return entry;
  }

  private async refreshStatementCounts(
    statementId: string
  ): Promise<HarmonyStatementCounts> {
    const txns = await this.statementStore.listStagedTransactions(statementId);
    const counts = computeStagedCounts(txns);
    await this.statementStore.updateStatementCounts(statementId, counts);
    return counts;
  }

  async confirmStagedTransaction(
    statementId: string,
    txnId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<{ transaction: HarmonyStagedTransaction; entry: HarmonyLedgerEntry }> {
    const { profile } = await this.requireAccess(auth);
    const parsed = confirmTxnSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const payload = parsed.data;
    const { statement, txn } = await this.requirePendingStagedTxn(
      statementId,
      payload.txnDate,
      txnId
    );

    let groupOverride: { groupId: string; groupName: string } | null | undefined;
    if (payload.groupId === null) {
      groupOverride = null;
    } else if (payload.groupId) {
      await this.ensureDefaultGroups();
      const group = await this.store.getGroup(payload.groupId);
      if (!group) {
        throw new ValidationError("Unknown Harmony Collective group.");
      }
      groupOverride = { groupId: group.groupId, groupName: group.name };
    }

    const entry = await this.createEntryFromStagedTxn(statement, txn, profile, {
      type: payload.type,
      group: groupOverride,
      description: payload.description,
      category: payload.category,
      memberName: payload.memberName,
      notes: payload.notes
    });

    const transaction = await this.statementStore.updateStagedTransaction(
      statementId,
      payload.txnDate,
      txnId,
      {
        status: "CONFIRMED",
        createdEntryId: entry.entryId,
        createdEntryRecordedAt: entry.recordedAt,
        reviewedAt: isoNow(),
        reviewedBy: profile.userId,
        reviewedByName: displayNameFromProfile(profile)
      }
    );

    await this.refreshStatementCounts(statementId);
    return { transaction, entry };
  }

  /**
   * Undo a confirm: deletes the ledger entry that was created and puts the
   * transaction back in the review queue.
   */
  async unconfirmStagedTransaction(
    statementId: string,
    txnId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<HarmonyStagedTransaction> {
    const { profile } = await this.requireAccess(auth);
    const parsed = dismissTxnSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const txn = await this.statementStore.getStagedTransaction(
      statementId,
      parsed.data.txnDate,
      txnId
    );
    if (!txn) {
      throw new NotFoundError("Transaction not found");
    }
    if (txn.status !== "CONFIRMED") {
      throw new ValidationError(
        "Only confirmed transactions can be un-confirmed."
      );
    }

    if (txn.createdEntryId && txn.createdEntryRecordedAt) {
      await this.store.deleteEntry(
        txn.createdEntryId,
        txn.createdEntryRecordedAt
      );
      if (!txn.duplicateOf) {
        await this.statementStore.clearEntryFromFingerprint(txn.fingerprint);
      }
    }

    const transaction = await this.statementStore.updateStagedTransaction(
      statementId,
      parsed.data.txnDate,
      txnId,
      {
        status: "PENDING",
        reviewedAt: isoNow(),
        reviewedBy: profile.userId,
        reviewedByName: displayNameFromProfile(profile),
        clearCreatedEntry: true
      }
    );

    await this.refreshStatementCounts(statementId);
    return transaction;
  }

  /** Re-runs the parser on an already-uploaded statement that FAILED. */
  async retryStatement(
    statementId: string,
    auth: AuthContext
  ): Promise<HarmonyStatement> {
    await this.requireAccess(auth);
    const statement = await this.statementStore.getStatement(statementId);
    if (!statement) {
      throw new NotFoundError("Statement not found");
    }
    if (statement.status !== "FAILED") {
      throw new ValidationError("Only failed statements can be retried.");
    }

    // Claim FAILED -> PROCESSING before invoking so duplicate retries no-op.
    const claimed =
      await this.statementStore.claimStatementForProcessing(statementId);
    if (!claimed) {
      throw new ValidationError("This statement is already being parsed.");
    }

    try {
      await invokeStatementParser(statement.storageKey);
    } catch (error) {
      await this.statementStore.updateStatementStatus(statementId, {
        status: "FAILED",
        errorMessage: "Could not start the retry — try again."
      });
      throw error;
    }

    return { ...statement, status: "PROCESSING", errorMessage: undefined };
  }

  async dismissStagedTransaction(
    statementId: string,
    txnId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<HarmonyStagedTransaction> {
    const { profile } = await this.requireAccess(auth);
    const parsed = dismissTxnSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    await this.requirePendingStagedTxn(statementId, parsed.data.txnDate, txnId);

    const transaction = await this.statementStore.updateStagedTransaction(
      statementId,
      parsed.data.txnDate,
      txnId,
      {
        status: "DISMISSED",
        reviewedAt: isoNow(),
        reviewedBy: profile.userId,
        reviewedByName: displayNameFromProfile(profile)
      }
    );

    await this.refreshStatementCounts(statementId);
    return transaction;
  }

  /** Puts a dismissed transaction back in the review queue. */
  async reopenStagedTransaction(
    statementId: string,
    txnId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<HarmonyStagedTransaction> {
    const { profile } = await this.requireAccess(auth);
    const parsed = dismissTxnSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const txn = await this.statementStore.getStagedTransaction(
      statementId,
      parsed.data.txnDate,
      txnId
    );
    if (!txn) {
      throw new NotFoundError("Transaction not found");
    }
    if (txn.status !== "DISMISSED") {
      throw new ValidationError(
        "Only skipped transactions can be restored to the review queue."
      );
    }

    const transaction = await this.statementStore.updateStagedTransaction(
      statementId,
      parsed.data.txnDate,
      txnId,
      {
        status: "PENDING",
        reviewedAt: isoNow(),
        reviewedBy: profile.userId,
        reviewedByName: displayNameFromProfile(profile)
      }
    );

    await this.refreshStatementCounts(statementId);
    return transaction;
  }

  async bulkConfirmStagedTransactions(
    statementId: string,
    body: unknown,
    auth: AuthContext
  ): Promise<HarmonyBulkConfirmResponse> {
    const { profile } = await this.requireAccess(auth);
    const parsed = bulkConfirmSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const includeDuplicates = parsed.data?.includeDuplicates ?? false;

    const statement = await this.statementStore.getStatement(statementId);
    if (!statement) {
      throw new NotFoundError("Statement not found");
    }

    await this.ensureDefaultGroups();
    const txns = await this.statementStore.listStagedTransactions(statementId);
    const pending = txns.filter((txn) => txn.status === "PENDING");
    const eligible = pending.filter(
      (txn) =>
        !txn.isLikelyInternalTransfer &&
        (includeDuplicates || !txn.duplicateOf)
    );
    const batch = eligible.slice(0, BULK_CONFIRM_CAP);

    let confirmed = 0;
    for (const txn of batch) {
      const entry = await this.createEntryFromStagedTxn(
        statement,
        txn,
        profile,
        {}
      );
      await this.statementStore.updateStagedTransaction(
        statementId,
        txn.txnDate,
        txn.txnId,
        {
          status: "CONFIRMED",
          createdEntryId: entry.entryId,
          createdEntryRecordedAt: entry.recordedAt,
          reviewedAt: isoNow(),
          reviewedBy: profile.userId,
          reviewedByName: displayNameFromProfile(profile)
        }
      );
      confirmed += 1;
    }

    const counts = await this.refreshStatementCounts(statementId);
    return {
      confirmed,
      skipped: pending.length - eligible.length,
      remaining: Math.max(0, eligible.length - batch.length),
      counts
    };
  }

  async deleteStatement(statementId: string, auth: AuthContext): Promise<void> {
    await this.requireAccess(auth);
    const statement = await this.statementStore.getStatement(statementId);
    if (!statement) {
      throw new NotFoundError("Statement not found");
    }

    // Fingerprint cleanup reads the staged transactions, so it must run first.
    await this.statementStore.deleteFingerprintsForStatement(statementId);
    await this.statementStore.deleteStagedTransactionsForStatement(statementId);
    try {
      await deleteObject(statement.storageKey);
    } catch (error) {
      console.warn("Failed to delete statement object", {
        statementId,
        error
      });
    }
    await this.statementStore.deleteStatement(statementId);
  }
}
