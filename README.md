Brought to you by [BlackTwist](https://blacktwist.app)

### Lemon Squeezy to ChartMogul

Lemon Squeezy is a subscription management and billing platform designed to help businesses manage their recurring revenue streams. It offers features such as subscription tracking, automated billing, and revenue analytics to streamline the subscription lifecycle.

ChartMogul is a subscription analytics and revenue reporting tool designed to help businesses understand their subscription metrics. It offers features such as MRR tracking, churn analysis, and cohort reporting to provide insights into the health of a subscription business.

The script `@lemonsqueezy-to-chartmogul.ts` automates the process of exporting data from Lemon Squeezy and importing it into ChartMogul, allowing businesses to easily track their subscription metrics and revenue analytics in one place. This script helps to streamline the subscription lifecycle by synchronizing customer, plan, and subscription data between the two platforms, providing a more accurate and up-to-date view of a business's subscription health.

## Get started

### ChartMogul

Create a ChartMogul account.

Create an API Key.

Copy the data source ID.

### Lemon Squeezy

Create an API Key.

## How to run

Create the file `.env` in the project folder.

Fill it with the right values:

```yaml
LEMONSQUEEZY_API_KEY='...'
CHARTMOGUL_API_KEY="..."
CHARTMOGUL_DATA_SOURCE_UUID="..."
```

Install the dependencies

```bash
npm install
```

Run the script

```bash
npm run start
```

At the end of the process all the customers, subscriptions, invoices, will be created.

To update the data, delete all the content of the ChartMogul source, and run the script again.

### Roadmap

Create the code for the webhook to configure in Lemon Squeezy to keep track of the new subscription events.

### Author

This script has been initially developed by [Luca Restagno](https://www.threads.com/@luca.restagno.dev) for [BlackTwist](https://blacktwist.app).
