import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ShoptetClient } from "../client.js";
import { asJsonContent } from "./shape.js";
import { bucketKey, parseNumber, round2, toShoptetDate } from "../util.js";

interface SlimMovement {
  id?: number;
  productCode?: string;
  actualAmount: number;
  amountChange: number;
  direction: "in" | "out" | "zero";
  changeTime?: string;
  changedBy?: string;
}

function slimMovement(raw: any): SlimMovement {
  const change = parseNumber(raw?.amountChange);
  return {
    id: raw?.id,
    productCode: raw?.productCode,
    actualAmount: parseNumber(raw?.actualAmount),
    amountChange: change,
    direction: change > 0 ? "in" : change < 0 ? "out" : "zero",
    changeTime: raw?.changeTime,
    changedBy: raw?.changedBy,
  };
}

export function registerStockTools(server: McpServer, client: ShoptetClient) {
  server.registerTool(
    "list_stock_movements",
    {
      title: "List stock movements",
      description:
        "List individual stock movements (in/out) for a given warehouse. Use list_stocks to discover stock IDs. Each movement has product code, quantity delta, post-change actual amount, and timestamp.",
      inputSchema: {
        stock_id: z.number().int().default(1).describe("Stock (warehouse) ID. Default 1 (main stock)."),
        order_code: z.string().optional().describe("Filter to movements caused by a specific order."),
        change_time_from: z.string().optional(),
        limit: z.number().int().min(1).max(5000).default(500),
      },
    },
    async (args) => {
      const { items, truncated, pagesFetched } = await client.getAll<any>(
        `/api/stocks/${args.stock_id}/movements`,
        {
          orderCode: args.order_code,
          changeTimeFrom: toShoptetDate(args.change_time_from, false),
        },
        { limit: args.limit },
      );
      return asJsonContent({
        stock_id: args.stock_id,
        count: items.length,
        truncated,
        pagesFetched,
        movements: items.map(slimMovement),
      });
    },
  );

  server.registerTool(
    "stock_movements_summary",
    {
      title: "Aggregate stock movements",
      description:
        "Aggregate stock movements over time. Useful for inventory turnover analysis: how much went in vs out, top moving products, daily/weekly throughput.",
      inputSchema: {
        stock_id: z.number().int().default(1),
        change_time_from: z.string().optional(),
        group_by: z.enum(["day", "week", "month", "direction", "product"]).default("month"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20000)
          .default(5000)
          .describe("Max movements to scan. Wide ranges on busy warehouses need higher caps."),
      },
    },
    async (args) => {
      const { items, truncated } = await client.getAll<any>(
        `/api/stocks/${args.stock_id}/movements`,
        { changeTimeFrom: toShoptetDate(args.change_time_from, false) },
        { limit: args.limit },
      );
      const movements = items.map(slimMovement);

      type Bucket = { in_qty: number; out_qty: number; in_moves: number; out_moves: number };
      const buckets = new Map<string, Bucket>();
      for (const m of movements) {
        let key = "unknown";
        switch (args.group_by) {
          case "day":
          case "week":
          case "month":
            key = m.changeTime ? bucketKey(m.changeTime, args.group_by) : "unknown";
            break;
          case "direction":
            key = m.direction;
            break;
          case "product":
            key = m.productCode ?? "unknown";
            break;
        }
        const b = buckets.get(key) ?? { in_qty: 0, out_qty: 0, in_moves: 0, out_moves: 0 };
        if (m.amountChange >= 0) {
          b.in_qty += m.amountChange;
          b.in_moves++;
        } else {
          b.out_qty += -m.amountChange;
          b.out_moves++;
        }
        buckets.set(key, b);
      }

      const rows = [...buckets.entries()]
        .map(([key, b]) => ({
          bucket: key,
          in_qty: round2(b.in_qty),
          out_qty: round2(b.out_qty),
          net_qty: round2(b.in_qty - b.out_qty),
          in_moves: b.in_moves,
          out_moves: b.out_moves,
          total_moves: b.in_moves + b.out_moves,
        }))
        .sort((a, b) =>
          ["day", "week", "month"].includes(args.group_by)
            ? a.bucket.localeCompare(b.bucket)
            : b.total_moves - a.total_moves,
        );

      return asJsonContent({
        stock_id: args.stock_id,
        group_by: args.group_by,
        total_movements: movements.length,
        truncated,
        rows,
      });
    },
  );
}
