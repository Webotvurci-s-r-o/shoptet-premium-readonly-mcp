import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ShoptetClient } from "../client.js";
import { asJsonContent, slimInvoice } from "./shape.js";
import { round2, toShoptetDate } from "../util.js";

export function registerInvoiceTools(server: McpServer, client: ShoptetClient) {
  server.registerTool(
    "list_invoices",
    {
      title: "List invoices",
      description:
        "List invoices with filters (date range, validity, order code, variable symbol). Returns slim records.",
      inputSchema: {
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        tax_date_from: z.string().optional(),
        is_valid: z.boolean().optional(),
        order_code: z.string().optional(),
        var_symbol: z.string().optional(),
        limit: z.number().int().min(1).max(5000).default(1000),
      },
    },
    async (args) => {
      const { items, truncated, pagesFetched } = await client.getAll<any>(
        "/api/invoices",
        {
          creationTimeFrom: toShoptetDate(args.date_from, false),
          creationTimeTo: toShoptetDate(args.date_to, true),
          taxDateFrom: toShoptetDate(args.tax_date_from, false),
          isValid: args.is_valid,
          orderCode: args.order_code,
          varSymbol: args.var_symbol,
        },
        { limit: args.limit },
      );
      const slim = items.map(slimInvoice);
      return asJsonContent({
        count: slim.length,
        truncated,
        pagesFetched,
        total_with_vat: round2(slim.reduce((s, i) => s + i.priceWithVat, 0)),
        invoices: slim,
      });
    },
  );

  server.registerTool(
    "get_invoice",
    {
      title: "Get invoice detail",
      description: "Fetch full detail of a single invoice by code.",
      inputSchema: {
        code: z.string().describe("Invoice code."),
      },
    },
    async ({ code }) => {
      const res = await client.get(`/api/invoices/${encodeURIComponent(code)}`);
      return asJsonContent(res.data);
    },
  );
}
