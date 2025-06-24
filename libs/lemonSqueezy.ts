import { LemonSqueezy } from "@lemonsqueezy/lemonsqueezy.js";
import dotenv from "dotenv";

dotenv.config();

export const lemonSqueezyClient = new LemonSqueezy(
  process.env.LEMONSQUEEZY_API_KEY || ""
);

type LemonSqueezyCustomersResponse = {
  meta: {
    page: {
      currentPage: number;
      from: number;
      lastPage: number;
      perPage: number;
      to: number;
      total: number;
    };
  };
  jsonapi: {
    version: string;
  };
  links: {
    first: string;
    last: string;
  };
  data: [
    {
      type: "customers";
      id: string;
      attributes: {
        store_id: number;
        name: string;
        email: string;
        status: string;
        city: string | null;
        region: string | null;
        country: string;
        total_revenue_currency: number;
        mrr: number;
        status_formatted: string;
        country_formatted: string;
        total_revenue_currency_formatted: string;
        mrr_formatted: string;
        urls: {
          customer_portal: string;
        };
        created_at: string;
        updated_at: string;
        test_mode: boolean;
      };
      relationships: {
        store: {
          links: {
            related: string;
            self: string;
          };
        };
        orders: {
          links: {
            related: string;
            self: string;
          };
        };
        subscriptions: {
          links: {
            related: string;
            self: string;
          };
        };
        "license-keys": {
          links: {
            related: string;
          };
        };
      };
      links: {
        self: "https://api.lemonsqueezy.com/v1/customers/1";
      };
    }
  ];
};

export const getAllLemonSqueezyCustomers = async () => {
  let customers: LemonSqueezyCustomersResponse["data"][0][] = [];
  let page = 1;
  while (true) {
    // @ts-ignore
    const response: LemonSqueezyCustomersResponse =
      await lemonSqueezyClient.getCustomers({
        page: page,
      });
    customers = [
      ...(customers as LemonSqueezyCustomersResponse["data"][0][]),
      ...(response.data as LemonSqueezyCustomersResponse["data"][0][]),
    ];
    if (response.meta.page.currentPage === response.meta.page.lastPage) {
      break;
    }
    page++;
  }
  return customers;
};

type LemonSqueezyProductsResponse = {
  meta: {
    page: {
      currentPage: number;
      from: number;
      lastPage: number;
      perPage: number;
      to: number;
      total: number;
    };
  };
  jsonapi: {
    version: string;
  };
  links: {
    first: string;
    last: string;
  };
  data: [
    {
      type: "products";
      id: string;
      attributes: {
        store_id: number;
        name: string;
        slug: string;
        description: string;
        status: string;
        status_formatted: string;
        thumb_url: string | null;
        large_thumb_url: string | null;
        price: number;
        price_formatted: string;
        from_price: number | null;
        to_price: number | null;
        pay_what_you_want: boolean;
        buy_now_url: string;
        created_at: string;
        updated_at: string;
        test_mode: boolean;
      };
      relationships: {
        store: {
          links: {
            related: string;
            self: string;
          };
        };
        variants: {
          links: {
            related: string;
            self: string;
          };
        };
      };
      links: {
        self: string;
      };
    }
  ];
};

type LemonSqueezyVariantsResponse = {
  meta: {
    page: {
      currentPage: number;
      from: number;
      lastPage: number;
      perPage: number;
      to: number;
      total: number;
    };
  };
  jsonapi: {
    version: string;
  };
  links: {
    first: string;
    last: string;
  };
  data: [
    {
      type: "variants";
      id: string;
      attributes: {
        product_id: number;
        name: string;
        slug: string;
        description: string;
        price: number;
        is_subscription: boolean;
        interval: string | null;
        interval_count: number | null;
        has_free_trial: boolean;
        trial_interval: string;
        trial_interval_count: number;
        pay_what_you_want: boolean;
        min_price: number;
        suggested_price: number;
        has_license_keys: boolean;
        license_activation_limit: number;
        is_license_limit_unlimited: boolean;
        license_length_value: number;
        license_length_unit: string;
        is_license_length_unlimited: boolean;
        sort: number;
        status: string;
        status_formatted: string;
        created_at: string;
        updated_at: string;
        test_mode: boolean;
      };
      relationships: {
        product: {
          links: {
            related: string;
            self: string;
          };
        };
      };
      links: {
        self: string;
      };
    }
  ];
};

