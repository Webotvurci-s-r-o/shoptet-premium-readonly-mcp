import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ShoptetClient } from "../client.js";
import { asJsonContent } from "./shape.js";
import { bucketKey, parseNumber, round2, toShoptetDate } from "../util.js";

interface SlimCreditNote {
  code: string;
  invoiceCode?: string;
  orderCode?: string;
  creationTime?: string;
  changeTime?: string;
  varSymbol?: string | number;
  isValid?: boolean;
  reasonRemark?: string | null;
  fullName?: string;
  company?: string;
  currency?: string;
  /** Credit-note totals are typically negative (refunds). */
  priceWithVat: number;
  priceWithoutVat: number;
  toPay: number;
}

function slimCreditNote(raw: any): SlimCreditNote {
  const p = raw?.price ?? {};
  return {
    code: raw?.code,
    invoiceCode: raw?.invoiceCode,
    orderCode: raw?.orderCode,
    creationTime: raw?.creationTime,
    changeTime: raw?.changeTime,
    varSymbol: raw?.varSymbol,
    isValid: raw?.isValid,
    reasonRemark: raw?.reasonRemark,
    fullName: raw?.billFullName,
    company: raw?.billCompany,
    currency: p?.currencyCode,
    priceWithVat: parseNumber(p?.withVat),
    priceWithoutVat: parseNumber(p?.withoutVat),
    toPay: parseNumber(p?.toPay),
  };
}

export function registerFinanceTools(server: McpServer, client: ShoptetClient) {
  server.registerTool(
    "list_credit_notes",
    {
      title: "List credit notes (refunds)",
      description:
        "List credit notes — typically issued when an invoice is refunded fully or partially. Totals are usually negative. Filter by date range or source invoice code.",
      inputSchema: {
        date_from: z.string().optional().describe("YYYY-MM-DD or ISO 8601."),
        date_to: z.string().optional(),
        invoice_code: z.string().optional().describe("Filter to credit notes against one invoice."),
        is_valid: z.boolean().optional(),
        limit: z.number().int().min(1).max(5000).default(500),
      },
    },
    async (args) => {
      const { items, truncated, pagesFetched } = await client.getAll<any>(
        "/api/credit-notes",
        {
          creationTimeFrom: toShoptetDate(args.date_from, false),
          creationTimeTo: toShoptetDate(args.date_to, true),
          invoiceCode: args.invoice_code,
          isValid: args.is_valid,
        },
        { limit: args.limit },
      );
      const slim = items.map(slimCreditNote);
      return asJsonContent({
        count: slim.length,
        truncated,
        pagesFetched,
        total_with_vat: round2(slim.reduce((s, c) => s + c.priceWithVat, 0)),
        credit_notes: slim,
      });
    },
  );

  server.registerTool(
    "refunds_summary",
    {
      title: "Refunds summary (credit notes aggregated)",
      description:
        "Aggregate credit notes (refunds) over time. Returns total refund value, count, and optional time series. Use date range matching your accounting period.",
      inputSchema: {
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        group_by: z.enum(["none", "day", "week", "month", "year"]).default("month"),
        limit: z.number().int().min(1).max(5000).default(2000),
      },
    },
    async (args) => {
      const { items, truncated } = await client.getAll<any>(
        "/api/credit-notes",
        {
          creationTimeFrom: toShoptetDate(args.date_from, false),
          creationTimeTo: toShoptetDate(args.date_to, true),
        },
        { limit: args.limit },
      );
      const notes = items.map(slimCreditNote);

      // Refund totals are negative in Shoptet's price.withVat. Flip for ergonomic
      // "refund value" numbers (positive = how much money went back to customers).
      const refundValue = (n: SlimCreditNote) => Math.abs(n.priceWithVat);

      const totals = {
        count: notes.length,
        total_refund_with_vat: round2(notes.reduce((s, n) => s + refundValue(n), 0)),
        total_refund_without_vat: round2(notes.reduce((s, n) => s + Math.abs(n.priceWithoutVat), 0)),
      };

      if (args.group_by === "none") {
        return asJsonContent({ ...totals, truncated, rows: [] });
      }

      const buckets = new Map<string, { count: number; value: number }>();
      for (const n of notes) {
        const key = n.creationTime ? bucketKey(n.creationTime, args.group_by) : "unknown";
        const b = buckets.get(key) ?? { count: 0, value: 0 };
        b.count++;
        b.value += refundValue(n);
        buckets.set(key, b);
      }
      const rows = [...buckets.entries()]
        .map(([bucket, b]) => ({ bucket, count: b.count, refund_value: round2(b.value) }))
        .sort((a, b) => a.bucket.localeCompare(b.bucket));

      return asJsonContent({ ...totals, group_by: args.group_by, truncated, rows });
    },
  );
}
