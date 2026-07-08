import { describe, expect, it } from "vitest";
import { applyGuestClaims, computeSplitShares } from "./splitClaims.js";

const item = (
  lineItemId: string,
  total: number,
  assignedMemberIds: string[] = []
) => ({ lineItemId, description: lineItemId, total, assignedMemberIds });

describe("applyGuestClaims", () => {
  it("adds the guest to chosen items and removes them from the rest", () => {
    const result = applyGuestClaims(
      [item("li1", 10, ["guest"]), item("li2", 20), item("li3", 5)],
      "guest",
      new Set(["li2"])
    );

    expect(result.map((i) => i.assignedMemberIds)).toEqual([
      [],
      ["guest"],
      []
    ]);
  });

  it("shares an item without disturbing other claimants", () => {
    const result = applyGuestClaims(
      [item("li1", 24, ["other", "payer"])],
      "guest",
      new Set(["li1"])
    );

    expect(result[0].assignedMemberIds).toEqual(["other", "payer", "guest"]);
  });

  it("does not duplicate a guest who re-claims the same item", () => {
    const result = applyGuestClaims(
      [item("li1", 10, ["guest"])],
      "guest",
      new Set(["li1"])
    );

    expect(result[0].assignedMemberIds).toEqual(["guest"]);
  });
});

describe("computeSplitShares", () => {
  const base = {
    paidByMemberId: "payer",
    tax: 4,
    tip: 6,
    extrasSplitMode: undefined
  };

  it("keeps a guest's extras share stable as other items get claimed", () => {
    // guest holds 20 of 80 in items → 25% of the 10 in extras, whether the
    // remaining items are unclaimed or claimed by someone else.
    const before = computeSplitShares({
      ...base,
      lineItems: [item("li1", 20, ["guest"]), item("li2", 60)]
    });
    const after = computeSplitShares({
      ...base,
      lineItems: [item("li1", 20, ["guest"]), item("li2", 60, ["other"])]
    });

    const guestBefore = before.find((row) => row.memberId === "guest");
    const guestAfter = after.find((row) => row.memberId === "guest");
    expect(guestBefore?.amount).toBe(22.5);
    expect(guestAfter?.amount).toBe(22.5);
    expect(guestBefore?.extrasAmount).toBe(2.5);
  });

  it("parks unclaimed items (and their extras) with the payer", () => {
    const shares = computeSplitShares({
      ...base,
      lineItems: [item("li1", 20, ["guest"]), item("li2", 60)]
    });

    const payer = shares.find((row) => row.memberId === "payer");
    expect(payer?.itemsAmount).toBe(60);
    expect(payer?.extrasAmount).toBe(7.5);
    const total = shares.reduce((sum, row) => sum + row.amount, 0);
    expect(Math.round(total * 100) / 100).toBe(90);
  });
});
