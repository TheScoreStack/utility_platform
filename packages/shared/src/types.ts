// Domain entity types shared between the API (services/api) and the web app
// (apps/web). Each consumer re-exports these from its own types module and
// adds package-specific types (API response shapes, service DTOs) locally.

export interface Trip {
  tripId: string;
  ownerId: string;
  name: string;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  updatedAt: string;
  currency: string;
  archivedAt?: string;
  archivedBy?: string;
}

export interface TripMember {
  tripId: string;
  memberId: string;
  displayName: string;
  email?: string;
  addedBy: string;
  createdAt: string;
  paymentMethods?: PaymentMethods;
  /** True for members added by name only, before they have an account.
   *  Claimed (merged into a real user) when they redeem the trip invite. */
  placeholder?: boolean;
}

export type PaymentMethodKey = "venmo" | "paypal" | "zelle";

export interface PaymentMethods {
  venmo?: string;
  paypal?: string;
  zelle?: string;
  /** The method this person prefers to be paid through. */
  primary?: PaymentMethodKey;
}

export type RecurrenceCadence = "weekly" | "monthly";

/** Template that materializes an evenly split expense on a schedule. */
export interface RecurringExpense {
  tripId: string;
  recurringId: string;
  description: string;
  total: number;
  currency: string;
  paidByMemberId: string;
  sharedWithMemberIds: string[];
  cadence: RecurrenceCadence;
  /** ISO timestamp of the next materialization. */
  nextRunAt: string;
  lastRunAt?: string;
  createdBy: string;
  createdAt: string;
}

export interface TripInvite {
  tripId: string;
  inviteId: string;
  createdBy: string;
  createdAt: string;
}

export interface ExpenseComment {
  tripId: string;
  expenseId: string;
  commentId: string;
  authorId: string;
  authorName?: string;
  body: string;
  createdAt: string;
}

export interface ExpenseAllocation {
  memberId: string;
  amount: number;
}

export interface ExpenseLineItem {
  lineItemId: string;
  description: string;
  quantity?: number;
  unitPrice?: number;
  total: number;
  assignedMemberIds: string[];
}

export type ExtrasSplitMode = "proportional" | "even";

