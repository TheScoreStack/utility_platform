// The itemized split math lives in @utility-platform/shared — the same
// implementation the API uses to persist allocations, so the form preview
// always matches what gets stored.
export {
  buildItemizedAllocations as computeItemizedAllocations,
  splitTotalIntoUnits,
  type ItemizedAllocationDetail,
  type ItemizedAllocationInput,
  type ItemizedAllocationResult,
  type ItemizedLineItem
} from "@utility-platform/shared";
