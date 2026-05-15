import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ShoptetClient } from "../client.js";
import { asJsonContent } from "./shape.js";

/**
 * Code-list / metadata tools. These map IDs the model sees in raw responses
 * (statusId, sourceId, paymentMethodGuid, …) back to human-readable names.
 * Cheap to call — used to interpret other tool outputs.
 */
export function registerLookupTools(server: McpServer, client: ShoptetClient) {
  const simple = (
    name: string,
    title: string,
    description: string,
    path: string,
  ) => {
    server.registerTool(name, { title, description }, async () => {
      const res = await client.get(path);
      return asJsonContent(res.data);
    });
  };

  simple("list_order_statuses", "Order statuses code list", "List all order status codes/IDs.", "/api/orders/statuses");
  simple("list_order_sources", "Order sources code list", "List all order source codes/IDs.", "/api/orders/sources");
  simple("list_payment_methods", "Payment methods", "List all payment methods configured in the e-shop.", "/api/payment-methods");
  simple("list_shipping_methods", "Shipping methods", "List all shipping methods configured in the e-shop.", "/api/shipping-methods");
  simple("list_categories", "Product categories", "List product categories.", "/api/categories");
  simple("list_brands", "Brands", "List brands / manufacturers.", "/api/brands");
  simple("list_suppliers", "Suppliers", "List suppliers.", "/api/suppliers");
  simple("list_pricelists", "Price lists", "List all price lists.", "/api/pricelists");
  simple("list_stocks", "Stocks / warehouses", "List warehouses (stocks).", "/api/stocks");
  simple("list_sales_channels", "Sales channels", "List sales channels (marketplaces, feeds, etc).", "/api/sales-channels");
  simple("list_customer_groups", "Customer groups", "List customer groups.", "/api/customers/groups");
  simple("eshop_info", "E-shop info & settings", "Basic info about the connected e-shop (currencies, name, contact).", "/api/eshop");

  server.registerTool(
    "list_endpoints",
    {
      title: "List Shoptet API endpoints available to this token",
      description: "Returns the list of endpoints exposed to the current Premium token. Helpful before reaching for shoptet_raw_get.",
    },
    async () => {
      const res = await client.get("/api/system/endpoints");
      return asJsonContent(res.data);
    },
  );

  server.registerTool(
    "shoptet_raw_get",
    {
      title: "Escape hatch: raw GET to Shoptet API",
      description:
        "Issue a raw GET request to any /api/... endpoint. Path is validated to start with /api/. Use only for endpoints not covered by specialized tools — prefer those for analytics. Returns parsed JSON response untouched.",
      inputSchema: {
        path: z
          .string()
          .describe("API path starting with /api/, e.g. '/api/credit-notes' or '/api/products/changes'."),
        query: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Query parameters as a flat object."),
      },
    },
    async ({ path, query }) => {
      const res = await client.get(path, query ?? {});
      return asJsonContent(res.data);
    },
  );
}
