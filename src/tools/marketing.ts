import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ShoptetClient } from "../client.js";
import { asJsonContent } from "./shape.js";
import { parseNumber, toShoptetDate } from "../util.js";

interface SlimCoupon {
  code: string;
  discountType?: string;
  amount?: number;
  ratio?: number | null;
  currency?: string;
  reusable?: boolean;
  usedCount?: number;
  validFrom?: string | null;
  validTo?: string | null;
  creationTime?: string;
  remark?: string;
  template?: string;
  shippingPrice?: string;
}

function slimCoupon(raw: any): SlimCoupon {
  return {
    code: raw?.code,
    discountType: raw?.discountType,
    amount: parseNumber(raw?.amount),
    ratio: raw?.ratio !== null && raw?.ratio !== undefined ? parseNumber(raw?.ratio) : null,
    currency: raw?.currency,
    reusable: raw?.reusable,
    usedCount: raw?.usedCount,
    validFrom: raw?.validFrom,
    validTo: raw?.validTo,
    creationTime: raw?.creationTime,
    remark: raw?.remark,
    template: raw?.template,
    shippingPrice: raw?.shippingPrice,
  };
}

interface SlimDiscussion {
  id?: number;
  parentId?: number | null;
  productGuid?: string | null;
  articleId?: number | null;
  pageId?: number | null;
  customerGuid?: string | null;
  name?: string;
  email?: string;
  title?: string;
  content?: string;
  creationDate?: string;
  authorized?: boolean;
}

function slimDiscussion(raw: any): SlimDiscussion {
  return {
    id: raw?.id,
    parentId: raw?.parentId,
    productGuid: raw?.productGuid,
    articleId: raw?.articleId,
    pageId: raw?.pageId,
    customerGuid: raw?.customerGuid,
    name: raw?.name,
    email: raw?.email,
    title: raw?.title,
    content: raw?.content,
    creationDate: raw?.creationDate,
    authorized: raw?.authorized,
  };
}

export function registerMarketingTools(server: McpServer, client: ShoptetClient) {
  server.registerTool(
    "list_discount_coupons",
    {
      title: "List discount coupons",
      description:
        "List configured discount coupons with their type (fixed / ratio), value, validity window, and usage count. `usedCount` lets you measure campaign uptake.",
      inputSchema: {
        creation_time_from: z.string().optional(),
        creation_time_to: z.string().optional(),
        valid_from: z.string().optional(),
        valid_to: z.string().optional(),
        reusable: z.boolean().optional(),
        template: z.string().optional().describe("Filter to coupons from a specific template GUID."),
        limit: z.number().int().min(1).max(5000).default(1000),
      },
    },
    async (args) => {
      const { items, truncated, pagesFetched } = await client.getAll<any>(
        "/api/discount-coupons",
        {
          creationTimeFrom: toShoptetDate(args.creation_time_from, false),
          creationTimeTo: toShoptetDate(args.creation_time_to, true),
          validFrom: toShoptetDate(args.valid_from, false),
          validTo: toShoptetDate(args.valid_to, true),
          reusable: args.reusable,
          template: args.template,
        },
        { limit: args.limit },
      );
      const slim = items.map(slimCoupon);
      return asJsonContent({
        count: slim.length,
        truncated,
        pagesFetched,
        total_used: slim.reduce((s, c) => s + (c.usedCount ?? 0), 0),
        coupons: slim,
      });
    },
  );

  server.registerTool(
    "list_discussions",
    {
      title: "List discussion posts (product Q&A)",
      description:
        "List discussion posts attached to products, articles, or pages. Each post has a title, body, author, and product reference. Useful for sentiment analysis and pre-sale question detection alongside reviews.",
      inputSchema: {
        product_guid: z.string().optional(),
        customer_guid: z.string().optional(),
        user_email: z.string().optional(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        limit: z.number().int().min(1).max(5000).default(500),
      },
    },
    async (args) => {
      const { items, truncated, pagesFetched } = await client.getAll<any>(
        "/api/discussions-posts",
        {
          productGuid: args.product_guid,
          customerGuid: args.customer_guid,
          userEmail: args.user_email,
          creationDateFrom: toShoptetDate(args.date_from, false),
          creationDateTo: toShoptetDate(args.date_to, true),
        },
        { limit: args.limit },
      );
      return asJsonContent({
        count: items.length,
        truncated,
        pagesFetched,
        posts: items.map(slimDiscussion),
      });
    },
  );
}

