#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ShoptetClient } from "./client.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerProductTools } from "./tools/products.js";
import { registerCustomerTools } from "./tools/customers.js";
import { registerInvoiceTools } from "./tools/invoices.js";
import { registerLookupTools } from "./tools/lookups.js";
import { registerReviewTools } from "./tools/reviews.js";
import { registerStockTools } from "./tools/stocks.js";
import { registerFinanceTools } from "./tools/finance.js";
import { registerMarketingTools } from "./tools/marketing.js";

async function main() {
  const token = process.env.SHOPTET_PRIVATE_API_TOKEN;
  if (!token) {
    console.error(
      "[shoptet-mcp] SHOPTET_PRIVATE_API_TOKEN env var is required. " +
        "Generate the token in Shoptet admin → Connections → API access.",
    );
    process.exit(1);
  }

  const client = new ShoptetClient({
    token,
    baseUrl: process.env.SHOPTET_API_BASE_URL,
  });

  const server = new McpServer(
    {
      name: "shoptet-premium-readonly",
      version: "0.1.0",
    },
    {
      capabilities: { tools: {} },
      instructions:
        "Read-only access to a Shoptet Premium e-shop. " +
        "Use orders_summary / revenue_trend / top_products for analytics — they aggregate server-side. " +
        "Use list_* for raw lists and get_* for single-record details. " +
        "When the user asks about status IDs, source IDs, payment/shipping method GUIDs, call the matching " +
        "list_order_statuses / list_order_sources / list_payment_methods / list_shipping_methods first. " +
        "shoptet_raw_get is an escape hatch for endpoints without a specialized tool.",
    },
  );

  registerOrderTools(server, client);
  registerProductTools(server, client);
  registerCustomerTools(server, client);
  registerInvoiceTools(server, client);
  registerReviewTools(server, client);
  registerStockTools(server, client);
  registerFinanceTools(server, client);
  registerMarketingTools(server, client);
  registerLookupTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[shoptet-mcp] ready on stdio");
}

main().catch((err) => {
  console.error("[shoptet-mcp] fatal:", err);
  process.exit(1);
});
