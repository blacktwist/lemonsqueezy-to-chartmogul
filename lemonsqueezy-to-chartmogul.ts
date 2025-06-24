import {
  chartMogulApi,
  getAllChartMogulCustomers,
  getAllChartMogulPlans,
} from "./libs/chartMogul";
import {
  getAllLemonSqueezyCustomers,
  getAllLemonSqueezyDiscountRedemptions,
  getAllLemonSqueezyProducts,
  getAllLemonSqueezyVariants,
  getAllLemonSqueezySubscriptions,
  lemonSqueezyClient,
} from "./libs/lemonSqueezy";

async function importData() {
  try {
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
              data_source_uuid: process.env.CHARTMOGUL_DATA_SOURCE_UUID,
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
            console.error(
              "Error updating customer:",
              // @ts-ignore
              error?.response?.data
            );
          }
        } else {
          try {
            // Customer doesn't exist, create them
            console.log("Creating customer:", {
              name: customer.attributes.name || customer.attributes.email,
              email: customer.attributes.email,
              external_id: customer.id.toString(),
            });
            await chartMogulApi.post("/customers", {
              external_id: customer.id.toString(),
              data_source_uuid: process.env.CHARTMOGUL_DATA_SOURCE_UUID,
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
              data_source_uuid: process.env.CHARTMOGUL_DATA_SOURCE_UUID,
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
                data_source_uuid: process.env.CHARTMOGUL_DATA_SOURCE_UUID,
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
          let planExternalId = subscription.attributes.variant_id
            ? `${subscription.attributes.product_id}-${subscription.attributes.variant_id}`
            : subscription.attributes.product_id.toString();

          if (subscription.attributes.status === "active") {
            try {
              await chartMogulApi.post("/subscription_events", {
                subscription_event: {
                  external_id: `${subscription.id}-start`,
                  customer_external_id: customer.external_id,
                  data_source_uuid: process.env.CHARTMOGUL_DATA_SOURCE_UUID,
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
                  data_source_uuid: process.env.CHARTMOGUL_DATA_SOURCE_UUID,
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
                  data_source_uuid: process.env.CHARTMOGUL_DATA_SOURCE_UUID,
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
    console.log(`Found ${subscriptions.length} subscriptions in LemonSqueezy`);

    for (const subscription of subscriptions) {
      try {
        console.log("Processing subscription:", {
          id: subscription.id,
          customer_email: subscription.attributes.user_email,
          status: subscription.attributes.status,
          product_id: subscription.attributes.product_id,
          order_id: subscription.attributes.order_id,
        });

        // Find the customer in ChartMogul
        const customer = existingChartMogulCustomers.find(
          (c) => c.email === subscription.attributes.user_email
        );

        if (!customer) {
          console.error(
            "Customer not found on ChartMogul:",
            subscription.attributes.user_email
          );
          continue;
        }

        // Get the order details to get pricing information
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

        // get the discount redemption for this order
        const discountRedemption = allLemonSqueezyDiscountRedemptions.find(
          (d) => d.attributes.order_id === subscription.attributes.order_id
        );

        // Prepare line items for ChartMogul
        const lineItems = [];

        // Get plan UUID from ChartMogul
        let planExternalId = subscription.attributes.variant_id
          ? `${subscription.attributes.product_id}-${subscription.attributes.variant_id}`
          : subscription.attributes.product_id.toString();

        // Search for the plan in ChartMogul
        try {
          // Use the existing plans array instead of API call
          const plan = existingChartMogulPlans.find(
            (p) => p.external_id === planExternalId
          );

          if (plan) {
            // Calculate original price before discount
            const discountAmount = discountRedemption?.attributes?.amount || 0;
            const originalAmount =
              order.data.attributes.subtotal - discountAmount;

            lineItems.push({
              type: "subscription",
              subscription_external_id: subscription.id.toString(),
              plan_uuid: plan.uuid,
              service_period_start: subscription.attributes.created_at,
              service_period_end:
                subscription.attributes.ends_at ||
                subscription.attributes.renews_at,
              amount_in_cents: originalAmount, // ✅ Original price before discount
              quantity: 1,
              event_order: 1,
              discount_description:
                discountRedemption?.attributes?.discount_name || undefined,
              discount_code:
                discountRedemption?.attributes?.discount_code || undefined,
              discount_amount_in_cents: discountAmount, // ✅ Discount amount
              tax_amount_in_cents: order.data.attributes.tax,
              transaction_fees_in_cents:
                subscription.attributes.transaction_fees,
              transaction_fees_currency: order.data.attributes.currency,
            });
          } else {
            console.log(`Plan not found for external_id: ${planExternalId}`);
          }
        } catch (planError: any) {
          console.error(
            "Error finding plan for subscription:",
            planError?.response?.data || planError
          );
        }

        // Prepare transactions
        const transactions = [];
        if (subscription.attributes.status === "active") {
          transactions.push({
            date: subscription.attributes.created_at,
            type: "payment",
            result: "successful",
          });
        }

        // Import invoice to ChartMogul
        try {
          await chartMogulApi.post(
            `/import/customers/${customer.uuid}/invoices`,
            {
              invoices: [
                {
                  external_id: "inv-" + subscription.id.toString(),
                  date: subscription.attributes.created_at,
                  currency: order.data.attributes.currency,
                  due_date: subscription.attributes.created_at,
                  customer_external_id: customer.external_id,
                  data_source_uuid: process.env.CHARTMOGUL_DATA_SOURCE_UUID,
                  line_items: lineItems,
                  transactions: transactions,
                },
              ],
            }
          );
          console.log(`Imported subscription as invoice: ${subscription.id}`);
        } catch (importError: any) {
          console.error(
            "Error importing subscription as invoice:",
            importError?.response?.data
              ? JSON.stringify(importError.response.data)
              : importError
          );
        }
      } catch (error: any) {
        console.error(
          "Error processing subscription:",
          error?.response?.data || error
        );
      }
    }
    console.log(
      "Subscriptions exported and imported as invoices successfully!"
    );
    console.log("Data export and import completed successfully!");
  } catch (error) {
    console.error("Error during data export and import:", error);
  }
}

importData();
