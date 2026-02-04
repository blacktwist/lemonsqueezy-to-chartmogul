import { describe, it, expect } from "vitest";
import {
  calculateTaxFromGross,
  taxRateToDecimal,
  calculateGrossAmountForChartMogul,
  calculateServicePeriodEnd,
  shouldSkipSubscriptionStatus,
  isTrialSubscription,
  shouldSkipInvoiceStatus,
  buildInvoiceTransactions,
  buildLineItem,
  getPlanExternalId,
} from "./sync-utils.js";

describe("calculateTaxFromGross", () => {
  it("should calculate tax correctly for UK 20% VAT", () => {
    // Customer pays $22.80 (2280 cents) including 20% VAT
    // Net should be $19 (1900 cents), tax should be $3.80 (380 cents)
    const result = calculateTaxFromGross(2280, 0.2);

    expect(result.grossAmount).toBe(2280);
    expect(result.netAmount).toBe(1900);
    expect(result.taxAmount).toBe(380);
  });

  it("should calculate tax correctly for EU 19% VAT", () => {
    // 119 cents gross with 19% VAT = 100 cents net + 19 cents tax
    const result = calculateTaxFromGross(1190, 0.19);

    expect(result.grossAmount).toBe(1190);
    expect(result.netAmount).toBe(1000);
    expect(result.taxAmount).toBe(190);
  });

  it("should return zero tax when tax rate is 0", () => {
    const result = calculateTaxFromGross(1000, 0);

    expect(result.grossAmount).toBe(1000);
    expect(result.netAmount).toBe(1000);
    expect(result.taxAmount).toBe(0);
  });

  it("should return zero tax when tax rate is negative", () => {
    const result = calculateTaxFromGross(1000, -0.1);

    expect(result.grossAmount).toBe(1000);
    expect(result.netAmount).toBe(1000);
    expect(result.taxAmount).toBe(0);
  });

  it("should handle zero gross amount", () => {
    const result = calculateTaxFromGross(0, 0.2);

    expect(result.grossAmount).toBe(0);
    expect(result.netAmount).toBe(0);
    expect(result.taxAmount).toBe(0);
  });

  it("should round net amount correctly", () => {
    // 100 cents with 7% tax: 100 / 1.07 = 93.457... should round to 93
    const result = calculateTaxFromGross(100, 0.07);

    expect(result.netAmount).toBe(93);
    expect(result.taxAmount).toBe(7);
    expect(result.netAmount + result.taxAmount).toBe(result.grossAmount);
  });
});

describe("taxRateToDecimal", () => {
  it("should convert 20% to 0.20", () => {
    expect(taxRateToDecimal(20)).toBe(0.2);
  });

  it("should convert 19% to 0.19", () => {
    expect(taxRateToDecimal(19)).toBe(0.19);
  });

  it("should convert 0% to 0", () => {
    expect(taxRateToDecimal(0)).toBe(0);
  });

  it("should handle decimal percentages", () => {
    expect(taxRateToDecimal(7.5)).toBe(0.075);
  });
});

