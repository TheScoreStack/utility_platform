import type { ExtrasSplitMode } from "./types.js";

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

export const roundCents = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const toCents = (value: number): number => Math.round(value * 100);

/**
 * Converts per-line-item member assignments into cent-accurate per-person
 * allocations. Each item's cost is split evenly among the members assigned to
 * it; tax + tip are then layered on top either proportionally to each
 * person's item subtotal or evenly across everyone with an assignment.
 * The returned allocation amounts always sum exactly to
 * items subtotal + tax + tip.
 *
 * Single source of truth: the API derives stored allocations from this and
 * the web form previews with it, so both sides always agree to the cent.
 */
export const buildItemizedAllocations = (
  input: ItemizedAllocationInput
): ItemizedAllocationResult => {
  const { lineItems, tax = 0, tip = 0, extrasSplitMode = "proportional" } = input;

  // Member order is first appearance across items so results are stable.
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
      // Largest-remainder method: floor each proportional share, then hand
      // leftover cents to the members with the biggest truncated fraction.
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

/**
 * Splits a printed quantity line ("4 Breakfast Hash  68.00") into per-unit
 * amounts that sum exactly to the line total — the first units absorb any
 * leftover cents.
 */
export const splitTotalIntoUnits = (
  total: number,
  quantity: number
): number[] => {
  if (quantity <= 1) return [total];
  const totalCents = Math.round(total * 100);
  const base = Math.floor(totalCents / quantity);
  let remainder = totalCents - base * quantity;
  return Array.from({ length: quantity }, () => {
    let cents = base;
    if (remainder > 0) {
      cents += 1;
      remainder -= 1;
    }
    return cents / 100;
  });
};
