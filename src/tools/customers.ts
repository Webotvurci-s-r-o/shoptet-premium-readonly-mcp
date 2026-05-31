import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ShoptetClient } from "../client.js";
import { asJsonContent, slimCustomer } from "./shape.js";

export function registerCustomerTools(server: McpServer, client: ShoptetClient) {
  server.registerTool(
    "list_customers",
    {
      title: "List customers",
      description:
        "List customers, optionally filtered by email or phone. NOTE: Shoptet's list view is intentionally thin — returned records contain only GUID, name, company, and timestamps. Call get_customer for email/phone/addresses.",
      inputSchema: {
        email: z.string().optional(),
        phone: z.string().optional(),
        limit: z.number().int().min(1).max(5000).default(500),
      },
    },
    async ({ email, phone, limit }) => {
      const { items, truncated, pagesFetched } = await client.getAll<any>(
        "/api/customers",
        { email, phone },
        { limit },
      );
      return asJsonContent({
        count: items.length,
        truncated,
        pagesFetched,
        customers: items.map(slimCustomer),
      });
    },
  );

  server.registerTool(
    "get_customer",
    {
      title: "Get customer detail",
      description: "Fetch full detail for a customer by GUID.",
      inputSchema: {
        guid: z.string().describe("Customer GUID."),
      },
    },
    async ({ guid }) => {
      const res = await client.get(`/api/customers/${encodeURIComponent(guid)}`);
      return asJsonContent(res.data);
    },
  );
}
