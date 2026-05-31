import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ShoptetClient } from "../client.js";
import { asJsonContent } from "./shape.js";

interface SlimArticle {
  id?: number;
  title?: string;
  url?: string;
  visible?: boolean;
  language?: string;
  sectionId?: number;
  sectionTitle?: string;
  publishTime?: string;
  creationTime?: string;
}

function slimArticle(raw: any): SlimArticle {
  return {
    id: raw?.id,
    title: raw?.title,
    url: raw?.url,
    visible: raw?.visible,
    language: raw?.language,
    sectionId: raw?.sectionId ?? raw?.section?.id,
    sectionTitle: raw?.sectionTitle ?? raw?.section?.title,
    publishTime: raw?.publishTime,
    creationTime: raw?.creationTime,
  };
}

interface SlimPage {
  id?: number;
  title?: string;
  url?: string;
  visible?: boolean;
  language?: string;
  ogImage?: string | null;
}

function slimPage(raw: any): SlimPage {
  return {
    id: raw?.id,
    title: raw?.title,
    url: raw?.url,
    visible: raw?.visible,
    language: raw?.language,
    ogImage: raw?.ogImage,
  };
}

export function registerContentTools(server: McpServer, client: ShoptetClient) {
  server.registerTool(
    "list_articles",
    {
      title: "List blog articles",
      description:
        "List blog articles (news / blog posts). Returns slim records — id, title, URL, section, visibility, timestamps. Call get_article for the HTML body.",
      inputSchema: {
        limit: z.number().int().min(1).max(2000).default(200),
      },
    },
    async ({ limit }) => {
      const { items, truncated, pagesFetched } = await client.getAll<any>("/api/articles", {}, { limit });
      return asJsonContent({
        count: items.length,
        truncated,
        pagesFetched,
        articles: items.map(slimArticle),
      });
    },
  );

  server.registerTool(
    "get_article",
    {
      title: "Get article detail",
      description: "Fetch full detail of a single article by ID, including the HTML content.",
      inputSchema: {
        article_id: z.number().int().describe("Article ID (integer)."),
      },
    },
    async ({ article_id }) => {
      const res = await client.get(`/api/articles/${article_id}`);
      return asJsonContent(res.data);
    },
  );

  server.registerTool(
    "list_article_sections",
    {
      title: "List article sections",
      description: "List article (blog) sections / categories. Useful for mapping section IDs to titles.",
    },
    async () => {
      const res = await client.get("/api/articles/sections");
      return asJsonContent(res.data);
    },
  );

  server.registerTool(
    "get_article_section",
    {
      title: "Get article section detail",
      description: "Fetch a single article section by ID.",
      inputSchema: {
        section_id: z.number().int(),
      },
    },
    async ({ section_id }) => {
      const res = await client.get(`/api/articles/sections/${section_id}`);
      return asJsonContent(res.data);
    },
  );

  server.registerTool(
    "list_pages",
    {
      title: "List static pages",
      description:
        "List static pages (landing pages, about-us, etc). Returns slim records — id, title, URL, visibility. Call get_page for the HTML content.",
      inputSchema: {
        limit: z.number().int().min(1).max(2000).default(500),
      },
    },
    async ({ limit }) => {
      const { items, truncated, pagesFetched } = await client.getAll<any>("/api/pages", {}, { limit });
      return asJsonContent({
        count: items.length,
        truncated,
        pagesFetched,
        pages: items.map(slimPage),
      });
    },
  );

  server.registerTool(
    "get_page",
    {
      title: "Get page detail",
      description: "Fetch full detail of a single static page by ID, including the HTML content.",
      inputSchema: {
        page_id: z.number().int(),
      },
    },
    async ({ page_id }) => {
      const res = await client.get(`/api/pages/${page_id}`);
      return asJsonContent(res.data);
    },
  );
}
