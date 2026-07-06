import { describe, expect, it } from "vitest";
import type { HarmonyStagedTransaction } from "../types.js";
import {
  allowedTypesForDirection,
  computeStagedCounts,
  entrySourceForStatement,
  slugifyGroupName,
  statementFileTypeFrom
} from "./harmonyLedgerService.js";

process.env.TABLE_NAME = process.env.TABLE_NAME || "test-table";
process.env.RECEIPT_BUCKET = process.env.RECEIPT_BUCKET || "test-bucket";

describe("statementFileTypeFrom", () => {
  it("detects PDFs by content type or extension", () => {
    expect(statementFileTypeFrom("statement.pdf", "application/pdf")).toBe("PDF");
    expect(statementFileTypeFrom("statement.PDF", "application/octet-stream")).toBe(
      "PDF"
    );
  });

  it("detects CSVs by content type or extension", () => {
    expect(statementFileTypeFrom("venmo.csv", "text/csv")).toBe("CSV");
    expect(statementFileTypeFrom("export.Csv", "application/octet-stream")).toBe(
      "CSV"
    );
  });

  it("rejects unsupported files", () => {
    expect(() =>
      statementFileTypeFrom("statement.xlsx", "application/vnd.ms-excel")
    ).toThrowError(/PDF and CSV/);
  });
});

describe("entrySourceForStatement", () => {
  it("maps source types to ledger entry sources", () => {
    expect(entrySourceForStatement("VENMO")).toBe("Venmo");
    expect(entrySourceForStatement("PAYPAL")).toBe("PayPal");
    expect(entrySourceForStatement("BANK")).toBe("Bank import");
    expect(entrySourceForStatement("OTHER")).toBe("Statement import");
  });
});

describe("allowedTypesForDirection", () => {
  it("restricts OUT to EXPENSE", () => {
    expect(allowedTypesForDirection("OUT")).toEqual(["EXPENSE"]);
  });

  it("allows all inflow types for IN", () => {
    expect(allowedTypesForDirection("IN")).toEqual([
      "DONATION",
      "INCOME",
      "REIMBURSEMENT"
    ]);
  });
});

describe("slugifyGroupName", () => {
  it("lowercases and dashes non-alphanumerics", () => {
    expect(slugifyGroupName("Golden Ratio!")).toBe("golden-ratio");
    expect(slugifyGroupName("  Out of Range  ")).toBe("out-of-range");
  });

  it("strips accents and collapses runs", () => {
    expect(slugifyGroupName("Café — Nights")).toBe("cafe-nights");
  });

  it("returns empty for names with no usable characters", () => {
    expect(slugifyGroupName("!!!")).toBe("");
  });
});

describe("computeStagedCounts", () => {
  const txn = (
    status: HarmonyStagedTransaction["status"],
    duplicate = false
  ): HarmonyStagedTransaction => ({
    txnId: `stx_${Math.random().toString(36).slice(2, 8)}`,
    statementId: "stmt_1",
    txnDate: "2026-06-01",
    amount: 10,
    currency: "USD",
    direction: "IN",
    rawDescription: "test",
    suggestedType: "DONATION",
    fingerprint: "fp",
    status,
    ...(duplicate ? { duplicateOf: { kind: "entry" as const, id: "ent_1" } } : {})
  });

  it("tallies statuses and duplicates independently", () => {
    const counts = computeStagedCounts([
      txn("PENDING"),
      txn("PENDING", true),
      txn("CONFIRMED"),
      txn("DISMISSED", true)
    ]);
    expect(counts).toEqual({
      total: 4,
      pending: 2,
      confirmed: 1,
      dismissed: 1,
      duplicates: 2
    });
  });

  it("handles an empty list", () => {
    expect(computeStagedCounts([])).toEqual({
      total: 0,
      pending: 0,
      confirmed: 0,
      dismissed: 0,
      duplicates: 0
    });
  });
});
