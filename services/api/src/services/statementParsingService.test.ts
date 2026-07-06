import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HarmonyLedgerEntry, HarmonyLedgerGroup } from "../types.js";
import {
  buildStatementPrompt,
  chunkCsv,
  computeEntryFingerprints,
  computeFingerprint,
  normalizeDescription,
  parseStatement,
  sanitizeParsedTransaction
} from "./statementParsingService.js";

process.env.TABLE_NAME = process.env.TABLE_NAME || "test-table";
process.env.RECEIPT_BUCKET = process.env.RECEIPT_BUCKET || "test-bucket";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "venmo_sample.csv"
);

const group = (groupId: string, name: string): HarmonyLedgerGroup => ({
  groupId,
  name,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "user_1"
});

describe("normalizeDescription", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeDescription("  Jazz   Night -- DOOR!! ")).toBe(
      "jazz night door"
    );
  });

  it("strips long reference-number runs but keeps short numbers", () => {
    expect(normalizeDescription("Check 42 ref 9932188211002")).toBe(
      "check 42 ref"
    );
  });

  it("truncates to 40 characters", () => {
    const long = "a".repeat(30) + " " + "b".repeat(30);
    expect(normalizeDescription(long).length).toBeLessThanOrEqual(40);
  });
});

describe("computeFingerprint", () => {
  const base = {
    txnDate: "2026-06-02",
    amount: 25,
    direction: "IN" as const,
    description: "Jazz night door"
  };

  it("is stable across formatting differences in the description", () => {
    expect(computeFingerprint(base)).toBe(
      computeFingerprint({ ...base, description: "  JAZZ night   door!! " })
    );
  });

  it("distinguishes cents", () => {
    expect(computeFingerprint(base)).not.toBe(
      computeFingerprint({ ...base, amount: 25.01 })
    );
  });

  it("distinguishes direction", () => {
    expect(computeFingerprint(base)).not.toBe(
      computeFingerprint({ ...base, direction: "OUT" })
    );
  });
});

describe("computeEntryFingerprints", () => {
  it("prefers the exact importFingerprint when present", () => {
    const entry: HarmonyLedgerEntry = {
      entryId: "ent_1",
      type: "INCOME",
      amount: 20,
      currency: "USD",
      description: "merch",
      recordedAt: "2026-06-03T00:00:00.000Z",
      recordedBy: "user_1",
      importFingerprint: "abc123"
    };
    const map = computeEntryFingerprints([entry]);
    expect(map.get("abc123")).toBe("ent_1");
  });

  it("hashes manual entries from occurredAt/recordedAt + amount + description", () => {
    const entry: HarmonyLedgerEntry = {
      entryId: "ent_2",
      type: "EXPENSE",
      amount: 42.99,
      currency: "USD",
      description: "PA cable replacement",
      recordedAt: "2026-06-09T12:00:00.000Z",
      recordedBy: "user_1"
    };
    const map = computeEntryFingerprints([entry]);
    const expected = computeFingerprint({
      txnDate: "2026-06-09",
      amount: 42.99,
      direction: "OUT",
      description: "PA cable replacement"
    });
    expect(map.get(expected)).toBe("ent_2");
  });

  it("skips entries with no description or source", () => {
    const entry: HarmonyLedgerEntry = {
      entryId: "ent_3",
      type: "DONATION",
      amount: 5,
      currency: "USD",
      recordedAt: "2026-06-09T12:00:00.000Z",
      recordedBy: "user_1"
    };
    expect(computeEntryFingerprints([entry]).size).toBe(0);
  });
});

describe("chunkCsv", () => {
  it("returns a single chunk for small files", () => {
    const csv = "a,b\n1,2\n3,4";
    expect(chunkCsv(csv, 200)).toEqual(["a,b\n1,2\n3,4"]);
  });

  it("repeats the header in every chunk and respects the row cap", () => {
    const rows = Array.from({ length: 5 }, (_, i) => `${i},x`);
    const chunks = chunkCsv(["h1,h2", ...rows].join("\n"), 2);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(chunk.startsWith("h1,h2\n")).toBe(true);
    }
    expect(chunks[2]).toBe("h1,h2\n4,x");
  });

  it("skips blank leading lines and drops empty rows", () => {
    const chunks = chunkCsv("\n\nh\n1\n\n2\n", 10);
    expect(chunks).toEqual(["h\n1\n2"]);
  });

  it("returns no chunks for an empty file", () => {
    expect(chunkCsv("\n\n")).toEqual([]);
  });
});

