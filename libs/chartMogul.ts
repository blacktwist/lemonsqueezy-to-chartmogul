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

export const deleteAllChartMogulData = async () => {
  console.log("Starting deletion of all ChartMogul data...");

  try {
    // 1. Delete all customers (this will cascade delete their invoices)
    console.log("Deleting all customers (including their invoices)...");
    const customers = await getAllChartMogulCustomers();

    for (const customer of customers) {
      try {
        await chartMogulApi.delete(`/customers/${customer.uuid}`);
        console.log(`Deleted customer (and their invoices): ${customer.uuid}`);
        // Add a small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error: any) {
        console.error(
          `Error deleting customer ${customer.uuid}:`,
          error?.response?.data || error
        );
      }
    }

    // 2. Delete all plans (now that invoices are gone via customer deletion)
    console.log("Deleting all plans...");
    const plans = await getAllChartMogulPlans();

    for (const plan of plans) {
      try {
        await chartMogulApi.delete(`/plans/${plan.uuid}`);
        console.log(`Deleted plan: ${plan.uuid}`);
        // Add a small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error: any) {
        console.error(
          `Error deleting plan ${plan.uuid}:`,
          error?.response?.data || error
        );
      }
    }

    console.log("All ChartMogul data deleted successfully!");
  } catch (error: any) {
    console.error(
      "Error during ChartMogul data deletion:",
      error?.response?.data || error
    );
    throw error;
  }
};
