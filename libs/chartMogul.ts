import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

// ChartMogul API client
export const chartMogulApi = axios.create({
  baseURL: "https://api.chartmogul.com/v1",
  auth: {
    username: process.env.CHARTMOGUL_API_KEY || "",
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
