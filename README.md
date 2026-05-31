# Shoptet Premium Read-Only MCP

Read-only MCP server for the **Shoptet Premium API**. Gives an LLM (Claude Desktop, Claude Code, any MCP client) analytics-oriented access to your e-shop data — orders, products, customers, invoices — without ever being able to write, delete, or trigger webhooks.

## What it does

- **Server-side aggregations** (`orders_summary`, `revenue_trend`, `top_products`, `top_customers`, `inventory_overview`) so the LLM doesn't have to paginate through thousands of rows just to compute a monthly total.
- **Slim list/detail tools** for orders, products, customers, invoices.
- **Code-list tools** (`list_order_statuses`, `list_payment_methods`, …) so the LLM can interpret IDs.
- **Escape hatch** `shoptet_raw_get` for any GET endpoint not covered by a specialized tool.
- **Hard read-only**: HTTP client refuses non-`GET` methods at runtime, and no mutating endpoints are wired up. The LLM cannot change anything in your shop — it can only suggest actions for you to take in the Shoptet admin.

Rate limits (HTTP 429, `Retry-After`) are handled automatically with exponential backoff.

## Installation

> Agents installing this for a user: follow [AGENTS.md](AGENTS.md) instead — it's the same steps but written deterministically so you can execute them without guessing.

### Prerequisites

| Requirement | Why |
|---|---|
| **Node.js ≥ 20** (`node --version`) | The server uses ESM + modern `undici`. Node 18 won't work. |
| **A Shoptet Premium e-shop** | The private token only works on Premium plans. |
| **macOS, Linux, or Windows (WSL)** | stdio MCP transport is cross-platform; Windows native should also work but is untested here. |
| **A MCP-aware client** | Claude Desktop, Claude Code, or any client that speaks the MCP stdio protocol. |

### Step 1 — Get a Shoptet Premium API token

1. Log in to your Shoptet admin (`https://<your-eshop-id>.myshoptet.com/admin`).
2. Navigate to **Propojení → Shoptet API** (English: **Connections → Shoptet API**).
3. Under **Private API access**, click **Generate token** (or copy an existing one).
4. The token looks like `123456-p-789012-abcdef1234567890abcdef`.

Keep this token secret — anyone who has it can read every record in your shop.

### Step 2 — Clone, install, build

```bash
git clone https://github.com/<you>/shoptet-premium-readonly-mcp.git
cd shoptet-premium-readonly-mcp
npm install
npm run build
```

This produces `dist/index.js` — that's the file MCP clients will execute.

### Step 3 — Verify the server boots

```bash
SHOPTET_PRIVATE_API_TOKEN="paste-your-token-here" node dist/index.js < /dev/null
```

You should see `[shoptet-mcp] ready on stdio` printed to stderr, then the process exits (because stdin closed). If you get `SHOPTET_PRIVATE_API_TOKEN env var is required`, the token wasn't picked up. If you get a `Cannot find module` error, run `npm install && npm run build` again.

### Step 4 — Run the end-to-end test against your shop (optional but recommended)

```bash
echo "SHOPTET_PRIVATE_API_TOKEN=paste-your-token-here" > .env.local
node scripts/e2e.mjs
```

Expected output: `Results: 27 pass / 0 fail`, followed by a sample `orders_summary` and `top_products` from your real data. If a tool fails here it'll also fail in Claude — fix it before wiring up the client.

`.env.local` is gitignored — it will not be committed.

### Step 5 — Hook it into your MCP client

#### Option A — Claude Desktop

