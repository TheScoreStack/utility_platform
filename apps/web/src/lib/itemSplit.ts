import type { ExtrasSplitMode } from "../types";

export interface ItemizedLineItem {
  total: number;
  assignedMemberIds: string[];
}

export interface ItemizedAllocationInput {
  lineItems: ItemizedLineItem[];
  tax?: number;
  tip?: number;
  extrasSplitMode?: ExtrasSplitMode;
}

export interface ItemizedAllocationDetail {
  memberId: string;
  itemsAmount: number;
  extrasAmount: number;
  amount: number;
}

export interface ItemizedAllocationResult {
  allocations: ItemizedAllocationDetail[];
  itemsSubtotal: number;
  extrasTotal: number;
  grandTotal: number;
}

const toCents = (value: number): number => Math.round(value * 100);

/**
 * Client mirror of the server's buildItemizedAllocations (services/api/src/lib/splitMath.ts).
 * The algorithms must stay identical so the preview shown in the form matches
 * what the API persists. All math is integer cents; the allocations always
 * sum exactly to items subtotal + tax + tip.
 */
export const computeItemizedAllocations = (
  input: ItemizedAllocationInput
): ItemizedAllocationResult => {
  const { lineItems, tax = 0, tip = 0, extrasSplitMode = "proportional" } = input;

  const memberOrder: string[] = [];
  const itemCentsByMember = new Map<string, number>();
  const track = (memberId: string) => {
    if (!itemCentsByMember.has(memberId)) {
      itemCentsByMember.set(memberId, 0);
      memberOrder.push(memberId);
    }
  };

  let itemsSubtotalCents = 0;
  lineItems.forEach((item, itemIndex) => {
    const assigned = item.assignedMemberIds;
    if (!assigned.length) return;
    const cents = toCents(item.total);
    itemsSubtotalCents += cents;

    const base = Math.floor(cents / assigned.length);
    let remainder = cents - base * assigned.length;
    assigned.forEach((memberId) => track(memberId));
    // Rotate who absorbs leftover cents by item index so no single member
    // is systematically overcharged across a long receipt.
    for (let i = 0; i < assigned.length; i += 1) {
      const memberId = assigned[(i + itemIndex) % assigned.length];
      let share = base;
      if (remainder > 0) {
        share += 1;
        remainder -= 1;
      }
      itemCentsByMember.set(
        memberId,
        (itemCentsByMember.get(memberId) ?? 0) + share
      );
    }
  });

  const extrasCents = toCents(tax) + toCents(tip);
  const extrasByMember = new Map<string, number>();

  if (memberOrder.length > 0 && extrasCents !== 0) {
    if (extrasSplitMode === "even" || itemsSubtotalCents === 0) {
      const base = Math.floor(extrasCents / memberOrder.length);
      let remainder = extrasCents - base * memberOrder.length;
      memberOrder.forEach((memberId) => {
        let share = base;
        if (remainder > 0) {
          share += 1;
          remainder -= 1;
        }
        extrasByMember.set(memberId, share);
      });
    } else {
      let assignedCents = 0;
      const fractions = memberOrder.map((memberId, index) => {
        const itemCents = itemCentsByMember.get(memberId) ?? 0;
        const exact = (extrasCents * itemCents) / itemsSubtotalCents;
        const floored = Math.floor(exact);
        assignedCents += floored;
        extrasByMember.set(memberId, floored);
        return { memberId, index, fraction: exact - floored };
      });
      let leftover = extrasCents - assignedCents;
      fractions.sort((a, b) => b.fraction - a.fraction || a.index - b.index);
      for (const entry of fractions) {
        if (leftover <= 0) break;
        extrasByMember.set(
          entry.memberId,
          (extrasByMember.get(entry.memberId) ?? 0) + 1
        );
        leftover -= 1;
      }
    }
  }

  const allocations = memberOrder.map((memberId) => {
    const itemsCents = itemCentsByMember.get(memberId) ?? 0;
    const extras = extrasByMember.get(memberId) ?? 0;
    return {
      memberId,
      itemsAmount: itemsCents / 100,
      extrasAmount: extras / 100,
      amount: (itemsCents + extras) / 100
    };
  });

  return {
    allocations,
    itemsSubtotal: itemsSubtotalCents / 100,
    extrasTotal: extrasCents / 100,
    grandTotal:
      (itemsSubtotalCents + (memberOrder.length ? extrasCents : 0)) / 100
  };
};
