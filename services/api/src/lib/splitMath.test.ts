import { describe, expect, it } from "vitest";
import { buildItemizedAllocations } from "./splitMath.js";

const sum = (allocations: { amount: number }[]) =>
  Math.round(allocations.reduce((total, a) => total + a.amount, 0) * 100) / 100;

describe("buildItemizedAllocations", () => {
  it("splits each item evenly among its assigned members", () => {
    const result = buildItemizedAllocations({
      lineItems: [
        { total: 20, assignedMemberIds: ["a", "b"] },
        { total: 10, assignedMemberIds: ["b"] }
      ]
    });

    expect(result.itemsSubtotal).toBe(30);
    expect(result.grandTotal).toBe(30);
    expect(result.allocations).toEqual([
      { memberId: "a", amount: 10 },
      { memberId: "b", amount: 20 }
    ]);
  });

  it("keeps cent remainders inside the item's assigned members", () => {
    const result = buildItemizedAllocations({
      lineItems: [{ total: 10, assignedMemberIds: ["a", "b", "c"] }]
    });

    expect(sum(result.allocations)).toBe(10);
    const amounts = result.allocations.map((a) => a.amount).sort();
    expect(amounts).toEqual([3.33, 3.33, 3.34]);
  });

  it("rotates remainder cents across items so one member is not always charged extra", () => {
    const result = buildItemizedAllocations({
      lineItems: [
        { total: 10, assignedMemberIds: ["a", "b", "c"] },
        { total: 10, assignedMemberIds: ["a", "b", "c"] },
        { total: 10, assignedMemberIds: ["a", "b", "c"] }
      ]
    });

    expect(sum(result.allocations)).toBe(30);
    // Each member absorbs the extra cent exactly once across the 3 items.
    expect(result.allocations.map((a) => a.amount)).toEqual([10, 10, 10]);
  });

  it("allocates tax and tip proportionally to each member's item subtotal", () => {
    const result = buildItemizedAllocations({
      lineItems: [
        { total: 30, assignedMemberIds: ["a"] },
        { total: 10, assignedMemberIds: ["b"] }
      ],
      tax: 4,
      tip: 8,
      extrasSplitMode: "proportional"
    });

    // a has 75% of the items, b has 25% — extras total 12.
    expect(result.allocations).toEqual([
      { memberId: "a", amount: 39 },
      { memberId: "b", amount: 13 }
    ]);
    expect(result.grandTotal).toBe(52);
  });

  it("distributes leftover extras cents by largest remainder and still sums exactly", () => {
    const result = buildItemizedAllocations({
      lineItems: [
        { total: 10, assignedMemberIds: ["a"] },
        { total: 10, assignedMemberIds: ["b"] },
        { total: 10, assignedMemberIds: ["c"] }
      ],
      tax: 1,
      extrasSplitMode: "proportional"
    });

    expect(sum(result.allocations)).toBe(31);
    const amounts = result.allocations.map((a) => a.amount).sort();
    expect(amounts).toEqual([10.33, 10.33, 10.34]);
  });

  it("splits extras evenly when requested regardless of item share", () => {
    const result = buildItemizedAllocations({
      lineItems: [
        { total: 90, assignedMemberIds: ["a"] },
        { total: 10, assignedMemberIds: ["b"] }
      ],
      tax: 5,
      tip: 5,
      extrasSplitMode: "even"
    });

    expect(result.allocations).toEqual([
      { memberId: "a", amount: 95 },
      { memberId: "b", amount: 15 }
    ]);
  });

  it("shares an item among multiple members while others keep their own", () => {
    const result = buildItemizedAllocations({
      lineItems: [
        { total: 24, assignedMemberIds: ["a", "b", "c"] },
        { total: 15.5, assignedMemberIds: ["a"] },
        { total: 9.25, assignedMemberIds: ["c"] }
      ],
      tax: 3.9,
      tip: 9.75,
      extrasSplitMode: "proportional"
    });

    expect(sum(result.allocations)).toBe(24 + 15.5 + 9.25 + 3.9 + 9.75);
    const byMember = Object.fromEntries(
      result.allocations.map((a) => [a.memberId, a.amount])
    );
    // a: 8 + 15.50 = 23.50 of 48.75 items; b: 8; c: 17.25
    expect(byMember.a).toBeGreaterThan(byMember.c);
    expect(byMember.c).toBeGreaterThan(byMember.b);
  });

  it("ignores items with no assigned members", () => {
    const result = buildItemizedAllocations({
      lineItems: [
        { total: 10, assignedMemberIds: ["a"] },
        { total: 99, assignedMemberIds: [] }
      ]
    });

    expect(result.itemsSubtotal).toBe(10);
    expect(result.allocations).toEqual([{ memberId: "a", amount: 10 }]);
  });

  it("falls back to an even extras split when items subtotal is zero", () => {
    const result = buildItemizedAllocations({
      lineItems: [{ total: 0, assignedMemberIds: ["a", "b"] }],
      tip: 10,
      extrasSplitMode: "proportional"
    });

    expect(result.allocations).toEqual([
      { memberId: "a", amount: 5 },
      { memberId: "b", amount: 5 }
    ]);
  });
});
