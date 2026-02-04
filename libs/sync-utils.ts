/**
 * Utility functions for syncing Lemon Squeezy data to ChartMogul
 */

// Types
export interface TaxCalculation {
  grossAmount: number;
  netAmount: number;
  taxAmount: number;
}

export interface LineItem {
  type: "subscription";
  subscription_external_id: string;
  plan_uuid: string;
  service_period_start: string;
  service_period_end: string;
  amount_in_cents: number;
  quantity: number;
  tax_amount_in_cents: number;
  discount_amount_in_cents?: number;
  discount_code?: string;
  discount_description?: string;
}

export interface Transaction {
  date: string;
  type: "payment" | "refund";
  result: "successful";
}

export type SubscriptionStatus =
  | "active"
  | "cancelled"
  | "expired"
  | "past_due"
  | "unpaid"
  | "paused"
  | "on_trial";

export type InvoiceStatus =
  | "paid"
  | "refunded"
  | "pending"
  | "past_due"
  | "void";

/**
 * Calculate tax from a gross amount when tax is included in the price.
 * Formula: net = gross / (1 + taxRate), tax = gross - net
 *
 * @param grossAmount - The total amount including tax (in cents)
 * @param taxRate - The tax rate as a decimal (e.g., 0.20 for 20%)
 * @returns Object with grossAmount, netAmount, and taxAmount (all in cents)
 */
export function calculateTaxFromGross(
  grossAmount: number,
  taxRate: number
): TaxCalculation {
  if (taxRate <= 0) {
    return {
      grossAmount,
      netAmount: grossAmount,
      taxAmount: 0,
    };
  }

  const netAmount = Math.round(grossAmount / (1 + taxRate));
  const taxAmount = grossAmount - netAmount;

  return {
    grossAmount,
    netAmount,
    taxAmount,
  };
}

/**
 * Convert a tax rate from percentage to decimal.
 * Lemon Squeezy returns tax_rate as a percentage (e.g., 20), not decimal (0.20)
 *
 * @param taxRatePercent - Tax rate as percentage (e.g., 20)
 * @returns Tax rate as decimal (e.g., 0.20)
 */
export function taxRateToDecimal(taxRatePercent: number): number {
  return taxRatePercent / 100;
}

export interface GrossAmountResult {
  grossAmount: number;
  taxAmount: number;
}

/**
 * Calculate the gross amount and tax for ChartMogul based on Lemon Squeezy invoice data.
 *
 * ChartMogul expects:
 * - amount_in_cents: GROSS amount (what customer paid, including tax)
 * - tax_amount_in_cents: tax amount
 * ChartMogul calculates MRR as: grossAmount - taxAmount = net revenue
 *
 * Lemon Squeezy scenarios:
 * 1. tax_inclusive: true, tax = 0 → subtotal includes tax, calculate tax from subtotal
 * 2. tax_inclusive: false, tax > 0 → subtotal is net, total is gross (use total)
 * 3. tax_inclusive: false, tax = 0, tax_rate > 0 → edge case, calculate from subtotal
 *
 * @param subtotal - Invoice subtotal (before discounts applied to price)
 * @param total - Invoice total (what customer paid)
 * @param discountAmount - Discount amount applied
 * @param taxAmount - Tax amount from invoice (may be 0)
 * @param taxRate - Tax rate as decimal (e.g., 0.20 for 20%)
 * @param taxInclusive - Whether tax is included in subtotal
 * @returns Object with grossAmount and taxAmount for ChartMogul
 */
export function calculateGrossAmountForChartMogul(
  subtotal: number,
  total: number,
  discountAmount: number,
  taxAmount: number,
  taxRate: number,
  taxInclusive: boolean
): GrossAmountResult {
  // Scenario 2: Tax NOT inclusive AND explicit tax amount provided
  // Use total as gross (what customer actually paid including tax)
  if (!taxInclusive && taxAmount > 0) {
    return {
      grossAmount: total,
      taxAmount: taxAmount,
    };
  }

  // Scenarios 1 & 3: Tax inclusive OR no explicit tax
  // Calculate gross from subtotal minus discount
  const grossAmount = subtotal - discountAmount;

  // If tax is 0 but there's a tax rate, calculate tax from gross
  if (taxAmount === 0 && taxRate > 0) {
    const taxCalc = calculateTaxFromGross(grossAmount, taxRate);
    return {
      grossAmount: grossAmount,
      taxAmount: taxCalc.taxAmount,
    };
  }

  // No tax calculation needed
  return {
    grossAmount: grossAmount,
    taxAmount: taxAmount,
  };
}

