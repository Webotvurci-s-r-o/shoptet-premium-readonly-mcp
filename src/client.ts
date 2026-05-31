import { request } from "undici";

const BASE_URL = "https://api.myshoptet.com";

export interface ShoptetClientOptions {
  token: string;
  baseUrl?: string;
  userAgent?: string;
  maxPages?: number;
  perPage?: number;
}

export interface ShoptetResponse<T = unknown> {
  data: T;
  status: number;
  headers: Record<string, string | string[] | undefined>;
}

export class ShoptetApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: unknown,
  ) {
    super(`Shoptet API ${status} on ${path}: ${truncate(JSON.stringify(body), 400)}`);
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/**
 * Read-only Shoptet Premium API client. Enforces GET-only at the type level
 * and at runtime — there is intentionally no method to issue mutating requests.
 */
export class ShoptetClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly maxPages: number;
  private readonly defaultPerPage: number;

  constructor(opts: ShoptetClientOptions) {
    if (!opts.token) {
      throw new Error("Shoptet token is required (SHOPTET_PRIVATE_API_TOKEN).");
    }
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? BASE_URL).replace(/\/$/, "");
    this.userAgent = opts.userAgent ?? "shoptet-premium-readonly-mcp/0.1.0";
    this.maxPages = opts.maxPages ?? 100;
    this.defaultPerPage = opts.perPage ?? 100;
  }

  /** Single GET. Returns parsed JSON or throws ShoptetApiError. */
  async get<T = any>(
    path: string,
    query: Record<string, string | number | boolean | undefined | null> = {},
  ): Promise<ShoptetResponse<T>> {
    if (!path.startsWith("/api/")) {
      throw new Error(`Refusing request to non-/api path: ${path}`);
    }

    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }

    const res = await this.fetchWithRetry(url.toString());
    const text = await res.body.text();
    let body: unknown = text;
    const ct = res.headers["content-type"];
    const ctStr = Array.isArray(ct) ? ct[0] : ct;
    if (ctStr && ctStr.includes("application/json") && text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        // leave as text
      }
    }

    if (res.statusCode >= 400) {
      throw new ShoptetApiError(res.statusCode, path, body);
    }

    return {
      data: body as T,
      status: res.statusCode,
      headers: res.headers as Record<string, string | string[] | undefined>,
    };
  }

  /**
   * Iterate a paginated list endpoint until exhausted or until `limit` records collected.
   * Shoptet wraps lists as { data: { <key>: [...], paginator: { ... } } }.
   *
   * @param path API path (e.g. "/api/orders")
   * @param query Query params (page/itemsPerPage will be managed automatically).
   * @param opts.limit Hard cap on records returned. Defaults to 5000.
   * @param opts.dataKey Optional explicit key; if omitted, the first array value in data is used.
   */
  async getAll<T = any>(
    path: string,
    query: Record<string, string | number | boolean | undefined | null> = {},
    opts: { limit?: number; dataKey?: string } = {},
  ): Promise<{ items: T[]; pagesFetched: number; truncated: boolean }> {
    const limit = opts.limit ?? 5000;
    const perPage = Math.min(Number(query.itemsPerPage ?? this.defaultPerPage), 1000);
    const collected: T[] = [];
    let page = 1;
    let pagesFetched = 0;
    let truncated = false;

    while (collected.length < limit && page <= this.maxPages) {
      const res = await this.get<any>(path, { ...query, page, itemsPerPage: perPage });
      pagesFetched++;

      const dataNode = (res.data && (res.data as any).data) ?? res.data;
      let items: T[] | undefined;
      if (opts.dataKey && dataNode && Array.isArray(dataNode[opts.dataKey])) {
        items = dataNode[opts.dataKey];
      } else if (dataNode && typeof dataNode === "object") {
        for (const v of Object.values(dataNode)) {
          if (Array.isArray(v)) {
            items = v as T[];
            break;
          }
        }
      }

      if (!items || items.length === 0) break;

      const remaining = limit - collected.length;
      if (items.length > remaining) {
        collected.push(...items.slice(0, remaining));
        truncated = true;
        break;
      }
      collected.push(...items);

      const paginator = dataNode?.paginator ?? (res.data as any)?.data?.paginator;
      const pageCount = paginator?.pageCount ?? paginator?.totalPages;
      if (pageCount && page >= pageCount) break;
      // Servers may cap itemsPerPage below what we requested. Trust the
      // server's reported page size, not our request, when deciding to stop.
      const serverPerPage = Number(paginator?.itemsPerPage ?? paginator?.itemsOnPage ?? perPage);
      if (!pageCount && items.length < serverPerPage) break;

      page++;
    }

    if (page > this.maxPages && collected.length < limit) {
      truncated = true;
    }

    return { items: collected, pagesFetched, truncated };
  }

  private async fetchWithRetry(url: string, attempt = 0): Promise<Awaited<ReturnType<typeof request>>> {
    const res = await request(url, {
      method: "GET",
      headers: {
        "Shoptet-Private-API-Token": this.token,
        "User-Agent": this.userAgent,
        Accept: "application/json",
      },
    });

    if (res.statusCode === 429 && attempt < 3) {
      const retryAfter = res.headers["retry-after"];
      const waitMs = parseRetryAfter(retryAfter) ?? 1000 * Math.pow(2, attempt);
      // consume body before retry
      await res.body.dump();
      await sleep(Math.min(waitMs, 30_000));
      return this.fetchWithRetry(url, attempt + 1);
    }

    if (res.statusCode >= 500 && res.statusCode < 600 && attempt < 2) {
      await res.body.dump();
      await sleep(500 * (attempt + 1));
      return this.fetchWithRetry(url, attempt + 1);
    }

    return res;
  }
}

function parseRetryAfter(value: string | string[] | undefined): number | null {
  if (!value) return null;
  const v = Array.isArray(value) ? value[0] : value;
  const asInt = Number(v);
  if (!Number.isNaN(asInt)) return asInt * 1000;
  const asDate = Date.parse(v);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
