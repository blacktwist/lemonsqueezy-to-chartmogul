import "varlock/auto-load";
import { ENV } from "varlock/env";
import {
  chartMogulApi,
  getAllChartMogulCustomers,
  getAllChartMogulPlans,
  deleteAllChartMogulData,
} from "./libs/chartMogul.js";
import {
  getAllLemonSqueezyCustomers,
  getAllLemonSqueezyDiscountRedemptions,
  getAllLemonSqueezyProducts,
  getAllLemonSqueezyVariants,
  getAllLemonSqueezySubscriptions,
  getAllLemonSqueezySubscriptionInvoices,
  lemonSqueezyClient,
} from "./libs/lemonSqueezy.js";
import {
  taxRateToDecimal,
  calculateGrossAmountForChartMogul,
  calculateServicePeriodEnd,
  shouldSkipSubscriptionStatus,
  isTrialSubscription,
  shouldSkipInvoiceStatus,
  buildInvoiceTransactions,
  buildLineItem,
  getPlanExternalId,
} from "./libs/sync-utils.js";

const CHARTMOGUL_DATA_SOURCE_UUID = ENV.CHARTMOGUL_DATA_SOURCE_UUID;

async function createChartMogulCustomer(customer: any) {
  await chartMogulApi.post("/customers", {
    external_id: customer.id.toString(),
    data_source_uuid: CHARTMOGUL_DATA_SOURCE_UUID,
    company: customer.attributes.name || customer.attributes.email,
    country: customer.attributes.country,
    state: customer.attributes.region,
    city: customer.attributes.city,
    lead_created_at: customer.attributes.created_at,
    email: customer.attributes.email,
    primary_contact: {
      first_name: customer.attributes.name?.split(" ")[0] || "",
      last_name:
        customer.attributes.name?.split(" ").slice(1).join(" ") || "",
      email: customer.attributes.email,
    },
  });
}

// ChartMogul customer deletion can lag behind its own list endpoint (see
// waitUntilEmpty in libs/chartMogul.ts). If a customer we think exists
// vanishes out from under an update, it means the delete finally landed
// between our list fetch and this call - re-create it instead of losing it.
function isCustomerMissingError(error: any): boolean {
  const errors = error?.response?.data?.errors;
  return (
    error?.response?.status === 404 ||
    (typeof errors?.customer_id === "string" &&
      errors.customer_id.includes("does not exist"))
  );
}

