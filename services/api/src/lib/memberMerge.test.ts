import { describe, expect, it } from "vitest";
import { rewriteExpenseMember, rewriteSettlementMember } from "./memberMerge.js";
import type { Expense, Settlement } from "../types.js";

const baseExpense = (overrides: Partial<Expense>): Expense => ({
  tripId: "trip_1",
  expenseId: "exp_1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  description: "Dinner",
  total: 30,
  currency: "USD",
  paidByMemberId: "user_a",
  sharedWithMemberIds: ["user_a", "pm_ghost"],
  allocations: [
    { memberId: "user_a", amount: 15 },
    { memberId: "pm_ghost", amount: 15 }
  ],
  ...overrides
});

describe("rewriteExpenseMember", () => {
  it("returns null when the expense never references the placeholder", () => {
    const expense = baseExpense({
      sharedWithMemberIds: ["user_a"],
      allocations: [{ memberId: "user_a", amount: 30 }]
    });
    expect(rewriteExpenseMember(expense, "pm_ghost", "user_b")).toBeNull();
  });

  it("rewrites payer, shares, and allocations", () => {
    const expense = baseExpense({ paidByMemberId: "pm_ghost" });
    const result = rewriteExpenseMember(expense, "pm_ghost", "user_b")!;
    expect(result.paidByMemberId).toBe("user_b");
    expect(result.sharedWithMemberIds).toEqual(["user_a", "user_b"]);
    expect(result.allocations).toEqual([
      { memberId: "user_a", amount: 15 },
      { memberId: "user_b", amount: 15 }
    ]);
  });

  it("merges allocations when both ids already hold shares", () => {
    const expense = baseExpense({
      sharedWithMemberIds: ["user_a", "user_b", "pm_ghost"],
      allocations: [
        { memberId: "user_a", amount: 10 },
        { memberId: "user_b", amount: 8 },
        { memberId: "pm_ghost", amount: 12 }
      ]
    });
    const result = rewriteExpenseMember(expense, "pm_ghost", "user_b")!;
    expect(result.sharedWithMemberIds).toEqual(["user_a", "user_b"]);
    expect(result.allocations).toEqual([
      { memberId: "user_a", amount: 10 },
      { memberId: "user_b", amount: 20 }
    ]);
    const total = result.allocations.reduce((sum, a) => sum + a.amount, 0);
    expect(total).toBe(30);
  });

  it("rewrites line item assignments with dedupe", () => {
    const expense = baseExpense({
      lineItems: [
        {
          lineItemId: "li_1",
          description: "Shared app",
          total: 10,
          assignedMemberIds: ["user_a", "pm_ghost"]
        },
        {
          lineItemId: "li_2",
          description: "Their dish",
          total: 20,
          assignedMemberIds: ["pm_ghost", "user_b"]
        }
      ]
    });
    const result = rewriteExpenseMember(expense, "pm_ghost", "user_b")!;
    expect(result.lineItems![0].assignedMemberIds).toEqual(["user_a", "user_b"]);
    expect(result.lineItems![1].assignedMemberIds).toEqual(["user_b"]);
  });
});

describe("rewriteSettlementMember", () => {
  const settlement: Settlement = {
    tripId: "trip_1",
    settlementId: "stl_1",
    fromMemberId: "pm_ghost",
    toMemberId: "user_a",
    amount: 20,
    currency: "USD",
    createdAt: "2026-01-01T00:00:00Z",
    createdBy: "user_a"
  };

  it("rewrites either side", () => {
    expect(
      rewriteSettlementMember(settlement, "pm_ghost", "user_b")!.fromMemberId
    ).toBe("user_b");
    expect(
      rewriteSettlementMember(
        { ...settlement, fromMemberId: "user_a", toMemberId: "pm_ghost" },
        "pm_ghost",
        "user_b"
      )!.toMemberId
    ).toBe("user_b");
  });

  it("returns null when untouched", () => {
    expect(
      rewriteSettlementMember(
        { ...settlement, fromMemberId: "user_a", toMemberId: "user_c" },
        "pm_ghost",
        "user_b"
      )
    ).toBeNull();
  });
});