describe("buildStatementPrompt", () => {
  it("includes active group ids and caps context entries", () => {
    const entries: HarmonyLedgerEntry[] = Array.from(
      { length: 150 },
      (_, i) => ({
        entryId: `ent_${i}`,
        type: "INCOME",
        amount: 1,
        currency: "USD",
        description: `entry ${i}`,
        recordedAt: "2026-06-01T00:00:00.000Z",
        recordedBy: "user_1"
      })
    );
    const { system, userPrefix } = buildStatementPrompt({
      sourceType: "VENMO",
      fileType: "CSV",
      context: {
        groups: [
          group("highlyte", "Highlyte"),
          { ...group("retired", "Retired"), isActive: false }
        ],
        recentEntries: entries
      }
    });

    expect(system).toContain("DONATION");
    expect(userPrefix).toContain("highlyte");
    expect(userPrefix).not.toContain("retired");
    expect(userPrefix).toContain("entry 99");
    expect(userPrefix).not.toContain('"entry 100"');
  });
});

describe("sanitizeParsedTransaction", () => {
  const raw = {
    date: "2026-06-02",
    amount: 25,
    currency: "usd",
    direction: "IN",
    description: "Jazz night door",
    counterparty: "Maria Lopez",
    suggestedType: "DONATION",
    suggestedGroupId: "highlyte",
    isLikelyInternalTransfer: false,
    confidence: 0.9
  };
  const validGroups = new Set(["highlyte"]);

  it("passes through a valid row and uppercases the currency", () => {
    const txn = sanitizeParsedTransaction(raw, validGroups);
    expect(txn).toMatchObject({
      txnDate: "2026-06-02",
      amount: 25,
      currency: "USD",
      direction: "IN",
      suggestedType: "DONATION",
      suggestedGroupId: "highlyte",
      counterparty: "Maria Lopez"
    });
  });

  it("clamps unknown group ids to undefined", () => {
    const txn = sanitizeParsedTransaction(
      { ...raw, suggestedGroupId: "made-up" },
      validGroups
    );
    expect(txn?.suggestedGroupId).toBeUndefined();
  });

  it("coerces type to match direction", () => {
    expect(
      sanitizeParsedTransaction(
        { ...raw, direction: "OUT", suggestedType: "DONATION" },
        validGroups
      )?.suggestedType
    ).toBe("EXPENSE");
    expect(
      sanitizeParsedTransaction(
        { ...raw, direction: "IN", suggestedType: "EXPENSE" },
        validGroups
      )?.suggestedType
    ).toBe("INCOME");
  });

  it("takes the absolute value of negative amounts", () => {
    expect(sanitizeParsedTransaction({ ...raw, amount: -12.345 }, validGroups))
      .toMatchObject({ amount: 12.35 });
  });

  it("rejects bad dates and non-positive amounts", () => {
    expect(
      sanitizeParsedTransaction({ ...raw, date: "06/02/2026" }, validGroups)
    ).toBeNull();
    expect(
      sanitizeParsedTransaction({ ...raw, amount: 0 }, validGroups)
    ).toBeNull();
  });

  it("clamps confidence into 0..1", () => {
    expect(
      sanitizeParsedTransaction({ ...raw, confidence: 3 }, validGroups)
        ?.confidence
    ).toBe(1);
  });
});

// Opt-in integration test against real Bedrock. Run with:
//   RUN_BEDROCK=1 npx vitest run statementParsing
describe.runIf(Boolean(process.env.RUN_BEDROCK))(
  "parseStatement (live Bedrock)",
  () => {
    it("parses the Venmo sample CSV", async () => {
      const bytes = readFileSync(fixturePath);
      const txns = await parseStatement({
        bytes,
        fileType: "CSV",
        sourceType: "VENMO",
        context: {
          groups: [
            group("highlyte", "Highlyte"),
            group("counterpoint", "Counterpoint")
          ],
          recentEntries: []
        }
      });

      // 7 completed money movements (the failed payment is skipped).
      expect(txns.length).toBeGreaterThanOrEqual(6);
      const cashout = txns.find((txn) => txn.amount === 150);
      expect(cashout?.isLikelyInternalTransfer).toBe(true);
      expect(txns.every((txn) => txn.amount > 0)).toBe(true);
    }, 120_000);
  }
);
