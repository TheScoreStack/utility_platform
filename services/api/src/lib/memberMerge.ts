import type { Expense, ExpenseAllocation, Settlement } from "../types.js";
import { roundCents } from "./splitMath.js";

/** Replaces ids in a list, deduplicating if the target was already present. */
const rewriteIdList = (ids: string[], from: string, to: string): string[] => {
  if (!ids.includes(from)) return ids;
  const next: string[] = [];
  for (const id of ids) {
    const mapped = id === from ? to : id;
    if (!next.includes(mapped)) next.push(mapped);
  }
  return next;
};

/** Merges allocations after a rewrite: if both ids held an allocation, the
 *  amounts combine so the expense total stays intact. */
const rewriteAllocations = (
  allocations: ExpenseAllocation[],
  from: string,
  to: string
): ExpenseAllocation[] => {
  if (!allocations.some((allocation) => allocation.memberId === from)) {
    return allocations;
  }
  const merged = new Map<string, number>();
  const order: string[] = [];
  for (const allocation of allocations) {
    const memberId = allocation.memberId === from ? to : allocation.memberId;
    if (!merged.has(memberId)) order.push(memberId);
    merged.set(
      memberId,
      roundCents((merged.get(memberId) ?? 0) + allocation.amount)
    );
  }
  return order.map((memberId) => ({
    memberId,
    amount: merged.get(memberId) ?? 0
  }));
};

/**
 * Rewrites every reference to a placeholder member onto a real user id.
 * Returns the updated expense, or null when the expense doesn't reference
 * the placeholder at all (so callers only write what changed).
 */
export const rewriteExpenseMember = (
  expense: Expense,
  from: string,
  to: string
): Expense | null => {
  const referencesLineItems = (expense.lineItems ?? []).some((item) =>
    item.assignedMemberIds.includes(from)
  );
  const touches =
    expense.paidByMemberId === from ||
    expense.sharedWithMemberIds.includes(from) ||
    expense.allocations.some((allocation) => allocation.memberId === from) ||
    referencesLineItems;
  if (!touches) return null;

  return {
    ...expense,
    paidByMemberId: expense.paidByMemberId === from ? to : expense.paidByMemberId,
    sharedWithMemberIds: rewriteIdList(expense.sharedWithMemberIds, from, to),
    allocations: rewriteAllocations(expense.allocations, from, to),
    lineItems: expense.lineItems?.map((item) =>
      item.assignedMemberIds.includes(from)
        ? { ...item, assignedMemberIds: rewriteIdList(item.assignedMemberIds, from, to) }
        : item
    )
  };
};

/** Same as {@link rewriteExpenseMember} for settlements. */
export const rewriteSettlementMember = (
  settlement: Settlement,
  from: string,
  to: string
): Settlement | null => {
  if (settlement.fromMemberId !== from && settlement.toMemberId !== from) {
    return null;
  }
  return {
    ...settlement,
    fromMemberId: settlement.fromMemberId === from ? to : settlement.fromMemberId,
    toMemberId: settlement.toMemberId === from ? to : settlement.toMemberId
  };
};