describe("calculateGrossAmountForChartMogul", () => {
  describe("Scenario 1: Tax-inclusive pricing (UK/EU)", () => {
    it("should calculate tax from subtotal when tax_inclusive and tax is 0", () => {
      // UK 20% VAT: Customer pays £22.80 (subtotal includes tax)
      // subtotal = 2280, total = 2280, discount = 0, tax = 0, taxRate = 0.20
      const result = calculateGrossAmountForChartMogul(
        2280, // subtotal
        2280, // total
        0, // discount
        0, // tax (0 because it's included in subtotal)
        0.2, // taxRate
        true // taxInclusive
      );

      expect(result.grossAmount).toBe(2280);
      expect(result.taxAmount).toBe(380); // 2280 - (2280/1.20) = 380
      // ChartMogul MRR: 2280 - 380 = 1900 (£19.00)
    });

    it("should handle tax-inclusive with discount", () => {
      // £22.80 with £5 discount = £17.80 gross
      const result = calculateGrossAmountForChartMogul(
        2280, // subtotal
        1780, // total
        500, // discount
        0, // tax
        0.2, // taxRate
        true // taxInclusive
      );

      expect(result.grossAmount).toBe(1780); // 2280 - 500
      expect(result.taxAmount).toBe(297); // 1780 - (1780/1.20) ≈ 297
      // ChartMogul MRR: 1780 - 297 = 1483 (£14.83)
    });
  });

  describe("Scenario 2: Tax-exclusive pricing (India GST)", () => {
    it("should use total as gross when tax_inclusive is false and tax > 0", () => {
      // India 18% GST: $19 product - $10 discount + $1.62 tax = $10.62 total
      // subtotal = 1900, discount = 1000, tax = 162, total = 1062
      const result = calculateGrossAmountForChartMogul(
        1900, // subtotal
        1062, // total (what customer paid)
        1000, // discount
        162, // tax (explicit)
        0.18, // taxRate
        false // taxInclusive
      );

      expect(result.grossAmount).toBe(1062); // Use total
      expect(result.taxAmount).toBe(162);
      // ChartMogul MRR: 1062 - 162 = 900 ($9.00) ✓
    });

    it("should correctly handle the iamgagan0711 case", () => {
      // Real case: subtotal=1900, discount=1000, tax=162, total=1062
      // Bug was: grossAmount = 1900 - 1000 = 900, then 900 - 162 = 738 ($7.38 WRONG)
      // Fix: grossAmount = 1062, then 1062 - 162 = 900 ($9.00 CORRECT)
      const result = calculateGrossAmountForChartMogul(
        1900,
        1062,
        1000,
        162,
        0.18,
        false
      );

      expect(result.grossAmount).toBe(1062);
      expect(result.taxAmount).toBe(162);
      // Net MRR = 1062 - 162 = 900 cents = $9.00
      expect(result.grossAmount - result.taxAmount).toBe(900);
    });
  });

  describe("Scenario 3: Edge cases", () => {
    it("should calculate tax when tax_inclusive is false but tax is 0 with tax_rate > 0", () => {
      // Edge case: tax_inclusive=false, tax=0, but taxRate exists
      const result = calculateGrossAmountForChartMogul(
        2280, // subtotal
        2280, // total
        0, // discount
        0, // tax (0 even though there should be tax)
        0.2, // taxRate
        false // taxInclusive
      );

      expect(result.grossAmount).toBe(2280);
      expect(result.taxAmount).toBe(380); // Calculated from gross
    });

    it("should return 0 tax when no tax rate and no tax amount", () => {
      const result = calculateGrossAmountForChartMogul(
        1900,
        1900,
        0,
        0,
        0, // No tax rate
        false
      );

      expect(result.grossAmount).toBe(1900);
      expect(result.taxAmount).toBe(0);
    });

    it("should handle 100% discount (free)", () => {
      const result = calculateGrossAmountForChartMogul(
        1900,
        0,
        1900, // Full discount
        0,
        0.2,
        true
      );

      expect(result.grossAmount).toBe(0);
      expect(result.taxAmount).toBe(0);
    });
  });
});

describe("calculateServicePeriodEnd", () => {
  it("should add 1 month for monthly subscription", () => {
    const startDate = new Date("2024-01-15T10:00:00Z");
    const endDate = calculateServicePeriodEnd(startDate, "month", 1);

    expect(endDate.getFullYear()).toBe(2024);
    expect(endDate.getMonth()).toBe(1); // February (0-indexed)
    expect(endDate.getDate()).toBe(15);
  });

  it("should add 3 months for quarterly subscription", () => {
    const startDate = new Date("2024-01-15T10:00:00Z");
    const endDate = calculateServicePeriodEnd(startDate, "month", 3);

    expect(endDate.getFullYear()).toBe(2024);
    expect(endDate.getMonth()).toBe(3); // April
    expect(endDate.getDate()).toBe(15);
  });

  it("should add 1 year for annual subscription", () => {
    const startDate = new Date("2024-01-15T10:00:00Z");
    const endDate = calculateServicePeriodEnd(startDate, "year", 1);

    expect(endDate.getFullYear()).toBe(2025);
    expect(endDate.getMonth()).toBe(0); // January
    expect(endDate.getDate()).toBe(15);
  });

  it("should handle month overflow correctly", () => {
    const startDate = new Date("2024-11-15T10:00:00Z"); // November
    const endDate = calculateServicePeriodEnd(startDate, "month", 2);

    expect(endDate.getFullYear()).toBe(2025);
    expect(endDate.getMonth()).toBe(0); // January
    expect(endDate.getDate()).toBe(15);
  });

  it("should not mutate the input date", () => {
    const startDate = new Date("2024-01-15T10:00:00Z");
    const originalTime = startDate.getTime();

    calculateServicePeriodEnd(startDate, "month", 1);

    expect(startDate.getTime()).toBe(originalTime);
  });
});

describe("shouldSkipSubscriptionStatus", () => {
  it("should skip past_due subscriptions", () => {
    expect(shouldSkipSubscriptionStatus("past_due")).toBe(true);
  });

  it("should skip unpaid subscriptions", () => {
    expect(shouldSkipSubscriptionStatus("unpaid")).toBe(true);
  });

  it("should skip paused subscriptions", () => {
    expect(shouldSkipSubscriptionStatus("paused")).toBe(true);
  });

  it("should not skip active subscriptions", () => {
    expect(shouldSkipSubscriptionStatus("active")).toBe(false);
  });

  it("should not skip cancelled subscriptions", () => {
    expect(shouldSkipSubscriptionStatus("cancelled")).toBe(false);
  });

  it("should not skip expired subscriptions", () => {
    expect(shouldSkipSubscriptionStatus("expired")).toBe(false);
  });

  it("should not skip on_trial subscriptions", () => {
    expect(shouldSkipSubscriptionStatus("on_trial")).toBe(false);
  });
});

