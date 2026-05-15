import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ShoptetClient } from "../client.js";
import { asJsonContent, slimOrder, type SlimOrder } from "./shape.js";
import { bucketKey, round2, toShoptetDate, topN } from "../util.js";

const dateField = z
  .string()
  .describe("ISO date (YYYY-MM-DD) or ISO 8601 timestamp. Inclusive on `from`, end-of-day on `to`.")
  .optional();

const orderListFilters = {
  date_from: dateField,
  date_to: dateField,
  status_id: z.number().int().optional().describe("Order status ID — see list_order_statuses."),
  payment_method_guid: z.string().optional(),
  shipping_company_code: z.string().optional(),
  source_id: z.number().int().optional().describe("Order source ID — see list_order_sources."),
  customer_guid: z.string().optional(),
  email: z.string().optional(),
  product_code: z.string().optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(5000)
    .optional()
    .describe("Max orders to fetch (default 1000). Server paginates automatically."),
};

function buildOrderQuery(args: {
  date_from?: string;
  date_to?: string;
  status_id?: number;
  payment_method_guid?: string;
  shipping_company_code?: string;
  source_id?: number;
  customer_guid?: string;
  email?: string;
  product_code?: string;
}): Record<string, string | number | undefined> {
  return {
    creationTimeFrom: toShoptetDate(args.date_from, false),
    creationTimeTo: toShoptetDate(args.date_to, true),
    statusId: args.status_id,
    paymentMethodGuid: args.payment_method_guid,
    shippingCompanyCode: args.shipping_company_code,
    sourceId: args.source_id,
    customerGuid: args.customer_guid,
    email: args.email,
    productCode: args.product_code,
  };
}

