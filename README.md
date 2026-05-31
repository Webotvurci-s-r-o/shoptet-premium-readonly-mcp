# Shoptet Premium Read-Only MCP

Read-only MCP server for the **Shoptet Premium API**. Gives an LLM (Claude Desktop, Claude Code, any MCP client) analytics-oriented access to your e-shop data — orders, products, customers, invoices — without ever being able to write, delete, or trigger webhooks.

## What it does

- **Server-side aggregations** (`orders_summary`, `revenue_trend`, `top_products`, `top_customers`, `inventory_overview`) so the LLM doesn't have to paginate through thousands of rows just to compute a monthly total.
- **Slim list/detail tools** for orders, products, customers, invoices.
- **Code-list tools** (`list_order_statuses`, `list_payment_methods`, …) so the LLM can interpret IDs.
- **Escape hatch** `shoptet_raw_get` for any GET endpoint not covered by a specialized tool.
- **Hard read-only**: HTTP client refuses non-`GET` methods at runtime, and no mutating endpoints are wired up. The LLM cannot change anything in your shop — it can only suggest actions for you to take in the Shoptet admin.

Rate limits (HTTP 429, `Retry-After`) are handled automatically with exponential backoff.

## Setup

### 1. Get a Shoptet Premium API token

In Shoptet admin: **Propojení → Shoptet API → Private API token**. Copy the token.

### 2. Install & build

```bash
git clone <this-repo>
cd shoptet-premium-readonly-mcp
npm install
npm run build
```

### 3. Hook it into Claude Desktop / Claude Code

**Claude Desktop** — edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "shoptet": {
      "command": "node",
      "args": ["/absolute/path/to/shoptet-premium-readonly-mcp/dist/index.js"],
      "env": {
        "SHOPTET_PRIVATE_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

Restart Claude Desktop.

**Claude Code** — `claude mcp add shoptet -e SHOPTET_PRIVATE_API_TOKEN=your-token -- node /absolute/path/to/dist/index.js`

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

### Lists & details

| Tool | Purpose |
|---|---|
| `list_orders` / `get_order` | Filterable order list (date range, status, payment, source, customer, product) + single-order detail. |
| `list_products` / `get_product` | Filterable product list (category, brand, visibility, type, availability) + single-product detail. |
| `list_customers` / `get_customer` | Customer list (by email/phone) + single-customer detail. |
| `list_invoices` / `get_invoice` | Invoice list (date range, validity, order code, var symbol) + single-invoice detail. |

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
