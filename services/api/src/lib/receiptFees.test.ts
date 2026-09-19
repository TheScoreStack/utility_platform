import { describe, expect, it } from "vitest";
import { sumReceiptFees } from "./receiptFees.js";

const field = (type: string, value: string, label?: string) => ({
  Type: { Text: type },
  LabelDetection: label ? { Text: label } : undefined,
  ValueDetection: { Text: value }
});

describe("sumReceiptFees", () => {
  it("returns undefined when the receipt has no fee-like fields", () => {
    expect(
      sumReceiptFees([field("TAX", "$1.20"), field("GRATUITY", "$3.00")])
    ).toBeUndefined();
  });

  it("sums Textract's typed charges with OTHER fields labelled as fees", () => {
    expect(
      sumReceiptFees([
        field("SUBTOTAL", "$24.00"),
        field("SERVICE_CHARGE", "$2.99"),
        field("OTHER", "$1.99", "Delivery Fee"),
        field("OTHER", "$0.50", "Small order fee"),
        field("TAX", "$1.80")
      ])
    ).toBe(5.48);
  });

  it("does not treat tips, taxes, or promos filed under OTHER as fees", () => {
    expect(
      sumReceiptFees([
        field("OTHER", "$4.00", "Dasher Tip"),
        field("OTHER", "$1.00", "Delivery tax"),
        field("OTHER", "-$3.00", "Delivery fee promo"),
        field("OTHER", "$12.00", "Order total")
      ])
    ).toBeUndefined();
  });

  it("ignores negative amounts so a waived fee never reduces the total", () => {
    expect(
      sumReceiptFees([
        field("OTHER", "-$2.99", "Delivery Fee"),
        field("SERVICE_CHARGE", "$1.50")
      ])
    ).toBe(1.5);
  });
});
