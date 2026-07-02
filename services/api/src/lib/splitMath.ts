import {
  buildItemizedAllocations as buildDetailedItemizedAllocations,
  roundCents,
  type ItemizedAllocationInput,
  type ItemizedLineItem
} from "@utility-platform/shared";

export { roundCents };
export type { ItemizedAllocationInput, ItemizedLineItem };

export interface ItemizedAllocationResult {
  allocations: { memberId: string; amount: number }[];
  itemsSubtotal: number;
  extrasTotal: number;
  grandTotal: number;
}

/**
 * Thin adapter over the shared implementation: the API stores plain
 * { memberId, amount } allocations, so the per-member items/extras breakdown
 * is stripped before anything reaches DynamoDB.
 */
export const buildItemizedAllocations = (
  input: ItemizedAllocationInput
): ItemizedAllocationResult => {
  const result = buildDetailedItemizedAllocations(input);
  return {
    ...result,
    allocations: result.allocations.map(({ memberId, amount }) => ({
      memberId,
      amount
    }))
  };
};
