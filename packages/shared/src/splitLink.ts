// Split-link types: a shareable, unauthenticated page where guests claim
// the receipt items they had, see their share (items + proportional tax/tip),
// and mark the payment done. Shared between the API and the web claim page.

import type { ExtrasSplitMode, PaymentMethods } from "./types.js";
import type { ItemizedAllocationDetail } from "./splitMath.js";

export interface ExpenseSplitLink {
  tripId: string;
  expenseId: string;
  shareId: string;
  createdBy: string;
  createdAt: string;
}

/** One person's claim session on a split link. The secret itself is issued
 *  exactly once at join time; only its hash is stored. */
export interface SplitLinkGuest {
  memberId: string;
  displayName: string;
  createdAt: string;
  /** Set when the guest joined signed in — their claims are account-backed,
   *  not just a name someone typed. */
  userId?: string;
  completedAt?: string;
  settlementId?: string;
  /** What the guest owed at the moment they marked the payment sent. */
  completedAmount?: number;
}

export interface SplitSnapshotItem {
  lineItemId: string;
  description: string;
  quantity?: number;
  total: number;
  /** Empty means unclaimed — the cost sits with the payer for now. */
  assignedMemberIds: string[];
}

export interface SplitSnapshotMember {
  memberId: string;
  displayName: string;
  placeholder?: boolean;
}

/** Everything the public claim page needs. Deliberately excludes emails,
 *  other expenses, balances, and anything else about the trip. */
export interface SplitLinkSnapshot {
  shareId: string;
  expense: {
    description: string;
    vendor?: string;
    currency: string;
    total: number;
    tax?: number;
    tip?: number;
    extrasSplitMode: ExtrasSplitMode;
    lineItems: SplitSnapshotItem[];
  };
  payer: SplitSnapshotMember & { paymentMethods?: PaymentMethods };
  members: SplitSnapshotMember[];
  /** Per-member share as claimed right now; unclaimed items count toward
   *  the payer's row. Always sums to the bill total. */
  shares: ItemizedAllocationDetail[];
  guests: Array<
    Pick<SplitLinkGuest, "memberId" | "completedAt" | "completedAmount"> & {
      /** True when this claimer joined from a signed-in account. */
      verified?: boolean;
      /** True once the payer confirmed the settlement — the completion can
       *  no longer be undone from the claim page. */
      completedConfirmed?: boolean;
    }
  >;
}

export interface SplitLinkJoinResponse {
  memberId: string;
  displayName: string;
  secret: string;
}
