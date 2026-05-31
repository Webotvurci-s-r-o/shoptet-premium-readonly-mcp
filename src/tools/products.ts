import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ShoptetClient } from "../client.js";
import { asJsonContent, slimProduct } from "./shape.js";
import { toShoptetDate } from "../util.js";

export function registerProductTools(server: McpServer, client: ShoptetClient) {
  server.registerTool(
    "list_products",
    {
      title: "List products",
      description:
        "List products with filters (category, brand, visibility, type, supplier, availability). Returns slim records — code, price, stock and unit come from the first variant. For products with multiple variants only the first one is shown; call get_product for full variant data.",
      inputSchema: {
        category_guid: z.string().optional(),
        brand_code: z.string().optional(),
        brand_name: z.string().optional(),
        visibility: z.string().optional().describe("e.g. 'visible', 'hidden', 'loggedOnly'."),
        type: z.string().optional().describe("'product', 'service', 'bazar', …"),
        flag: z.string().optional(),
        availability_id: z.number().int().optional(),
        supplier_guid: z.string().optional(),
        creation_time_from: z.string().optional(),
        creation_time_to: z.string().optional(),
        change_time_from: z.string().optional(),
        change_time_to: z.string().optional(),
        limit: z.number().int().min(1).max(5000).default(500),
      },
    },
    async (args) => {
      const { items, truncated, pagesFetched } = await client.getAll<any>(
        "/api/products",
        {
          categoryGuid: args.category_guid,
          brandCode: args.brand_code,
          brandName: args.brand_name,
          visibility: args.visibility,
          type: args.type,
          flag: args.flag,
          availabilityId: args.availability_id,
          supplierGuid: args.supplier_guid,
          creationTimeFrom: toShoptetDate(args.creation_time_from, false),
          creationTimeTo: toShoptetDate(args.creation_time_to, true),
          changeTimeFrom: toShoptetDate(args.change_time_from, false),
          changeTimeTo: toShoptetDate(args.change_time_to, true),
        },
        { limit: args.limit },
      );
      return asJsonContent({
        count: items.length,
        truncated,
        pagesFetched,
        products: items.map(slimProduct),
      });
    },
  );

  server.registerTool(
    "get_product",
    {
      title: "Get product detail",
      description: "Fetch full detail for a product by code or GUID.",
      inputSchema: {
        identifier: z.string().describe("Product code or GUID."),
        by: z.enum(["code", "guid"]).default("code"),
      },
    },
    async ({ identifier, by }) => {
      const path =
        by === "guid"
          ? `/api/products/${encodeURIComponent(identifier)}`
          : `/api/products/code/${encodeURIComponent(identifier)}`;
      const res = await client.get(path);
      return asJsonContent(res.data);
    },
  );

  server.registerTool(
    "inventory_overview",
    {
      title: "Inventory / low-stock overview",
      description:
        "Scan products and list variants at or below a stock threshold. Iterates /api/products then fetches each product's detail to read variant stock — expensive on big catalogs, narrow by category/brand and tune max_products.",
      inputSchema: {
        low_stock_threshold: z.number().min(0).default(5),
        category_guid: z.string().optional(),
        brand_code: z.string().optional(),
        max_products: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .default(200)
          .describe("Cap on number of product detail calls. 200 ≈ 200 API requests."),
      },
    },
    async (args) => {
      const { items, truncated } = await client.getAll<any>(
        "/api/products",
        { categoryGuid: args.category_guid, brandCode: args.brand_code },
        { limit: args.max_products },
      );

      type LowVariant = {
        product_guid?: string;
        product_name?: string;
        variant_code?: string;
        ean?: string | null;
        stock: number;
        unit?: string;
        price?: number;
        currency?: string;
        category?: string;
        brand?: string;
      };
      const low: LowVariant[] = [];
      let scanned = 0;

      for (const p of items) {
        const guid = p?.guid;
        if (!guid) continue;
        try {
          const detail = await client.get<any>(`/api/products/${encodeURIComponent(guid)}`);
          const prod = detail.data?.data ?? {};
          const variants = Array.isArray(prod?.variants) ? prod.variants : [];
          for (const v of variants) {
            scanned++;
            const stock = typeof v?.stock === "string" ? parseFloat(v.stock) : Number(v?.stock);
            if (!Number.isFinite(stock)) continue;
            if (stock > args.low_stock_threshold) continue;
            low.push({
              product_guid: guid,
              product_name: prod?.name,
              variant_code: v?.code,
              ean: v?.ean,
              stock,
              unit: v?.unit,
              price: v?.price !== undefined ? Number(v.price) : undefined,
              currency: v?.currencyCode,
              category: prod?.defaultCategory?.name,
              brand: prod?.brand?.name,
            });
          }
        } catch {
          // skip unreadable product
        }
      }

      low.sort((a, b) => a.stock - b.stock);
      return asJsonContent({
        products_scanned: items.length,
        variants_scanned: scanned,
        threshold: args.low_stock_threshold,
        below_threshold: low.length,
        truncated_input: truncated,
        variants: low,
      });
    },
  );
}