describe("isTrialSubscription", () => {
  it("should return true for on_trial status", () => {
    expect(isTrialSubscription("on_trial")).toBe(true);
  });

  it("should return false for active status", () => {
    expect(isTrialSubscription("active")).toBe(false);
  });

  it("should return false for other statuses", () => {
    expect(isTrialSubscription("cancelled")).toBe(false);
    expect(isTrialSubscription("expired")).toBe(false);
    expect(isTrialSubscription("past_due")).toBe(false);
  });
});

describe("shouldSkipInvoiceStatus", () => {
  it("should not skip paid invoices", () => {
    expect(shouldSkipInvoiceStatus("paid")).toBe(false);
  });

  it("should not skip refunded invoices", () => {
    expect(shouldSkipInvoiceStatus("refunded")).toBe(false);
  });

  it("should skip pending invoices", () => {
    expect(shouldSkipInvoiceStatus("pending")).toBe(true);
  });

  it("should skip past_due invoices", () => {
    expect(shouldSkipInvoiceStatus("past_due")).toBe(true);
  });

  it("should skip void invoices", () => {
    expect(shouldSkipInvoiceStatus("void")).toBe(true);
  });
});

describe("buildInvoiceTransactions", () => {
  const billingDate = "2024-01-15T10:00:00Z";
  const refundedAt = "2024-01-20T14:30:00Z";

  it("should create payment transaction for paid invoice", () => {
    const transactions = buildInvoiceTransactions("paid", billingDate);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toEqual({
      date: billingDate,
      type: "payment",
      result: "successful",
    });
  });

  it("should create payment and refund transactions for refunded invoice", () => {
    const transactions = buildInvoiceTransactions(
      "refunded",
      billingDate,
      refundedAt
    );

    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toEqual({
      date: billingDate,
      type: "payment",
      result: "successful",
    });
    expect(transactions[1]).toEqual({
      date: refundedAt,
      type: "refund",
      result: "successful",
    });
  });

  it("should create only payment transaction for refunded invoice without refund date", () => {
    const transactions = buildInvoiceTransactions("refunded", billingDate, null);

    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe("payment");
  });

  it("should return empty array for pending invoice", () => {
    const transactions = buildInvoiceTransactions("pending", billingDate);
    expect(transactions).toHaveLength(0);
  });

  it("should return empty array for void invoice", () => {
    const transactions = buildInvoiceTransactions("void", billingDate);
    expect(transactions).toHaveLength(0);
  });
});

describe("buildLineItem", () => {
  const baseParams = {
    subscriptionId: "sub-123",
    planUuid: "plan-uuid-456",
    servicePeriodStart: "2024-01-15T10:00:00Z",
    servicePeriodEnd: "2024-02-15T10:00:00Z",
    grossAmount: 2280,
    taxAmount: 380,
  };

  it("should build a basic line item without discount", () => {
    const lineItem = buildLineItem(baseParams);

    expect(lineItem).toEqual({
      type: "subscription",
      subscription_external_id: "sub-123",
      plan_uuid: "plan-uuid-456",
      service_period_start: "2024-01-15T10:00:00Z",
      service_period_end: "2024-02-15T10:00:00Z",
      amount_in_cents: 2280,
      quantity: 1,
      tax_amount_in_cents: 380,
    });
  });

  it("should include discount fields when discount is provided", () => {
    const lineItem = buildLineItem({
      ...baseParams,
      discountAmount: 500,
      discountCode: "SAVE50",
      discountDescription: "50% off first month",
    });

    expect(lineItem.discount_amount_in_cents).toBe(500);
    expect(lineItem.discount_code).toBe("SAVE50");
    expect(lineItem.discount_description).toBe("50% off first month");
  });

  it("should not include discount fields when discount is 0", () => {
    const lineItem = buildLineItem({
      ...baseParams,
      discountAmount: 0,
      discountCode: "UNUSED",
    });

    expect(lineItem.discount_amount_in_cents).toBeUndefined();
    expect(lineItem.discount_code).toBeUndefined();
  });

  it("should not include discount fields when discount is undefined", () => {
    const lineItem = buildLineItem(baseParams);

    expect(lineItem.discount_amount_in_cents).toBeUndefined();
    expect(lineItem.discount_code).toBeUndefined();
    expect(lineItem.discount_description).toBeUndefined();
  });
});

describe("getPlanExternalId", () => {
  it("should return product-variant format when variant exists", () => {
    expect(getPlanExternalId(123, 456)).toBe("123-456");
  });

  it("should return product only when variant is null", () => {
    expect(getPlanExternalId(123, null)).toBe("123");
  });

  it("should return product only when variant is undefined", () => {
    expect(getPlanExternalId(123, undefined)).toBe("123");
  });

  it("should handle string IDs", () => {
    expect(getPlanExternalId("123", "456")).toBe("123-456");
  });

  it("should handle mixed types", () => {
    expect(getPlanExternalId(123, "456")).toBe("123-456");
  });
});
