/**
 * Read-only audit: which Lemon Squeezy products/variants are NOT recurring,
 * how they were created as ChartMogul plans, and whether any of them carry
 * MRR in ChartMogul (subscriptions / subscription invoices on them).
 * Usage: npx tsx debug-plan-types.ts
 */
import "varlock/auto-load";
import {
  getAllLemonSqueezyProducts,
  getAllLemonSqueezyVariants,
  getAllLemonSqueezySubscriptions,
  getAllLemonSqueezySubscriptionInvoices,
} from "./libs/lemonSqueezy.js";
import {
  chartMogulApi,
  getAllChartMogulPlans,
  getAllChartMogulCustomers,
} from "./libs/chartMogul.js";
import { getPlanExternalId } from "./libs/sync-utils.js";

const $ = (c: number) => `$${(c / 100).toFixed(2)}`;

async function main() {
  const products = await getAllLemonSqueezyProducts();
  const cmPlans = await getAllChartMogulPlans();
  const subs = await getAllLemonSqueezySubscriptions();
  const subInvoices = await getAllLemonSqueezySubscriptionInvoices();

  type Row = {
    externalId: string;
    name: string;
    lsIsSub: boolean | null;
    lsInterval: string | null;
    cmInterval: string;
    subsByStatus: Record<string, number>;
    invoiceCount: number;
  };
  const rows: Row[] = [];

  for (const p of products) {
    const variants = await getAllLemonSqueezyVariants(parseInt(p.id));
    const entries =
      variants.length === 0
        ? [{ extId: String(p.id), name: p.attributes.name, v: null as any }]
        : variants.map((v: any) => ({
            extId: `${p.id}-${v.id}`,
            name: `${p.attributes.name} - ${v.attributes.name}`,
            v,
          }));
    for (const e of entries) {
      const cm = cmPlans.find((pl: any) => pl.external_id === e.extId);
      const planSubs = subs.filter(
        (s: any) =>
          getPlanExternalId(s.attributes.product_id, s.attributes.variant_id) ===
          e.extId
      );
      const subsByStatus: Record<string, number> = {};
      for (const s of planSubs)
        subsByStatus[s.attributes.status] =
          (subsByStatus[s.attributes.status] || 0) + 1;
      const subIds = new Set(planSubs.map((s: any) => String(s.id)));
      rows.push({
        externalId: e.extId,
        name: e.name,
        lsIsSub: e.v ? !!e.v.attributes.is_subscription : null,
        lsInterval: e.v?.attributes.interval
          ? `${e.v.attributes.interval_count || 1} ${e.v.attributes.interval}`
          : null,
        cmInterval: cm
          ? `${cm.interval_count} ${cm.interval_unit}`
          : "MISSING IN CM",
        subsByStatus,
        invoiceCount: subInvoices.filter((i: any) =>
          subIds.has(String(i.attributes.subscription_id))
        ).length,
      });
    }
  }

  console.log("\n=== ALL PLANS ===");
  console.table(
    rows.map((r) => ({
      ext: r.externalId,
      name: r.name.slice(0, 50),
      ls_is_sub: r.lsIsSub,
      ls_interval: r.lsInterval,
      cm_interval: r.cmInterval,
      subs: JSON.stringify(r.subsByStatus),
      sub_invoices: r.invoiceCount,
    }))
  );

  const nonRecurring = rows.filter((r) => r.lsIsSub !== true);
  console.log("\n=== NON-RECURRING (one-time / no variants) PLANS ===");
  console.table(
    nonRecurring.map((r) => ({
      ext: r.externalId,
      name: r.name.slice(0, 50),
      cm_interval: r.cmInterval,
      subs: JSON.stringify(r.subsByStatus),
      sub_invoices: r.invoiceCount,
    }))
  );

  // ChartMogul side: active subscriptions per plan, with MRR
  console.log("\n=== CHARTMOGUL ACTIVE MRR BY PLAN ===");
  const customers = await getAllChartMogulCustomers();
  const byPlan: Record<string, { count: number; mrr: number }> = {};
  for (const c of customers) {
    if (!c.mrr) continue;
    let cursor: string | undefined;
    do {
      const res = await chartMogulApi.get(
        `/customers/${c.uuid}/subscriptions`,
        { params: { per_page: 200, ...(cursor ? { cursor } : {}) } }
      );
      for (const s of res.data.entries) {
        if (s.status !== "active" || !s.mrr) continue;
        byPlan[s.plan] ??= { count: 0, mrr: 0 };
        byPlan[s.plan].count++;
        byPlan[s.plan].mrr += s.mrr;
      }
      cursor = res.data.has_more ? res.data.cursor : undefined;
    } while (cursor);
    await new Promise((r) => setTimeout(r, 100));
  }
  const nonRecNames = new Set(nonRecurring.map((r) => r.name));
  console.table(
    Object.entries(byPlan)
      .sort((a, b) => b[1].mrr - a[1].mrr)
      .map(([plan, v]) => ({
        plan: plan.slice(0, 50),
        active_subs: v.count,
        mrr: $(v.mrr),
        non_recurring_in_ls: nonRecNames.has(plan),
      }))
  );
  const total = Object.values(byPlan).reduce((a, v) => a + v.mrr, 0);
  const nonRecTotal = Object.entries(byPlan)
    .filter(([p]) => nonRecNames.has(p))
    .reduce((a, [, v]) => a + v.mrr, 0);
  console.log(`\nTotal CM MRR: ${$(total)}`);
  console.log(`CM MRR on non-recurring LS plans: ${$(nonRecTotal)}`);
}

main().catch((e) => {
  console.error(e?.response?.data || e);
  process.exit(1);
});
