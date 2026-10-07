import { describe, expect, it } from "vitest";
import { fuzzyStart, sanitizeQuickAddLines } from "./atlasQuickAdd.js";

describe("fuzzyStart", () => {
  it("keeps only the parts that are valid", () => {
    expect(fuzzyStart(2019)).toEqual({ start: "2019", datePrecision: "year" });
    expect(fuzzyStart(2019, 7)).toEqual({ start: "2019-07", datePrecision: "month" });
    expect(fuzzyStart(2019, 2, 30)).toEqual({ start: "2019-02", datePrecision: "month" });
    expect(fuzzyStart(2019, 7, 4)).toEqual({ start: "2019-07-04", datePrecision: "day" });
    expect(fuzzyStart(1700)).toEqual({});
  });
});

describe("sanitizeQuickAddLines", () => {
  const known = new Set(["solo", "circle_wife"]);
  it("clamps model output into usable drafts", () => {
    const lines = sanitizeQuickAddLines(
      {
        trips: [
          { line: "Lisbon 2019 solo", title: "Lisbon", places: ["Lisbon, Portugal"], year: 2019, circleIds: ["solo"] },
          { line: "Napa w/ wife", title: "", places: ["Napa, California"], circleIds: ["circle_wife", "solo", "ghost"] },
          { line: "???", title: "Nothing", places: [], circleIds: [] }
        ]
      },
      known
    );
    expect(lines).toEqual([
      { line: "Lisbon 2019 solo", title: "Lisbon", places: ["Lisbon, Portugal"], start: "2019", datePrecision: "year", circleIds: ["solo"] },
      { line: "Napa w/ wife", title: "Napa, California", places: ["Napa, California"], circleIds: ["circle_wife"] }
    ]);
  });
  it("tolerates garbage", () => {
    expect(sanitizeQuickAddLines(null, known)).toEqual([]);
    expect(sanitizeQuickAddLines({ trips: "nope" }, known)).toEqual([]);
  });
});