export const getAllLemonSqueezyVariants = async (productId: number) => {
  let variants: LemonSqueezyVariantsResponse["data"][0][] = [];
  let page = 1;
  while (true) {
    // @ts-ignore
    const response: LemonSqueezyVariantsResponse =
      await lemonSqueezyClient.getVariants({
        productId: productId,
        page: page,
      });
    variants = [
      ...(variants as LemonSqueezyVariantsResponse["data"][0][]),
      ...(response.data as LemonSqueezyVariantsResponse["data"][0][]),
    ];
    if (response.meta.page.currentPage === response.meta.page.lastPage) {
      break;
    }
    page++;
  }
  return variants;
};

export const getAllLemonSqueezyProducts = async () => {
  let products: LemonSqueezyProductsResponse["data"][0][] = [];
  let page = 1;
  while (true) {
    // @ts-ignore
    const response: LemonSqueezyProductsResponse =
      await lemonSqueezyClient.getProducts({
        page: page,
      });
    products = [
      ...(products as LemonSqueezyProductsResponse["data"][0][]),
      ...(response.data as LemonSqueezyProductsResponse["data"][0][]),
    ];
    if (response.meta.page.currentPage === response.meta.page.lastPage) {
      break;
    }
    page++;
  }
  return products;
};

export const getAllLemonSqueezySubscriptions = async () => {
  let subscriptions: any[] = [];
  let page = 1;

  console.log("Fetching all subscriptions from LemonSqueezy...");

  while (true) {
    try {
      // @ts-ignore
      const response = await lemonSqueezyClient.getSubscriptions({
        page: page,
      });

      if (response.data && response.data.length > 0) {
        subscriptions = [...subscriptions, ...response.data];
        console.log(
          `Fetched ${response.data.length} subscriptions. Total so far: ${subscriptions.length}`
        );
      }

      // Check if we've reached the last page
      // @ts-ignore
      if (response.meta && response.meta.page) {
        // @ts-ignore
        if (response.meta.page.currentPage === response.meta.page.lastPage) {
          break;
        }
      } else if (!response.data || response.data.length === 0) {
        break;
      }

      page++;

      // Add a small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error: any) {
      console.error(
        "Error fetching subscriptions from LemonSqueezy:",
        error?.response?.data || error
      );
      break;
    }
  }

  console.log(
    `Total subscriptions fetched from LemonSqueezy: ${subscriptions.length}`
  );
  return subscriptions;
};

export const getAllLemonSqueezyDiscountRedemptions = async () => {
  let discountRedemptions: any[] = [];
  let page = 1;

  console.log("Fetching all discount redemptions from LemonSqueezy...");

  while (true) {
    try {
      // @ts-ignore
      const response = await lemonSqueezyClient.getDiscountRedemptions({
        page: page,
      });

      if (response.data && response.data.length > 0) {
        discountRedemptions = [...discountRedemptions, ...response.data];
        console.log(
          `Fetched ${response.data.length} discount redemptions. Total so far: ${discountRedemptions.length}`
        );
      }

      // Check if we've reached the last page
      // @ts-ignore
      if (response.meta && response.meta.page) {
        // @ts-ignore
        if (response.meta.page.currentPage === response.meta.page.lastPage) {
          break;
        }
      } else if (!response.data || response.data.length === 0) {
        break;
      }

      page++;

      // Add a small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error: any) {
      console.error(
        "Error fetching discount redemptions from LemonSqueezy:",
        error?.response?.data || error
      );
      break;
    }
  }

  console.log(
    `Total discount redemptions fetched from LemonSqueezy: ${discountRedemptions.length}`
  );
  return discountRedemptions;
};
