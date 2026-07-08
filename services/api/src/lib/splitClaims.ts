// Pure split-link math, kept free of service imports (push, stores) so it
// can be unit-tested and reused by previews without dragging in AWS config.

import { buildItemizedAllocations } from "@utility-platform/shared";
import type { Expense } from "../types.js";

/** The per-member breakdown for the expense as claimed right now. Unclaimed
 *  items ride with the payer, which keeps every guest's tax/tip share
 *  pro-rated against the FULL bill — stable no matter who has claimed yet. */
export const computeSplitShares = (
  expense: Pick<
    Expense,
    "lineItems" | "tax" | "tip" | "extrasSplitMode" | "paidByMemberId"
  >
) =>
  buildItemizedAllocations({
    lineItems: expense.lineItems ?? [],
    tax: expense.tax,
    tip: expense.tip,
    extrasSplitMode: expense.extrasSplitMode ?? "proportional",
    unassignedMemberId: expense.paidByMemberId
  }).allocations;

/** Replaces one guest's item selection: added to every chosen item (sharing
 *  it with anyone else who also picked it), removed from the rest. Other
 *  members' assignments are untouched. */
export const applyGuestClaims = <
  T extends { lineItemId: string; assignedMemberIds: string[] }
>(
  lineItems: T[],
  memberId: string,
  chosenLineItemIds: ReadonlySet<string>
): T[] =>
  lineItems.map((item) => {
    const others = item.assignedMemberIds.filter((id) => id !== memberId);
    return {
      ...item,
      assignedMemberIds: chosenLineItemIds.has(item.lineItemId)
        ? [...others, memberId]
        : others
    };
  });
