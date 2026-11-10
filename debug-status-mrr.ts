/**
 * Read-only audit: ChartMogul active MRR broken down by the Lemon Squeezy
 * status of each subscription, plus LS-active subscriptions with no CM MRR.
 * Usage: npx tsx debug-status-mrr.ts
 */
import "varlock/auto-load";
import {
  getAllLemonSqueezySubscriptions,
  getAllLemonSqueezySubscriptionInvoices,
} from "./libs/lemonSqueezy.js";
import { chartMogulApi, getAllChartMogulCustomers } from "./libs/chartMogul.js";

const $ = (c: number) => `$${(c / 100).toFixed(2)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const lsSubs = await getAllLemonSqueezySubscriptions();
  const lsInvoices = await getAllLemonSqueezySubscriptionInvoices();
  const lsById = new Map(lsSubs.map((s: any) => [String(s.id), s]));

  const lastPaidBySub = new Map<string, any>();
  for (const inv of lsInvoices) {
    if (inv.attributes.status !== "paid") continue;
    const id = String(inv.attributes.subscription_id);
    const d = inv.attributes.created_at;
    const prev = lastPaidBySub.get(id);
    if (!prev || d > (prev.attributes.created_at))
      lastPaidBySub.set(id, inv);
  }

  // All CM subscriptions (active + inactive), keyed by external_id
  const customers = await getAllChartMogulCustomers();
  const cmSubs: any[] = [];
  for (const c of customers) {
    let cursor: string | undefined;
    do {
      const res = await chartMogulApi.get(`/customers/${c.uuid}/subscriptions`, {
        params: { per_page: 200, ...(cursor ? { cursor } : {}) },
      });
      for (const s of res.data.entries) cmSubs.push({ ...s, customer: c });
      cursor = res.data.has_more ? res.data.cursor : undefined;
    } while (cursor);
    await sleep(100);
  }
  const cmByExt = new Map(cmSubs.map((s) => [String(s.external_id), s]));

  // 1. CM active MRR grouped by LS status
  const groups: Record<string, { count: number; mrr: number; rows: any[] }> = {};
  for (const s of cmSubs) {
    if (s.status !== "active" || !s.mrr) continue;
    const ls = lsById.get(String(s.external_id));
    const status = ls ? ls.attributes.status : "NOT_IN_LS";
    groups[status] ??= { count: 0, mrr: 0, rows: [] };
    groups[status].count++;
    groups[status].mrr += s.mrr;
    const last = lastPaidBySub.get(String(s.external_id));
    groups[status].rows.push({
      sub: s.external_id,
      email: s.customer.email,
      plan: s.plan.slice(0, 40),
      cm_mrr: $(s.mrr),
      ls_status: status,
      last_paid: (last?.attributes.created_at || "").slice(0, 10),
      ls_renews_at: (ls?.attributes.renews_at || "").slice(0, 10),
      ls_ends_at: (ls?.attributes.ends_at || "").slice(0, 10),
    });
  }

  console.log("\n=== CM ACTIVE MRR BY LS STATUS ===");
  console.table(
    Object.entries(groups)
      .sort((a, b) => b[1].mrr - a[1].mrr)
      .map(([status, g]) => ({ ls_status: status, subs: g.count, cm_mrr: $(g.mrr) }))
  );

  for (const [status, g] of Object.entries(groups)) {
    if (status === "active") continue;
    console.log(`\n--- CM-active subscriptions whose LS status is "${status}" ---`);
    console.table(g.rows);
  }

  // 2. LS active subscriptions with no CM MRR
  console.log("\n=== LS ACTIVE subscriptions with no active MRR in CM ===");
  const missing = lsSubs
    .filter((s: any) => s.attributes.status === "active")
    .filter((s: any) => {
      const cm = cmByExt.get(String(s.id));
      return !cm || cm.status !== "active" || !cm.mrr;
    })
    .map((s: any) => {
      const cm = cmByExt.get(String(s.id));
      const last = lastPaidBySub.get(String(s.id));
      return {
        sub: s.id,
        email: s.attributes.user_email,
        variant: s.attributes.variant_name,
        cm: cm ? `${cm.status} ${$(cm.mrr)}` : "NOT IN CM",
        last_paid: (last?.attributes.created_at || "none").slice(0, 10),
        last_paid_total: last ? $(last.attributes.total) : "",
        renews_at: (s.attributes.renews_at || "").slice(0, 10),
      };
    });
  console.table(missing);

  const total = Object.values(groups).reduce((a, g) => a + g.mrr, 0);
  const nonActive = Object.entries(groups)
    .filter(([s]) => s !== "active")
    .reduce((a, [, g]) => a + g.mrr, 0);
  console.log(`\nTotal CM MRR: ${$(total)}`);
  console.log(`CM MRR on subs NOT active in LS: ${$(nonActive)}`);
  console.log(`CM MRR on subs active in LS: ${$(groups.active?.mrr || 0)}`);
  console.log(`LS-active subs with no CM MRR: ${missing.length}`);
}

main().catch((e) => {
  console.error(e?.response?.data || e);
  process.exit(1);
});
