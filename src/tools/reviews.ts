import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ShoptetClient } from "../client.js";
import { asJsonContent } from "./shape.js";
import { round2, toShoptetDate } from "../util.js";

interface SlimReview {
  id?: number;
  guid?: string;
  date?: string;
  rating: number;
  description?: string | null;
  fullName?: string | null;
  email?: string | null;
  productGuid?: string;
  productName?: string;
  orderCode?: string | null;
  visible?: boolean;
  authorized?: boolean;
  hasReaction?: boolean;
  reactionText?: string | null;
}

function slimReview(raw: any): SlimReview {
  const r = raw?.reaction ?? {};
  return {
    id: raw?.id,
    guid: raw?.guid,
    date: raw?.date,
    rating: Number(raw?.rating ?? 0),
    description: raw?.description,
    fullName: raw?.fullName,
    email: raw?.email,
    productGuid: raw?.productGuid,
    productName: raw?.productName,
    orderCode: raw?.orderCode,
    visible: raw?.visible,
    authorized: raw?.authorized,
    hasReaction: Boolean(r?.reactionText),
    reactionText: r?.reactionText ?? null,
  };
}

export function registerReviewTools(server: McpServer, client: ShoptetClient) {
  server.registerTool(
    "list_product_reviews",
    {
      title: "List product reviews",
      description:
        "List product reviews with text and rating. Filterable by product GUID, order code, and date range. The LLM can read the returned `description` text to perform sentiment analysis client-side.",
      inputSchema: {
        product_guid: z.string().optional().describe("Filter to a single product."),
        order_code: z.string().optional(),
        date_from: z.string().optional().describe("YYYY-MM-DD or ISO 8601."),
        date_to: z.string().optional(),
        change_time_from: z.string().optional(),
        limit: z.number().int().min(1).max(5000).default(500),
      },
    },
    async (args) => {
      const { items, truncated, pagesFetched } = await client.getAll<any>(
        "/api/reviews/products",
        {
          productGuid: args.product_guid,
          orderCode: args.order_code,
          dateFrom: toShoptetDate(args.date_from, false),
          dateTo: toShoptetDate(args.date_to, true),
          changeTimeFrom: toShoptetDate(args.change_time_from, false),
        },
        { limit: args.limit },
      );
      const reviews = items.map(slimReview);
      return asJsonContent({
        count: reviews.length,
        truncated,
        pagesFetched,
        reviews,
      });
    },
  );

  server.registerTool(
    "reviews_summary",
    {
      title: "Aggregate product reviews",
      description:
        "Aggregate product reviews — count, average rating, and rating distribution (1–5). Optionally grouped by product. Useful as a first pass before drilling into individual review text for sentiment analysis.",
      inputSchema: {
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        product_guid: z.string().optional().describe("Restrict to one product."),
        group_by_product: z
          .boolean()
          .default(true)
          .describe("If true, return one row per product. If false, return one overall row."),
        limit: z.number().int().min(1).max(5000).default(2000),
      },
    },
    async (args) => {
      const { items, truncated } = await client.getAll<any>(
        "/api/reviews/products",
        {
          productGuid: args.product_guid,
          dateFrom: toShoptetDate(args.date_from, false),
          dateTo: toShoptetDate(args.date_to, true),
        },
        { limit: args.limit },
      );
      const reviews = items.map(slimReview);

      type Bucket = {
        key: string;
        productGuid?: string;
        productName?: string;
        count: number;
        sum: number;
        distribution: Record<1 | 2 | 3 | 4 | 5, number>;
        withText: number;
        reactedTo: number;
      };
      const buckets = new Map<string, Bucket>();
      const ALL = "__all__";

      for (const r of reviews) {
        const key = args.group_by_product ? r.productGuid ?? "unknown" : ALL;
        let b = buckets.get(key);
        if (!b) {
          b = {
            key,
            productGuid: args.group_by_product ? r.productGuid : undefined,
            productName: args.group_by_product ? r.productName : undefined,
            count: 0,
            sum: 0,
            distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
            withText: 0,
            reactedTo: 0,
          };
          buckets.set(key, b);
        }
        b.count++;
        b.sum += r.rating;
        if (r.rating >= 1 && r.rating <= 5) {
          b.distribution[r.rating as 1 | 2 | 3 | 4 | 5]++;
        }
        if (r.description && r.description.trim()) b.withText++;
        if (r.hasReaction) b.reactedTo++;
      }

      const rows = [...buckets.values()]
        .map((b) => ({
          product_guid: b.productGuid,
          product_name: b.productName,
          count: b.count,
          avg_rating: b.count ? round2(b.sum / b.count) : 0,
          distribution: b.distribution,
          positive: b.distribution[4] + b.distribution[5],
          neutral: b.distribution[3],
          negative: b.distribution[1] + b.distribution[2],
          with_text: b.withText,
          merchant_reacted: b.reactedTo,
        }))
        .sort((a, b) => b.count - a.count);

      return asJsonContent({
        total_reviews: reviews.length,
        truncated,
        group_by_product: args.group_by_product,
        rows,
      });
    },
  );
}