export interface Expense {
  tripId: string;
  expenseId: string;
  createdAt: string;
  updatedAt: string;
  description: string;
  vendor?: string;
  category?: string;
  total: number;
  currency: string;
  tax?: number;
  tip?: number;
  paidByMemberId: string;
  sharedWithMemberIds: string[];
  allocations: ExpenseAllocation[];
  lineItems?: ExpenseLineItem[];
  extrasSplitMode?: ExtrasSplitMode;
  receiptId?: string;
  receiptPreviewUrl?: string;
  /** Draft expenses are visible only to their creator and excluded from
   *  balances until published. */
  draft?: boolean;
  createdBy?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface Receipt {
  tripId: string;
  receiptId: string;
  storageKey: string;
  uploadUrl: string;
  fileName: string;
  status: "PENDING_UPLOAD" | "UPLOADED" | "PROCESSING" | "COMPLETED" | "FAILED";
  extractedData?: TextractExtraction;
  /** Receipts uploaded for a draft expense stay hidden from other members
   *  until the expense is published. */
  draft?: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TextractExtraction {
  merchantName?: string;
  total?: number;
  subtotal?: number;
  tax?: number;
  tip?: number;
  date?: string;
  lineItems?: Array<{
    description?: string;
    quantity?: number;
    unitPrice?: number;
    total?: number;
  }>;
}

export interface Settlement {
  tripId: string;
  settlementId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  currency: string;
  note?: string;
  createdAt: string;
  confirmedAt?: string;
  createdBy: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface NotificationPrefs {
  /** Expense/settlement/join/recurring pushes. Default true. */
  activity?: boolean;
  /** Comment pushes. Default true. */
  comments?: boolean;
}

export interface UserProfile {
  userId: string;
  displayName?: string;
  email?: string;
  displayNameLower?: string;
  paymentMethods?: PaymentMethods;
  createdAt?: string;
  updatedAt?: string;
  emailDigestOptIn?: boolean;
  notificationPrefs?: NotificationPrefs;
}

export type HarmonyLedgerEntryType =
  | "DONATION"
  | "INCOME"
  | "EXPENSE"
  | "REIMBURSEMENT";

export interface HarmonyLedgerEntry {
  entryId: string;
  type: HarmonyLedgerEntryType;
  amount: number;
  currency: string;
  description?: string;
  source?: string;
  category?: string;
  notes?: string;
  memberName?: string;
  groupId?: string;
  groupName?: string;
  recordedAt: string;
  recordedBy: string;
  recordedByName?: string;
  /** Actual transaction date (YYYY-MM-DD) for statement imports. */
  occurredAt?: string;
  importFingerprint?: string;
  importStatementId?: string;
}

export interface HarmonyLedgerAccessRecord {
  accessId: string;
  userId?: string;
  email?: string;
  displayName?: string;
  isAdmin: boolean;
  addedAt: string;
  addedBy: string;
  addedByName?: string;
}

export interface HarmonyLedgerGroup {
  groupId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
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

export interface HarmonyLedgerUnallocatedSummary {
  donations: number;
  income: number;
  expenses: number;
  reimbursements: number;
  transfersIn: number;
  transfersOut: number;
  net: number;
}

export interface HarmonyLedgerTransfer {
  transferId: string;
  amount: number;
  currency: string;
  fromGroupId?: string;
  fromGroupName?: string;
  toGroupId?: string;
  toGroupName?: string;
  note?: string;
  createdAt: string;
  createdBy: string;
  createdByName?: string;
}

// Harmony statement import types

export type HarmonyStatementSourceType = "BANK" | "VENMO" | "PAYPAL" | "OTHER";

export type HarmonyStatementFileType = "PDF" | "CSV" | "IMAGE";

export type HarmonyStatementStatus =
  | "PENDING_UPLOAD"
  | "PROCESSING"
  | "PARSED"
  | "FAILED";

export interface HarmonyStatementCounts {
  total: number;
  pending: number;
  confirmed: number;
  dismissed: number;
  duplicates: number;
}

export interface HarmonyStatement {
  statementId: string;
  fileName: string;
  fileType: HarmonyStatementFileType;
  contentType: string;
  sourceType: HarmonyStatementSourceType;
  storageKey: string;
  status: HarmonyStatementStatus;
  errorMessage?: string;
  counts?: HarmonyStatementCounts;
  uploadedAt: string;
  uploadedBy: string;
  uploadedByName?: string;
  parsedAt?: string;
}

export type HarmonyStagedTxnStatus = "PENDING" | "CONFIRMED" | "DISMISSED";

export type HarmonyTxnDirection = "IN" | "OUT";

export interface HarmonyStagedTransaction {
  txnId: string;
  statementId: string;
  /** Transaction date, YYYY-MM-DD. */
  txnDate: string;
  /** Always positive; see direction. */
  amount: number;
  currency: string;
  direction: HarmonyTxnDirection;
  rawDescription: string;
  /** Other party for Venmo/PayPal transactions. */
  counterparty?: string;
  suggestedType: HarmonyLedgerEntryType;
  suggestedGroupId?: string;
  suggestedGroupName?: string;
  /** AI-suggested bookkeeping category (short free text, e.g. "supplies"). */
  suggestedCategory?: string;
  /** AI hint: likely a transfer between the collective's own accounts. */
  isLikelyInternalTransfer?: boolean;
  /** 0..1 */
  confidence?: number;
  fingerprint: string;
  duplicateOf?: { kind: "entry" | "staged"; id: string };
  status: HarmonyStagedTxnStatus;
  createdEntryId?: string;
  /** recordedAt of the created entry — needed to delete it on un-confirm. */
  createdEntryRecordedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewedByName?: string;
}

export type HarmonyRecurringCadence = "weekly" | "monthly";

/** Template that materializes into a ledger entry on a schedule. */
export interface HarmonyRecurringTemplate {
  templateId: string;
  type: HarmonyLedgerEntryType;
  amount: number;
  currency: string;
  description?: string;
  source?: string;
  category?: string;
  groupId?: string;
  groupName?: string;
  cadence: HarmonyRecurringCadence;
  /** ISO timestamp of the next materialization. */
  nextRunAt: string;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
  createdByName?: string;
}

// Stack Time Tracking types

export interface StackTimeProject {
  projectId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
}

export interface StackTimeEntry {
  entryId: string;
  userId: string;
  userDisplayName?: string;
  projectId: string;
  projectName?: string;
  date: string; // YYYY-MM-DD
  hours: number;
  description?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByName?: string;
}

export interface StackTimeAccessRecord {
  accessId: string;
  userId?: string;
  email?: string;
  displayName?: string;
  isAdmin: boolean;
  addedAt: string;
  addedBy: string;
  addedByName?: string;
}