export function registerOrderTools(server: McpServer, client: ShoptetClient) {
  server.registerTool(
    "list_orders",
    {
      title: "List orders",
      description:
        "List orders with filters (date range, status, payment, source, customer, product). Returns slim records (code, totals, status, customer email). Use orders_summary for aggregates.",
      inputSchema: orderListFilters,
    },
    async (args) => {
      const limit = args.limit ?? 1000;
      const query = buildOrderQuery(args);
      const { items, pagesFetched, truncated } = await client.getAll<any>("/api/orders", query, { limit });
      const slim = items.map(slimOrder);
      return asJsonContent({
        count: slim.length,
        truncated,
        pagesFetched,
        orders: slim,
      });
    },
  );

  server.registerTool(
    "get_order",
    {
      title: "Get order detail",
      description: "Fetch full detail of a single order (including line items if available).",
      inputSchema: {
        code: z.string().describe("Order code, e.g. '20240001'."),
      },
    },
    async ({ code }) => {
      const res = await client.get(`/api/orders/${encodeURIComponent(code)}`);
      return asJsonContent(res.data);
    },
  );

  server.registerTool(
    "orders_summary",
    {
      title: "Aggregate orders by dimension",
      description:
        "Aggregate orders in a date range, grouped by one dimension. Returns count, gross revenue, net revenue, and avg order value per bucket. Use this instead of pulling raw lists for analytics.",
      inputSchema: {
        date_from: dateField,
        date_to: dateField,
        group_by: z
          .enum(["day", "week", "month", "year", "status", "source", "payment", "shipping", "currency"])
          .describe("Dimension to group by."),
        status_id: z.number().int().optional(),
        limit: z.number().int().min(1).max(5000).optional(),
      },
    },
    async (args) => {
      const limit = args.limit ?? 5000;
      const query = buildOrderQuery({ ...args });
      const { items, truncated } = await client.getAll<any>("/api/orders", query, { limit });
      const orders = items.map(slimOrder);

      const buckets = new Map<
        string,
        { count: number; revenue: number; net: number; currency?: string }
      >();

      for (const o of orders) {
        let key = "unknown";
        switch (args.group_by) {
          case "day":
          case "week":
          case "month":
          case "year":
            key = o.creationTime ? bucketKey(o.creationTime, args.group_by) : "unknown";
            break;
          case "status":
            key = o.status ?? `status_${o.statusId ?? "?"}`;
            break;
          case "source":
            key = o.source ?? "unknown";
            break;
          case "payment":
            key = o.paymentMethod ?? "unknown";
            break;
          case "shipping":
            key = o.shippingMethod ?? "unknown";
            break;
          case "currency":
            key = o.currency ?? "unknown";
            break;
        }
        const b = buckets.get(key) ?? { count: 0, revenue: 0, net: 0, currency: o.currency };
        b.count++;
        b.revenue += o.priceWithVat;
        b.net += o.priceWithoutVat;
        if (!b.currency && o.currency) b.currency = o.currency;
        buckets.set(key, b);
      }

      const rows = [...buckets.entries()]
        .map(([k, v]) => ({
          bucket: k,
          orders: v.count,
          revenue_with_vat: round2(v.revenue),
          revenue_without_vat: round2(v.net),
          avg_order_value: v.count ? round2(v.revenue / v.count) : 0,
          currency: v.currency,
        }))
        .sort((a, b) =>
          ["day", "week", "month", "year"].includes(args.group_by)
            ? a.bucket.localeCompare(b.bucket)
            : b.revenue_with_vat - a.revenue_with_vat,
        );

      return asJsonContent({
        group_by: args.group_by,
        total_orders: orders.length,
        truncated,
        rows,
      });
    },
  );

  server.registerTool(
    "revenue_trend",
    {
      title: "Revenue time series",
      description: "Time series of order revenue and count for a date range at given granularity.",
      inputSchema: {
        date_from: dateField,
        date_to: dateField,
        granularity: z.enum(["day", "week", "month", "year"]).default("day"),
        status_id: z.number().int().optional(),
        limit: z.number().int().min(1).max(5000).optional(),
      },
    },
    async (args) => {
      const limit = args.limit ?? 5000;
      const query = buildOrderQuery(args);
      const { items, truncated } = await client.getAll<any>("/api/orders", query, { limit });
      const orders = items.map(slimOrder);
      const buckets = new Map<string, { count: number; revenue: number }>();
      for (const o of orders) {
        const k = o.creationTime ? bucketKey(o.creationTime, args.granularity) : "unknown";
        const b = buckets.get(k) ?? { count: 0, revenue: 0 };
        b.count++;
        b.revenue += o.priceWithVat;
        buckets.set(k, b);
      }
      const series = [...buckets.entries()]
        .map(([bucket, v]) => ({
          bucket,
          orders: v.count,
          revenue: round2(v.revenue),
        }))
        .sort((a, b) => a.bucket.localeCompare(b.bucket));

      return asJsonContent({
        granularity: args.granularity,
        total_orders: orders.length,
        total_revenue: round2(orders.reduce((s, o) => s + o.priceWithVat, 0)),
        truncated,
        series,
      });
    },
  );

  server.registerTool(
    "top_products",
    {
      title: "Top products by sales",
      description:
        "Top-selling products in a date range. Iterates orders and aggregates line items. Note: this fetches each order's detail to read its items, so keep date ranges narrow for big shops.",
      inputSchema: {
        date_from: dateField,
        date_to: dateField,
        limit: z.number().int().min(1).max(100).default(20),
        by: z.enum(["revenue", "quantity"]).default("revenue"),
        max_orders: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .default(500)
          .describe("Cap on orders scanned. Wider date range needs higher cap (and is slower)."),
      },
    },
    async (args) => {
      const query = buildOrderQuery(args);
      const { items: orderList, truncated } = await client.getAll<any>("/api/orders", query, {
        limit: args.max_orders,
      });

      type Agg = { code: string; name?: string; qty: number; revenue: number };
      const agg = new Map<string, Agg>();

      for (const o of orderList) {
        const code = o.code;
        if (!code) continue;
        try {
          const detail = await client.get<any>(`/api/orders/${encodeURIComponent(code)}`);
          const order = detail.data?.data?.order ?? detail.data?.data ?? detail.data;
          const items = order?.items ?? order?.orderItems ?? [];
          for (const it of items) {
            const itemCode = it?.code ?? it?.itemCode ?? it?.productCode ?? "unknown";
            const name = it?.name ?? it?.itemName ?? it?.productName;
            const qty = Number(it?.amount ?? it?.quantity ?? 0);
            const lineRevenue = Number(
              it?.itemPrice?.toPay ?? it?.itemPrice?.priceWithVat ?? it?.priceWithVat ?? it?.totalPrice ?? 0,
            );
            const cur = agg.get(itemCode) ?? { code: itemCode, name, qty: 0, revenue: 0 };
            cur.qty += qty;
            cur.revenue += lineRevenue;
            if (!cur.name && name) cur.name = name;
            agg.set(itemCode, cur);
          }
        } catch {
          // skip unreadable order
        }
      }

      const ranked = topN(
        [...agg.values()],
        args.limit,
        args.by === "quantity" ? (a) => a.qty : (a) => a.revenue,
      ).map((r) => ({ ...r, revenue: round2(r.revenue) }));

      return asJsonContent({
        ranked_by: args.by,
        orders_scanned: orderList.length,
        truncated_orders: truncated,
        products: ranked,
      });
    },
  );

  server.registerTool(
    "top_customers",
    {
      title: "Top customers by spend",
      description: "Top customers ranked by total revenue or order count over a date range.",
      inputSchema: {
        date_from: dateField,
        date_to: dateField,
        limit: z.number().int().min(1).max(200).default(20),
        by: z.enum(["revenue", "order_count"]).default("revenue"),
        max_orders: z.number().int().min(1).max(5000).default(2000),
      },
    },
    async (args) => {
      const query = buildOrderQuery(args);
      const { items, truncated } = await client.getAll<any>("/api/orders", query, { limit: args.max_orders });
      const orders = items.map(slimOrder);
      type Agg = { key: string; email?: string; orders: number; revenue: number };
      const agg = new Map<string, Agg>();
      for (const o of orders) {
        const key = o.customerGuid ?? o.email ?? "unknown";
        const cur = agg.get(key) ?? { key, email: o.email, orders: 0, revenue: 0 };
        cur.orders++;
        cur.revenue += o.priceWithVat;
        agg.set(key, cur);
      }
      const ranked = topN(
        [...agg.values()],
        args.limit,
        args.by === "revenue" ? (a) => a.revenue : (a) => a.orders,
      ).map((r) => ({ ...r, revenue: round2(r.revenue) }));
      return asJsonContent({
        ranked_by: args.by,
        orders_scanned: orders.length,
        truncated,
        customers: ranked,
      });
    },
  );

  server.registerTool(
    "unpaid_orders",
    {
      title: "List unpaid orders",
      description: "List orders flagged as unpaid (open receivables) in an optional date range.",
      inputSchema: {
        date_from: dateField,
        date_to: dateField,
        limit: z.number().int().min(1).max(2000).default(500),
      },
    },
    async (args) => {
      const query = buildOrderQuery({ ...args });
      const { items, truncated } = await client.getAll<any>("/api/orders", query, { limit: args.limit });
      const slim: SlimOrder[] = items.map(slimOrder).filter((o) => o.paid === false);
      return asJsonContent({
        count: slim.length,
        truncated_input: truncated,
        total_outstanding: round2(slim.reduce((s, o) => s + o.priceWithVat, 0)),
        orders: slim,
      });
    },
  );
}