async function importData() {
  try {
    // Delete all existing data from ChartMogul first
    console.log("Deleting all existing data from ChartMogul...");
    await deleteAllChartMogulData();

    // Get all existing customers and plans from ChartMogul first
    let existingChartMogulCustomers = await getAllChartMogulCustomers();
    let existingChartMogulPlans = await getAllChartMogulPlans();

    // Get all discount redemptions from LemonSqueezy
    const allLemonSqueezyDiscountRedemptions =
      await getAllLemonSqueezyDiscountRedemptions();

    // 1. Export and import subscribers/customers
    console.log("Exporting and importing subscribers/customers...");
    const customers = await getAllLemonSqueezyCustomers();
    console.log(`Found ${customers.length} customers in LemonSqueezy`);

    for (const customer of customers) {
      try {
        // Debug log the customer data
        console.log("Processing customer:", {
          id: customer.id,
          name: customer.attributes.name,
          email: customer.attributes.email,
          status: customer.attributes.status,
          country: customer.attributes.country,
          city: customer.attributes.city,
          region: customer.attributes.region,
        });

        // Skip customers without email
        if (!customer.attributes.email) {
          console.log(`Skipping customer ${customer.id} - no email provided`);
          continue;
        }

        // Search for customer by email
        const existingCustomer = existingChartMogulCustomers.find(
          (c) => c.email === customer.attributes.email
        );

        if (existingCustomer) {
          // Customer exists, update them
          try {
            console.log("Updating customer:", {
              name: customer.attributes.name || customer.attributes.email,
              email: customer.attributes.email,
              external_id: customer.id.toString(),
            });
            await chartMogulApi.patch(`/customers/${existingCustomer.uuid}`, {
              company: customer.attributes.name || customer.attributes.email,
              country: customer.attributes.country,
              state: customer.attributes.region,
              city: customer.attributes.city,
              data_source_uuid: CHARTMOGUL_DATA_SOURCE_UUID,
              email: customer.attributes.email,
              primary_contact: {
                first_name: customer.attributes.name?.split(" ")[0] || "",
                last_name:
                  customer.attributes.name?.split(" ").slice(1).join(" ") || "",
                email: customer.attributes.email,
              },
            });
            console.log(`Updated customer: ${customer.attributes.email}`);
          } catch (error) {
            if (isCustomerMissingError(error)) {
              console.warn(
                `Customer ${customer.attributes.email} no longer exists on ChartMogul (deletion race) - creating it instead.`
              );
              try {
                await createChartMogulCustomer(customer);
                console.log(
                  `Created customer (after failed update): ${customer.attributes.email}`
                );
              } catch (createError) {
                console.error(
                  "Error creating customer after failed update:",
                  // @ts-ignore
                  createError?.response?.data
                );
              }
            } else {
              console.error(
                "Error updating customer:",
                // @ts-ignore
                error?.response?.data
              );
            }
          }
        } else {
          try {
            // Customer doesn't exist, create them
            console.log("Creating customer:", {
              name: customer.attributes.name || customer.attributes.email,
              email: customer.attributes.email,
              external_id: customer.id.toString(),
            });
            await createChartMogulCustomer(customer);
            console.log(`Created customer: ${customer.attributes.email}`);
          } catch (error) {
            console.error(
              "Error creating customer:",
              // @ts-ignore
              error?.response?.data
            );
          }
        }
      } catch (error: any) {
        console.error(
          "Error exporting and importing subscribers/customers:",
          error?.response?.data || error.message
        );
      }
    }
    console.log("Subscribers/customers exported and imported successfully!");

    existingChartMogulCustomers = await getAllChartMogulCustomers();

    // 2. Export and import plans
    console.log("Exporting and importing plans...");
    const products = await getAllLemonSqueezyProducts();
    console.log(`Found ${products.length} products in LemonSqueezy`);

    for (const product of products) {
      try {
        console.log("Processing product:", {
          id: product.id,
          name: product.attributes.name,
          price: product.attributes.price,
          status: product.attributes.status,
        });

        // Get variants for this product
        const variants = await getAllLemonSqueezyVariants(parseInt(product.id));
        console.log(
          `Found ${variants.length} variants for product ${product.id}`
        );

        if (variants.length === 0) {
          // No variants, create plan from product
          try {
            // Determine interval from product name or default to monthly
            const isAnnual =
              product.attributes.name.toLowerCase().includes("annual") ||
              product.attributes.name.toLowerCase().includes("yearly");

            await chartMogulApi.post("/import/plans", {
              name: product.attributes.name,
              interval_unit: isAnnual ? "year" : "month",
              interval_count: isAnnual ? 1 : 1,
              external_id: product.id.toString(),
              data_source_uuid: CHARTMOGUL_DATA_SOURCE_UUID,
            });
            console.log(
              `Created plan from product: ${product.attributes.name}`
            );
          } catch (error: any) {
            console.error(
              "Error creating plan from product:",
              error?.response?.data || error
            );
          }
        } else {
          // Create plans from variants
          for (const variant of variants) {
            try {
              console.log("Processing variant:", {
                id: variant.id,
                name: variant.attributes.name,
                price: variant.attributes.price,
                is_subscription: variant.attributes.is_subscription,
                interval: variant.attributes.interval,
                interval_count: variant.attributes.interval_count,
              });

              // Determine interval from variant or product name
              let interval_unit = "month";
              let interval_count = 1;

              if (
                variant.attributes.is_subscription &&
                variant.attributes.interval
              ) {
                // @ts-ignore
                interval_unit = variant.attributes.interval;
                interval_count = variant.attributes.interval_count || 1;
              } else {
                // Fallback to name-based detection
                const variantName = variant.attributes.name.toLowerCase();
                const productName = product.attributes.name.toLowerCase();
                const isAnnual =
                  variantName.includes("annual") ||
                  variantName.includes("yearly") ||
                  productName.includes("annual") ||
                  productName.includes("yearly");

                if (isAnnual) {
                  interval_unit = "year";
                  interval_count = 1;
                }
              }

              await chartMogulApi.post("/import/plans", {
                name: `${product.attributes.name} - ${variant.attributes.name}`,
                interval_unit: interval_unit,
                interval_count: interval_count,
                external_id: `${product.id}-${variant.id}`,
                data_source_uuid: CHARTMOGUL_DATA_SOURCE_UUID,
              });
              console.log(
                `Created plan from variant: ${product.attributes.name} - ${variant.attributes.name}`
              );
            } catch (error: any) {
              console.error(
                "Error creating plan from variant:",
                error?.response?.data || error
              );
            }
          }
        }
      } catch (error: any) {
        console.error(
          "Error processing product:",
          error?.response?.data || error
        );
      }
    }
    console.log("Plans exported and imported successfully!");

    existingChartMogulPlans = await getAllChartMogulPlans();

    // 3. Export and import subscriptions
    console.log("Exporting and importing subscriptions...");
    const subscriptions = await getAllLemonSqueezySubscriptions();
    console.log(`Found ${subscriptions.length} subscriptions in LemonSqueezy`);

    for (const subscription of subscriptions) {
      console.log("Processing subscription:", {
        id: subscription.id,
        status: subscription.attributes.status,
        product_id: subscription.attributes.product_id,
        order_id: subscription.attributes.order_id,
        customer_email: subscription.attributes.user_email,
      });

      try {
        const customerEmail = subscription.attributes.user_email;

        // Use the custom search function instead of the SDK
        const customer = existingChartMogulCustomers.find(
          (c) => c.email === customerEmail
        );

        if (!customer) {
          console.error("Customer not found on ChartMogul:", customerEmail);
          continue;
        }

        // Get the order to get pricing information
        const order = await lemonSqueezyClient.getOrder({
          id: subscription.attributes.order_id,
        });
        if (!order) {
          console.error(
            "Order not found on Lemon Squeezy:",
            subscription.attributes.order_id
          );
          continue;
        }

        // Create subscription events for different statuses
        try {
          // Get the plan external ID that was used when creating the plan
          const planExternalId = getPlanExternalId(
            subscription.attributes.product_id,
            subscription.attributes.variant_id
          );

          // Skip subscriptions that shouldn't contribute to MRR
          if (shouldSkipSubscriptionStatus(subscription.attributes.status)) {
            console.log(
              `Skipping ${subscription.attributes.status} subscription (no MRR contribution): ${subscription.id}`
            );
            continue;
          }

          if (subscription.attributes.status === "active") {
            try {
              await chartMogulApi.post("/subscription_events", {
                subscription_event: {
                  external_id: `${subscription.id}-start`,
                  customer_external_id: customer.external_id,
                  data_source_uuid: CHARTMOGUL_DATA_SOURCE_UUID,
                  event_type: "subscription_start_scheduled",
                  event_date: subscription.attributes.created_at,
                  effective_date: subscription.attributes.created_at,
                  subscription_external_id: subscription.id.toString(),
                  plan_external_id: planExternalId,
                  currency: order.data.attributes.currency,
                  amount_in_cents: order.data.attributes.subtotal,
                  quantity: 1,
                  event_order: 1,
                },
              });
              console.log(
                `Created subscription event: ${subscription.id}-start`
              );
            } catch (err) {
              console.error(
                "Error creating active subscription event:", // @ts-ignore
                err?.response?.data
              );
            }
          } else if (subscription.attributes.status === "cancelled") {
            try {
              await chartMogulApi.post("/subscription_events", {
                subscription_event: {
                  external_id: `${subscription.id}-cancelled`,
                  customer_external_id: customer.external_id,
                  data_source_uuid: CHARTMOGUL_DATA_SOURCE_UUID,
                  event_type: "subscription_cancelled",
                  event_date: subscription.attributes.updated_at,
                  effective_date: subscription.attributes.updated_at,
                  subscription_external_id: subscription.id.toString(),
                  plan_external_id: planExternalId,
                  currency: order.data.attributes.currency,
                  amount_in_cents: order.data.attributes.subtotal,
                  quantity: 1,
                  event_order: 1,
                },
              });
              console.log(
                `Created subscription event: ${subscription.id}-cancelled`
              );
            } catch (err) {
              console.error(
                "Error creating cancelled subscription event:",
                // @ts-ignore
                err?.response?.data
              );
            }
          } else if (subscription.attributes.status === "expired") {
            try {
              await chartMogulApi.post("/subscription_events", {
                subscription_event: {
                  external_id: `${subscription.id}-expired`,
                  customer_external_id: customer.external_id,
                  data_source_uuid: CHARTMOGUL_DATA_SOURCE_UUID,
                  event_type: "subscription_cancelled",
                  event_date:
                    subscription.attributes.ends_at ||
                    subscription.attributes.updated_at,
                  effective_date:
                    subscription.attributes.ends_at ||
                    subscription.attributes.updated_at,
                  subscription_external_id: subscription.id.toString(),
                  plan_external_id: planExternalId,
                  currency: order.data.attributes.currency,
                  amount_in_cents: order.data.attributes.subtotal,
                  quantity: 1,
                  event_order: 1,
                },
              });
              console.log(
                `Created subscription event: ${subscription.id}-expired`
              );
            } catch (err) {
              console.error(
                "Error creating expired subscription event:",
                // @ts-ignore
                err?.response?.data
              );
            }
          } else if (isTrialSubscription(subscription.attributes.status)) {
            // Trial subscriptions - track with $0 MRR
            try {
              await chartMogulApi.post("/subscription_events", {
                subscription_event: {
                  external_id: `${subscription.id}-trial`,
                  customer_external_id: customer.external_id,
                  data_source_uuid: CHARTMOGUL_DATA_SOURCE_UUID,
                  event_type: "subscription_start_scheduled",
                  event_date: subscription.attributes.created_at,
                  effective_date: subscription.attributes.created_at,
                  subscription_external_id: subscription.id.toString(),
                  plan_external_id: planExternalId,
                  currency: order.data.attributes.currency,
                  amount_in_cents: 0, // $0 MRR during trial
                  quantity: 1,
                  event_order: 1,
                },
              });
              console.log(
                `Created trial subscription event: ${subscription.id}-trial`
              );
            } catch (err) {
              console.error(
                "Error creating trial subscription event:",
                // @ts-ignore
                err?.response?.data
              );
            }
          }
        } catch (error: any) {
          console.error(
            "Error creating subscription event:",
            error?.response?.data || error
          );
        }
      } catch (error: any) {
        console.error("Error processing subscription:", error);
      }
    }
    console.log("Subscriptions exported and imported successfully!");

    // 4. Export and import invoices
    console.log("Exporting and importing invoices...");
    const allSubscriptionInvoices =
      await getAllLemonSqueezySubscriptionInvoices();
    console.log(
      `Found ${allSubscriptionInvoices.length} subscription invoices in LemonSqueezy`
    );

    // Group invoices by subscription
    const invoicesBySubscription = new Map<string, any[]>();
    for (const invoice of allSubscriptionInvoices) {
      const subscriptionId = invoice.attributes.subscription_id?.toString();
      if (!subscriptionId) continue;

      if (!invoicesBySubscription.has(subscriptionId)) {
        invoicesBySubscription.set(subscriptionId, []);
      }
      invoicesBySubscription.get(subscriptionId)!.push(invoice);
    }

    // Process each subscription's invoices
    for (const [subscriptionId, invoices] of invoicesBySubscription) {
      try {
        // Find the subscription
        const subscription = subscriptions.find((s) => s.id === subscriptionId);

        if (!subscription) {
          console.log(`Subscription not found for ID: ${subscriptionId}`);
          continue;
        }

        const customerEmail = subscription.attributes.user_email;
        console.log(
          `Processing ${invoices.length} invoices for subscription ${subscriptionId} (${customerEmail})`
        );

        // Find the customer in ChartMogul
        const customer = existingChartMogulCustomers.find(
          (c) => c.email === customerEmail
        );

        if (!customer) {
          console.error("Customer not found on ChartMogul:", customerEmail);
          continue;
        }

        // Get plan UUID from ChartMogul
        const planExternalId = getPlanExternalId(
          subscription.attributes.product_id,
          subscription.attributes.variant_id
        );

        // Search for the plan in ChartMogul
        const plan = existingChartMogulPlans.find(
          (p) => p.external_id === planExternalId
        );

        if (!plan) {
          console.log(`Plan not found for external_id: ${planExternalId}`);
          continue;
        }

        // Get the order to get tax rate information
        const order = await lemonSqueezyClient.getOrder({
          id: subscription.attributes.order_id,
        });
        const orderAttrs = order?.data?.attributes as any;
        // tax_rate from Lemon Squeezy is a percentage (e.g., 20), convert to decimal (0.20)
        const orderTaxRatePercent = orderAttrs?.tax_rate
          ? parseFloat(orderAttrs.tax_rate)
          : 0;
        const orderTaxRate = taxRateToDecimal(orderTaxRatePercent);

        console.log("Order tax info:", {
          order_id: subscription.attributes.order_id,
          tax_rate_percent: orderTaxRatePercent,
          tax_rate_decimal: orderTaxRate,
        });

        // Sort invoices by billing date
        invoices.sort(
          (a, b) =>
            new Date(
              a.attributes.billing_at || a.attributes.created_at
            ).getTime() -
            new Date(
              b.attributes.billing_at || b.attributes.created_at
            ).getTime()
        );

        // Process each invoice
        for (const lsInvoice of invoices) {
          try {
            console.log("Processing subscription invoice:", {
              id: lsInvoice.id,
              billing_at: lsInvoice.attributes.billing_at,
              subtotal: lsInvoice.attributes.subtotal,
              discount_total: lsInvoice.attributes.discount_total,
              tax: lsInvoice.attributes.tax,
              tax_inclusive: lsInvoice.attributes.tax_inclusive,
              total: lsInvoice.attributes.total,
              status: lsInvoice.attributes.status,
            });

            // Prepare line items for ChartMogul
            const lineItems = [];

            // Calculate amounts from the subscription invoice
            // subtotal = price before discount and tax (but may include tax if tax_inclusive)
            // discount_total = total discount applied
            // tax = tax amount (may be 0 if tax is included in subtotal)
            // total = final amount charged
            const subtotal = lsInvoice.attributes.subtotal || 0;
            const total = lsInvoice.attributes.total || 0;
            const discountAmount = lsInvoice.attributes.discount_total || 0;
            let taxAmount = lsInvoice.attributes.tax || 0;

            // Calculate gross amount and tax for ChartMogul
            const taxInclusive = lsInvoice.attributes.tax_inclusive ?? true;
            const grossAmountResult = calculateGrossAmountForChartMogul(
              subtotal,
              total,
              discountAmount,
              taxAmount,
              orderTaxRate,
              taxInclusive
            );

            const grossAmount = grossAmountResult.grossAmount;
            taxAmount = grossAmountResult.taxAmount;

            console.log("Calculated gross amount for ChartMogul:", {
              subtotal,
              total,
              discountAmount,
              taxInclusive,
              orderTaxRate,
              grossAmount,
              taxAmount,
              netMRR: grossAmount - taxAmount,
            });

            // Calculate service period based on billing date and plan interval
            const billingDate = new Date(
              lsInvoice.attributes.billing_at || lsInvoice.attributes.created_at
            );
            const planInterval = (plan.interval_unit || "month") as
              | "month"
              | "year";
            const planIntervalCount = plan.interval_count || 1;
            const servicePeriodEnd = calculateServicePeriodEnd(
              billingDate,
              planInterval,
              planIntervalCount
            );

            // Build line item - find discount details if applicable
            let discountCode: string | undefined;
            let discountDescription: string | undefined;

            if (discountAmount > 0) {
              // Try to find discount details from redemptions
              // Redemptions are linked to orders, not subscriptions or invoices
              // We need to lookup via subscription.order_id
              const discountRedemption =
                allLemonSqueezyDiscountRedemptions.find(
                  (d: any) =>
                    d.attributes.order_id === subscription.attributes.order_id
                );

              if (discountRedemption) {
                discountCode =
                  discountRedemption.attributes.discount_code || undefined;
                discountDescription =
                  discountRedemption.attributes.discount_name || undefined;
              } else {
                // Fallback to invoice-level discount info
                discountCode =
                  lsInvoice.attributes.discount_code || undefined;
                discountDescription =
                  lsInvoice.attributes.discount_description || undefined;
              }
            }

            const servicePeriodStart =
              lsInvoice.attributes.billing_at || lsInvoice.attributes.created_at;

            const lineItem = buildLineItem({
              subscriptionId: subscription.id.toString(),
              planUuid: plan.uuid,
              servicePeriodStart,
              servicePeriodEnd: servicePeriodEnd.toISOString(),
              grossAmount,
              taxAmount,
              discountAmount,
              discountCode,
              discountDescription,
            });

            lineItems.push(lineItem);

            // Check if invoice should be skipped based on status
            if (shouldSkipInvoiceStatus(lsInvoice.attributes.status)) {
              console.log(
                `Skipping invoice: ${lsInvoice.id} (status: ${lsInvoice.attributes.status})`
              );
              continue;
            }

            // Build transactions based on invoice status
            const transactions = buildInvoiceTransactions(
              lsInvoice.attributes.status,
              servicePeriodStart,
              lsInvoice.attributes.refunded_at
            );

            // Only create invoice if there are transactions
            if (transactions.length === 0) {
              console.log(
                `Skipping invoice with no valid transactions: ${lsInvoice.id} (status: ${lsInvoice.attributes.status})`
              );
              continue;
            }

            const invoiceData = {
              invoices: [
                {
                  external_id: `ls-inv-${lsInvoice.id}`,
                  date:
                    lsInvoice.attributes.billing_at ||
                    lsInvoice.attributes.created_at,
                  currency: lsInvoice.attributes.currency,
                  due_date:
                    lsInvoice.attributes.billing_at ||
                    lsInvoice.attributes.created_at,
                  customer_external_id: customer.external_id,
                  data_source_uuid: CHARTMOGUL_DATA_SOURCE_UUID,
                  line_items: lineItems,
                  transactions: transactions,
                },
              ],
            };

            console.log("Invoice data:", JSON.stringify(invoiceData, null, 2));

            // Import invoice to ChartMogul
            try {
              await chartMogulApi.post(
                `/import/customers/${customer.uuid}/invoices`,
                invoiceData
              );
              console.log(`Imported subscription invoice: ${lsInvoice.id}`);
            } catch (importError: any) {
              console.error(
                "Error importing subscription invoice:",
                importError?.response?.data
                  ? JSON.stringify(importError.response.data)
                  : importError
              );
            }
          } catch (error: any) {
            console.error(
              "Error processing subscription invoice:",
              error?.response?.data || error
            );
          }
        }
      } catch (error: any) {
        console.error(
          "Error processing subscription invoices:",
          error?.response?.data || error
        );
      }
    }
    console.log("Subscription invoices exported and imported successfully!");
    console.log("Data export and import completed successfully!");
  } catch (error) {
    console.error("Error during data export and import:", error);
  }
}

(async () => {
  try {
    await importData();
    console.log("All done.");
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
})();
