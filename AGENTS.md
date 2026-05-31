# AGENTS.md — instructions for AI coding agents

This file tells coding agents (Claude Code, Cursor, Aider, Codex, etc.) how to install, run, modify, and verify this MCP server. Follow it literally — every step is a deterministic command.

If you are a human reading this, the friendly version is [README.md](README.md).

---

## What this repo is

A **read-only** Model Context Protocol (MCP) server for the **Shoptet Premium** REST API (`https://api.myshoptet.com`). Exposes 44 tools that let an LLM analyse a Shoptet e-shop's orders, products, customers, invoices, reviews, stock movements, refunds, coupons, discussions, articles, and pages. Hard read-only — no write endpoints exist in the client code.

- Language: TypeScript, ESM, Node ≥ 20
- MCP transport: stdio
- Auth: single header token `Shoptet-Private-API-Token`
- Source of truth for API field names: probe the live API with `curl` (see "Common modifications" below). Never trust the OpenAPI spec summary alone — Shoptet's nested shapes differ from typical REST conventions.

## Repo layout

```
src/
  index.ts          stdio entry + tool registration
  client.ts         read-only Shoptet HTTP client (rate-limit + paginate)
  util.ts           date bucketing, number parsing
  tools/
    shape.ts        slim projections of orders/products/customers/invoices
    orders.ts       8 tools: list_orders, get_order, orders_summary,
                              revenue_trend, top_products, top_customers,
                              unpaid_orders, list_order_claims
    products.ts     3 tools: list_products, get_product, inventory_overview
    customers.ts    2 tools: list_customers, get_customer
    invoices.ts     2 tools: list_invoices, get_invoice
    reviews.ts      3 tools: list_product_reviews, reviews_summary,
                              list_project_reviews
    stocks.ts       2 tools: list_stock_movements, stock_movements_summary
    finance.ts      2 tools: list_credit_notes, refunds_summary
    marketing.ts    2 tools: list_discount_coupons, list_discussions
    content.ts      6 tools: list_articles, get_article,
                              list_article_sections, get_article_section,
                              list_pages, get_page
    lookups.ts     14 tools: 12 code-lists + eshop_info + shoptet_raw_get
scripts/
  e2e.mjs           spawn server, run full JSON-RPC handshake, call every tool
dist/               build output (gitignored)
.env.local          token storage (gitignored)
openapi.json        downloaded API spec (gitignored, optional)
```

## Install — agent procedure

The user gives you a Shoptet Premium API token. Token format: `<eshop-id>-p-<int>-<hex>`. Example: `123456-p-789012-abcdef1234567890abcdef`.

Execute **in this exact order**. Each step has a verification gate — do not proceed if a gate fails.

### Step 1 — verify Node version

```bash
node --version
```

**Gate:** must print `v20.*` or higher. If `v18.*` or lower, tell the user to upgrade Node and stop.

### Step 2 — install dependencies and build

```bash
cd <repo-root>
npm install
npm run build
```

**Gate:** `dist/index.js` must exist after `npm run build`. If `tsc` errors, fix the TS error before continuing — do not skip.

```bash
test -f dist/index.js && echo OK || echo MISSING
```

### Step 3 — write the token to `.env.local` (gitignored)

Never paste the token into `claude_desktop_config.json` example blocks in commit history. Write it only to `.env.local`:

```bash
echo "SHOPTET_PRIVATE_API_TOKEN=<the-token>" > .env.local
```

**Gate:** the file must be gitignored.

```bash
git check-ignore -v .env.local
```

Must print `.gitignore:<n>:.env.local`. If it doesn't, add `.env.local` to `.gitignore` first.

### Step 4 — smoke-test server boot

```bash
SHOPTET_PRIVATE_API_TOKEN="<the-token>" node dist/index.js < /dev/null
```

**Gate:** stderr must contain `[shoptet-mcp] ready on stdio`. If you get `SHOPTET_PRIVATE_API_TOKEN env var is required`, the env var isn't reaching the process — re-check the command.

### Step 5 — end-to-end test against the live shop

```bash
node scripts/e2e.mjs
```

This spawns the server, runs the full MCP JSON-RPC handshake, and calls every registered tool with sensible defaults.

**Gate:** the last summary line must read exactly `Results: 40 pass / 0 fail`. If any tool fails:

