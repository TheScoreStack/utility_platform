// Domain entity types live in @utility-platform/shared so the API and the
// web app can't drift apart. Types below are web-only API response shapes;
// add anything the API also uses to packages/shared instead.
export * from "@utility-platform/shared";

import type {
  Expense,
  MeetAvailability,
  MeetEvent,
  MeetMode,
  MeetParticipant,
  MeetStatus,
  MeetSuggestion,
  RecurringExpense,
  HarmonyLedgerAccessRecord,
  HarmonyLedgerEntry,
  HarmonyLedgerGroup,
  HarmonyLedgerGroupSummary,
  HarmonyLedgerTransfer,
  HarmonyLedgerUnallocatedSummary,
  HarmonyRecurringTemplate,
  HarmonyStagedTransaction,
  HarmonyStatement,
  HarmonyStatementCounts,
  Receipt,
  Settlement,
  StackTimeAccessRecord,
  StackTimeEntry,
  Trip,
  TripMember
} from "@utility-platform/shared";

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
  recurringExpenses?: RecurringExpense[];
  currentUserId: string;
}

export interface BalanceRow {
  memberId: string;
  displayName: string;
  balance: number;
}

export interface TripListResponse {
  trips: Trip[];
}

export interface ReceiptUploadResponse {
  tripId: string;
  receiptId: string;
  storageKey: string;
  uploadUrl: string;
  fileName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvitePreview {
  tripId: string;
  tripName: string;
  memberCount: number;
  alreadyMember: boolean;
  /** Unclaimed placeholder members the joiner might be. */
  placeholders?: Array<{ memberId: string; displayName: string }>;
}

/** Denormalized row from GET /meet/events (GSI1 participant projection). */
export interface MeetEventSummary {
  eventId: string;
  title: string;
  status: MeetStatus;
  mode: MeetMode;
  role: "organizer" | "participant";
  firstDate?: string;
  lastDate?: string;
}

export interface MeetListResponse {
  events: MeetEventSummary[];
}

export interface MeetEventResponse {
  event: MeetEvent;
}

export interface MeetEventDetailResponse {
  event: MeetEvent;
  participants: MeetParticipant[];
  suggestions: MeetSuggestion[];
}

/** Sanitized participant shape returned by the public /meet-public routes. */
export interface MeetPublicParticipant {
  participantId: string;
  displayName: string;
  timezone?: string;
  role: "organizer" | "participant";
  availability: MeetAvailability;
  respondedAt?: string;
}

export interface MeetPublicSnapshot {
  event: MeetEvent;
  participants: MeetPublicParticipant[];
  suggestions: MeetSuggestion[];
  version: number;
}

export interface MeetPublicPollResponse extends Partial<MeetPublicSnapshot> {
  version: number;
  unchanged?: boolean;
}

export interface MeetJoinResponse {
  participant: MeetPublicParticipant;
  /** Guest write credential — returned exactly once, persisted client-side. */
  secret: string;
}

export interface HarmonyLedgerTotals {
  donations: number;
  income: number;
  expenses: number;
  reimbursements: number;
  net: number;
}

export interface HarmonyLedgerEntriesResponse {
  entries: HarmonyLedgerEntry[];
  totals: HarmonyLedgerTotals;
  groups: HarmonyLedgerGroup[];
  groupSummaries: HarmonyLedgerGroupSummary[];
  unallocated: HarmonyLedgerUnallocatedSummary;
  transfers: HarmonyLedgerTransfer[];
}

export interface HarmonyLedgerOverviewResponse {
  totals: HarmonyLedgerTotals;
  groups: HarmonyLedgerGroupSummary[];
  unallocated: HarmonyLedgerUnallocatedSummary;
  transfers: HarmonyLedgerTransfer[];
}

export interface HarmonyLedgerAccessResponse {
  allowed: boolean;
  isAdmin: boolean;
  currentAccessId?: string;
  members?: HarmonyLedgerAccessRecord[];
}

export interface HarmonyStatementsResponse {
  statements: HarmonyStatement[];
}

export interface HarmonyStatementCreateResponse {
  statement: HarmonyStatement;
  uploadUrl: string;
}

export interface HarmonyStatementDetailResponse {
  statement: HarmonyStatement;
  transactions: HarmonyStagedTransaction[];
  groups: HarmonyLedgerGroup[];
}

export interface HarmonyStatementConfirmResponse {
  transaction: HarmonyStagedTransaction;
  entry: HarmonyLedgerEntry;
}

/** Shape shared by the dismiss and reopen staged-transaction endpoints. */
export interface HarmonyStatementTransactionResponse {
  transaction: HarmonyStagedTransaction;
}

export interface HarmonyStatementBulkConfirmResponse {
  confirmed: number;
  skipped: number;
  remaining: number;
  counts: HarmonyStatementCounts;
}

export interface HarmonyRecurringTemplatesResponse {
  templates: HarmonyRecurringTemplate[];
}

export interface StackTimeAccessResponse {
  allowed: boolean;
  isAdmin: boolean;
  currentAccessId?: string;
  members?: StackTimeAccessRecord[];
}

export interface StackTimeEntriesResponse {
  entries: StackTimeEntry[];
  totalHours: number;
}

export interface StackTimeReportByProject {
  projectId: string;
  projectName: string;
  totalHours: number;
  entryCount: number;
}

export interface StackTimeReportByPerson {
  userId: string;
  displayName: string;
  totalHours: number;
  entryCount: number;
  byProject: StackTimeReportByProject[];
}

export interface WeeklyBreakdown {
  weekStart: string;
  weekEnd: string;
  hours: number;
  entryCount: number;
}

export interface MemberTimelineStats {
  userId: string;
  displayName: string;
  totalHours: number;
  entryCount: number;
  avgHoursPerEntry: number;
  avgHoursPerWeek: number;
  activeDays: number;
  firstEntryDate: string | null;
  lastEntryDate: string | null;
  weeklyBreakdown: WeeklyBreakdown[];
  byProject: StackTimeReportByProject[];
}

export interface TimelineStatsResponse {
  startDate: string;
  endDate: string;
  totalHours: number;
  totalEntries: number;
  activeMembers: number;
  weeksInPeriod: number;
  members: MemberTimelineStats[];
}
