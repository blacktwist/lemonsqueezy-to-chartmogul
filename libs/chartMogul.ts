import "varlock/auto-load";
import { ENV } from "varlock/env";
import axios from "axios";

const CHARTMOGUL_API_KEY = ENV.CHARTMOGUL_API_KEY;

// ChartMogul API client
export const chartMogulApi = axios.create({
  baseURL: "https://api.chartmogul.com/v1",
  auth: {
    username: CHARTMOGUL_API_KEY,
    password: "",
  },
});

export const getAllChartMogulCustomers = async () => {
  let allCustomers: any[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  console.log("Fetching all customers from ChartMogul...");

  while (hasMore) {
    try {
      const params: any = {
        per_page: 200, // Maximum allowed per page
      };

      if (cursor) {
        params.cursor = cursor;
      }

      const response = await chartMogulApi.get("/customers", { params });

      if (response.data.entries) {
        allCustomers = [...allCustomers, ...response.data.entries];
        console.log(
          `Fetched ${response.data.entries.length} customers. Total so far: ${allCustomers.length}`
        );
      }

      hasMore = response.data.has_more || false;
      cursor = response.data.cursor;

      // Add a small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error: any) {
      console.error(
        "Error fetching customers from ChartMogul:",
        error?.response?.data || error
      );
      break;
    }
  }

  console.log(
    `Total customers fetched from ChartMogul: ${allCustomers.length}`
  );
  return allCustomers;
};

export const getAllChartMogulPlans = async () => {
  let allPlans: any[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  console.log("Fetching all plans from ChartMogul...");

  while (hasMore) {
    try {
      const params: any = {
        per_page: 200, // Maximum allowed per page
      };

      if (cursor) {
        params.cursor = cursor;
      }

      const response = await chartMogulApi.get("/plans", { params });

      if (response.data.plans) {
        allPlans = [...allPlans, ...response.data.plans];
        console.log(
          `Fetched ${response.data.plans.length} plans. Total so far: ${allPlans.length}`
        );
      }

      hasMore = response.data.has_more || false;
      cursor = response.data.cursor;

      // Add a small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error: any) {
      console.error(
        "Error fetching plans from ChartMogul:",
        error?.response?.data || error
      );
      break;
    }
  }

  console.log(`Total plans fetched from ChartMogul: ${allPlans.length}`);
  return allPlans;
};

export const getAllChartMogulInvoices = async () => {
  let allInvoices: any[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  console.log("Fetching all invoices from ChartMogul...");

  while (hasMore) {
    try {
      const params: any = {
        per_page: 200, // Maximum allowed per page
      };

      if (cursor) {
        params.cursor = cursor;
      }

      const response = await chartMogulApi.get("/invoices", { params });

      if (response.data.invoices) {
        allInvoices = [...allInvoices, ...response.data.invoices];
        console.log(
          `Fetched ${response.data.invoices.length} invoices. Total so far: ${allInvoices.length}`
        );
      }

      hasMore = response.data.has_more || false;
      cursor = response.data.cursor;

      // Add a small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error: any) {
      console.error(
        "Error fetching invoices from ChartMogul:",
        error?.response?.data || error
      );
      break;
    }
  }

  console.log(`Total invoices fetched from ChartMogul: ${allInvoices.length}`);
  return allInvoices;
};

const VERIFY_DELETE_MAX_ATTEMPTS = 10;
const VERIFY_DELETE_DELAY_MS = 3000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitUntilEmpty = async (
  fetchAll: () => Promise<any[]>,
  label: string
) => {
  for (let attempt = 1; attempt <= VERIFY_DELETE_MAX_ATTEMPTS; attempt++) {
    const remaining = await fetchAll();
    if (remaining.length === 0) {
      console.log(`Confirmed all ${label} are gone.`);
      return;
    }
    console.log(
      `${remaining.length} ${label} still visible after deletion (attempt ${attempt}/${VERIFY_DELETE_MAX_ATTEMPTS}), waiting for ChartMogul to catch up...`
    );
    await sleep(VERIFY_DELETE_DELAY_MS);
  }
  throw new Error(
    `${label} still present in ChartMogul after ${VERIFY_DELETE_MAX_ATTEMPTS} checks; aborting sync to avoid importing on top of stale data.`
  );
};

const DELETE_MAX_RETRIES = 4;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const deleteWithRetry = async (path: string) => {
  for (let retry = 0; ; retry++) {
    try {
      await chartMogulApi.delete(path);
      return;
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 404) return;
      const retryable = !error?.response || RETRYABLE_STATUSES.has(status);
      if (!retryable || retry >= DELETE_MAX_RETRIES) throw error;
      const retryAfterSeconds = Number(error.response?.headers?.["retry-after"]);
      const delayMs =
        retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 1000 * 2 ** retry;
      console.warn(
        `DELETE ${path} failed (${status ?? error.code}), retrying in ${delayMs}ms (retry ${retry + 1}/${DELETE_MAX_RETRIES})...`
      );
      await sleep(delayMs);
    }
  }
};

const deleteAll = async (
  records: any[],
  label: string,
  pathFor: (record: any) => string
) => {
  const failures: { uuid: string; error: any }[] = [];

  for (const record of records) {
    try {
      await deleteWithRetry(pathFor(record));
      console.log(`Deleted ${label}: ${record.uuid}`);
    } catch (error: any) {
      const details = error?.response?.data || error?.message || error;
      console.error(`Error deleting ${label} ${record.uuid}:`, details);
      failures.push({ uuid: record.uuid, error: details });
    }
    await sleep(100);
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to delete ${failures.length}/${records.length} ${label}(s); aborting sync. First error: ${JSON.stringify(failures[0].error)}`
    );
  }
};

export const deleteAllChartMogulData = async () => {
  console.log("Starting deletion of all ChartMogul data...");

  try {
    console.log("Deleting all customers (including their invoices)...");
    const customers = await getAllChartMogulCustomers();
    await deleteAll(customers, "customer", (c) => `/customers/${c.uuid}`);

    await waitUntilEmpty(getAllChartMogulCustomers, "customers");

    console.log("Deleting all plans...");
    const plans = await getAllChartMogulPlans();
    await deleteAll(plans, "plan", (p) => `/plans/${p.uuid}`);

    await waitUntilEmpty(getAllChartMogulPlans, "plans");

    console.log("All ChartMogul data deleted successfully!");
  } catch (error: any) {
    console.error(
      "Error during ChartMogul data deletion:",
      error?.response?.data || error
    );
    throw error;
  }
};