Edit your config file:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Add the `shoptet` entry inside `mcpServers` (create the file or the key if it doesn't exist):

```json
{
  "mcpServers": {
    "shoptet": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/shoptet-premium-readonly-mcp/dist/index.js"],
      "env": {
        "SHOPTET_PRIVATE_API_TOKEN": "paste-your-token-here"
      }
    }
  }
}
```

Replace `/ABSOLUTE/PATH/TO/...` with the real absolute path. Get it by running `pwd` inside the project directory.

Restart Claude Desktop fully (`Cmd-Q` on macOS, then reopen — closing the window is not enough). Open a new chat — you should see "shoptet" listed under the tools/plug icon in the input area.

#### Option B — Claude Code (CLI)

From the project directory:

```bash
claude mcp add shoptet \
  -e SHOPTET_PRIVATE_API_TOKEN="paste-your-token-here" \
  -- node "$(pwd)/dist/index.js"
```

Verify:

```bash
claude mcp list
```

You should see `shoptet` listed. Then start `claude` in any directory — the tools will be available.

#### Option C — Any other MCP client

The server speaks the standard MCP JSON-RPC protocol over stdio. Run `node dist/index.js` with `SHOPTET_PRIVATE_API_TOKEN` in the environment and connect your client to it.

### Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `SHOPTET_PRIVATE_API_TOKEN env var is required` | The token isn't being passed to the process. Check your client config's `env` block, or your shell. |
| `Shoptet API 401` on every call | Token is invalid, expired, or copied with whitespace. Regenerate in the Shoptet admin. |
| `Shoptet API 403` on specific endpoints | Some endpoints require additional permissions in `Propojení → Shoptet API`. Tick the relevant scopes. |
| `Shoptet API 429` repeatedly | You're hitting rate limits. The server already backs off on `Retry-After`; reduce `max_orders` / `limit` in heavy tools (`top_products`, `inventory_overview`). |
| Server boots but Claude doesn't see it | You edited the wrong config file, used a relative path in `args`, or didn't fully restart Claude. Use an **absolute** path in `args`. |
| `Cannot find module '@modelcontextprotocol/sdk'` | Run `npm install` again. Don't ship the project without `node_modules` — or rebuild. |
| Old data showing up | The server has no cache. If Claude shows stale numbers, that's the LLM caching its own conclusions — start a fresh chat. |

## Tools

### Analytics (aggregated server-side)

| Tool | Purpose |
|---|---|
| `orders_summary` | Aggregate orders in a date range, grouped by day/week/month/year/status/source/payment/shipping/currency. |
| `revenue_trend` | Time series of revenue and order count at a given granularity. |
| `top_products` | Top-selling products by revenue or quantity in a date range. |
| `top_customers` | Top customers by total spend or order count. |
| `unpaid_orders` | List orders flagged unpaid (open receivables). |
| `inventory_overview` | **Variants** at or below a stock threshold. Walks products and reads variant stock from detail — cap with `max_products`. |
| `reviews_summary` | Per-product rating aggregates: count, avg, distribution 1–5★, positive/neutral/negative buckets, % with text, merchant-reaction rate. |

### Lists & details

| Tool | Purpose |
|---|---|
| `list_orders` / `get_order` | Filterable order list (date range, status, payment, source, customer, product) + single-order detail. |
| `list_products` / `get_product` | Filterable product list (category, brand, visibility, type, availability) + single-product detail. |
| `list_customers` / `get_customer` | Customer list (by email/phone) + single-customer detail. |
| `list_invoices` / `get_invoice` | Invoice list (date range, validity, order code, var symbol) + single-invoice detail. |
| `list_product_reviews` | Filterable list of product reviews (by product GUID, order code, date range). Includes review text for sentiment analysis. |

### Code lists

`list_order_statuses`, `list_order_sources`, `list_payment_methods`, `list_shipping_methods`, `list_categories`, `list_brands`, `list_suppliers`, `list_pricelists`, `list_stocks`, `list_sales_channels`, `list_customer_groups`, `eshop_info`, `list_endpoints`.

### Escape hatch

| Tool | Purpose |
|---|---|
| `shoptet_raw_get` | Raw GET to any `/api/...` path with a flat `query` object. Use only when no specialized tool fits. |

## Example questions you can ask Claude

- *"Jaký byl obrat za minulý týden po dnech?"*
- *"Vypiš top 20 produktů podle tržeb za poslední 3 měsíce."*
- *"Které objednávky jsou nezaplacené déle než měsíc a kolik je to celkem?"*
- *"Které produkty mají méně než 3 ks skladem v kategorii X?"*
- *"Kdo jsou moji top 10 zákazníci podle obratu za letošní rok?"*
- *"Porovnej tržby z 'Heuréka' vs 'Zboží.cz' vs e-shop za poslední měsíc."*

## End-to-end test

`scripts/e2e.mjs` spawns the built server, completes the MCP handshake, and calls every registered tool against the live shop. Run with the token in `.env.local`:

```bash
npm run build
node scripts/e2e.mjs
```

Reports `<n> pass / <n> fail` per tool and prints sample outputs from `orders_summary` and `top_products`.

## Configuration

| Env var | Required | Default | Notes |
|---|---|---|---|
| `SHOPTET_PRIVATE_API_TOKEN` | yes | — | Premium API token from Shoptet admin. |
| `SHOPTET_API_BASE_URL` | no | `https://api.myshoptet.com` | Override only for testing. |

## Safety guarantees

- The HTTP client only exposes a `get()` method. There is no public `post`/`put`/`patch`/`delete`. Any call that doesn't start with `/api/` is refused.
- No webhook subscription, modification, or delete endpoints are registered. The `shoptet_raw_get` escape hatch is also GET-only by construction.
- No data leaves your machine. The MCP server talks directly to `api.myshoptet.com` and returns results to the local Claude client over stdio.

## Limitations

- Shoptet does **not** offer aggregation endpoints, so analytics tools paginate orders client-side. Wide date ranges on large shops can be slow; narrow them or raise `limit`/`max_orders`. Defaults are tuned to be safe.
- `top_products` is the heaviest tool — it fetches each order's detail to read line items. Use narrow ranges or cap with `max_orders`.
- No local cache in this MVP. If your shop has many tens of thousands of orders and you query analytics frequently, a SQLite cache fed by `/api/orders/changes` is a natural next step.

## Development

```bash
npm run dev       # tsx, hot-ish iteration
npm run typecheck # tsc --noEmit
npm run build     # compile to dist/
```

Source layout:

```
src/
  index.ts          # stdio MCP server entry + tool registration
  client.ts         # read-only Shoptet HTTP client
  util.ts           # date bucketing, number parsing
  tools/
    shape.ts        # slim projections of orders/products/customers/invoices
    orders.ts       # list_orders, orders_summary, revenue_trend, top_products, top_customers, unpaid_orders, get_order
    products.ts     # list_products, get_product, inventory_overview
    customers.ts    # list_customers, get_customer
    invoices.ts     # list_invoices, get_invoice
    lookups.ts      # code lists + shoptet_raw_get escape hatch
```

## License

MIT.