1. Read the failure message printed under `Failures:`.
2. Open the corresponding tool file under `src/tools/` and inspect the field paths.
3. Confirm the real response shape with a direct `curl`:
   ```bash
   TOKEN=$(grep SHOPTET_PRIVATE_API_TOKEN .env.local | cut -d= -f2)
   curl -s -H "Shoptet-Private-API-Token: $TOKEN" "https://api.myshoptet.com/api/<endpoint>" | python3 -m json.tool | head -80
   ```
4. Edit `src/tools/shape.ts` (slimmer) or the specific tool file, rebuild (`npm run build`), and re-run the e2e until it passes.

### Step 6 — register with the user's MCP client

Ask the user which client they use. Default: Claude Desktop on macOS.

**Claude Desktop (macOS):**

Path: `~/Library/Application Support/Claude/claude_desktop_config.json`

If the file doesn't exist, create it. If it exists, merge — do not overwrite. Add this `mcpServers.shoptet` entry:

```json
{
  "mcpServers": {
    "shoptet": {
      "command": "node",
      "args": ["<absolute-path-to-dist/index.js>"],
      "env": {
        "SHOPTET_PRIVATE_API_TOKEN": "<the-token>"
      }
    }
  }
}
```

Resolve `<absolute-path-to-dist/index.js>` by running `pwd` in the repo root and appending `/dist/index.js`. Use the absolute path; relative paths break.

**Claude Code (CLI):**

```bash
claude mcp add shoptet -e SHOPTET_PRIVATE_API_TOKEN="<the-token>" -- node "$(pwd)/dist/index.js"
claude mcp list   # verify "shoptet" appears
```

Then tell the user to fully restart Claude Desktop (quit and reopen — closing the window is insufficient), or to start a new `claude` session.

### Step 7 — final report to the user

Summarise to the user:

- Whether all 27 e2e tests passed.
- The absolute path to `dist/index.js`.
- Where the token was written (`.env.local`, gitignored) and where it was injected (the client config).
- A reminder that the server is read-only — Claude cannot change anything in the shop.
- One or two concrete demo questions matching the user's shop size.

## Common modifications

If the user asks you to add a new tool or fix a broken one:

1. Find the actual API response shape by curl-ing the endpoint with the token, or run `scripts/discover.mjs`. **Never** guess field names from the OpenAPI summary — Shoptet's nested shapes (e.g. `status: {id, name}` not `statusId: int`) differ from typical REST conventions.
2. If it's a list endpoint, the envelope is `{ data: { <plural-name>: [...], paginator: {...} }, errors, metadata }`. The first array under `data` is what `ShoptetClient.getAll()` picks up automatically.
3. If it's a detail endpoint, the shape varies — order detail is wrapped in `data.order`, product detail is flat in `data`. Check with `curl` first.
4. For slim projections, edit `src/tools/shape.ts`. Keep slimmers tight — undefined fields are dropped by `JSON.stringify`, so just omit them.
5. After editing, run `npm run build && node scripts/e2e.mjs` to confirm nothing regressed.

## Things to never do

- **Never add a write tool.** No POST/PUT/PATCH/DELETE endpoints. The user trusts the read-only guarantee — `src/client.ts` only exposes `get()`, and that's intentional. If the user asks for a write tool, refuse and explain that this server is read-only by design.
- **Never commit `.env.local` or any token.** `.gitignore` covers `.env.local`, `openapi.json`, `dist/`, `node_modules/`. Verify with `git status` before any commit.
- **Never paste the real token into README or example configs.** Use `<paste-your-token-here>` or `your-token` placeholders.
- **Never amend a commit you didn't make.** If the user already committed this work, create a new commit.
- **Never invent fields** when slimming. If a field isn't in the actual response, don't reference it — the LLM will hallucinate around it.

## Useful one-liners

```bash
# Type-check without building
npm run typecheck

# Watch the e2e output
node scripts/e2e.mjs | tee /tmp/e2e.log

# Quick GET against the API with the local token
TOKEN=$(grep SHOPTET_PRIVATE_API_TOKEN .env.local | cut -d= -f2)
curl -s -H "Shoptet-Private-API-Token: $TOKEN" "https://api.myshoptet.com/api/eshop" | head -c 500
```

## Versioning

`package.json` version reflects breaking changes to the tool interface (tool name renames, removed arguments). Bump:

- patch: bug fixes, new slim fields
- minor: new tools, new optional arguments
- major: tool rename, removed tool, removed argument, changed argument semantics