/**
 * Calculate the service period end date based on billing date and plan interval.
 *
 * @param billingDate - The billing/start date
 * @param intervalUnit - The interval unit ("month" or "year")
 * @param intervalCount - Number of intervals (default 1)
 * @returns The service period end date
 */
export function calculateServicePeriodEnd(
  billingDate: Date,
  intervalUnit: "month" | "year",
  intervalCount: number = 1
): Date {
  const endDate = new Date(billingDate);

  if (intervalUnit === "year") {
    endDate.setFullYear(endDate.getFullYear() + intervalCount);
  } else {
    endDate.setMonth(endDate.getMonth() + intervalCount);
  }

  return endDate;
}

/**
 * Determine if a subscription status should be skipped (not contribute to MRR).
 * Skipped statuses: past_due, unpaid, paused
 *
 * @param status - The subscription status
 * @returns true if the subscription should be skipped
 */
export function shouldSkipSubscriptionStatus(status: string): boolean {
  const skipStatuses = ["past_due", "unpaid", "paused"];
  return skipStatuses.includes(status);
}

/**
 * Determine if a subscription is a trial (should have $0 MRR).
 *
 * @param status - The subscription status
 * @returns true if the subscription is on trial
 */
export function isTrialSubscription(status: string): boolean {
  return status === "on_trial";
}

/**
 * Determine if an invoice should be skipped based on its status.
 * Only "paid" and "refunded" invoices should be imported.
 *
 * @param status - The invoice status
 * @returns true if the invoice should be skipped
 */
export function shouldSkipInvoiceStatus(status: string): boolean {
  const importStatuses = ["paid", "refunded"];
  return !importStatuses.includes(status);
}

/**
 * Build transactions array for a ChartMogul invoice based on invoice status.
 *
 * @param status - The invoice status
 * @param billingDate - The billing date
 * @param refundedAt - The refund date (if refunded)
 * @returns Array of transactions, or empty array if invoice should be skipped
 */
export function buildInvoiceTransactions(
  status: string,
  billingDate: string,
  refundedAt?: string | null
): Transaction[] {
  const transactions: Transaction[] = [];

  if (status === "paid") {
    transactions.push({
      date: billingDate,
      type: "payment",
      result: "successful",
    });
  } else if (status === "refunded") {
    // Refunded invoices need both payment and refund transactions
    transactions.push({
      date: billingDate,
      type: "payment",
      result: "successful",
    });

    if (refundedAt) {
      transactions.push({
        date: refundedAt,
        type: "refund",
        result: "successful",
      });
    }
  }

  return transactions;
}

/**
 * Build a ChartMogul line item for a subscription invoice.
 *
 * @param params - Line item parameters
 * @returns ChartMogul line item object
 */
export function buildLineItem(params: {
  subscriptionId: string;
  planUuid: string;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  grossAmount: number;
  taxAmount: number;
  discountAmount?: number;
  discountCode?: string;
  discountDescription?: string;
}): LineItem {
  const lineItem: LineItem = {
    type: "subscription",
    subscription_external_id: params.subscriptionId,
    plan_uuid: params.planUuid,
    service_period_start: params.servicePeriodStart,
    service_period_end: params.servicePeriodEnd,
    amount_in_cents: params.grossAmount,
    quantity: 1,
    tax_amount_in_cents: params.taxAmount,
  };

  // Only add discount fields if there's actually a discount
  if (params.discountAmount && params.discountAmount > 0) {
    lineItem.discount_amount_in_cents = params.discountAmount;
    if (params.discountCode) {
      lineItem.discount_code = params.discountCode;
    }
    if (params.discountDescription) {
      lineItem.discount_description = params.discountDescription;
    }
  }

  return lineItem;
}

/**
 * Get the plan external ID for a subscription.
 * Format: "{product_id}-{variant_id}" if variant exists, otherwise "{product_id}"
 *
 * @param productId - The product ID
 * @param variantId - The variant ID (optional)
 * @returns The plan external ID
 */
export function getPlanExternalId(
  productId: number | string,
  variantId?: number | string | null
): string {
  if (variantId) {
    return `${productId}-${variantId}`;
  }
  return productId.toString();
}
