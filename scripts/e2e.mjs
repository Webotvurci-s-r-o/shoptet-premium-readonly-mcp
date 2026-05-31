/**
 * End-to-end test: spawn the built MCP server, complete the JSON-RPC
 * initialize handshake, list tools, then call each tool with sensible
 * defaults and report pass/fail.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";

// Load .env.local
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const server = spawn("node", ["dist/index.js"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

let buf = "";
const pending = new Map(); // id -> { resolve, reject }
let nextId = 1;

server.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    } catch (e) {
      console.error("parse fail:", line.slice(0, 200));
    }
  }
});

function call(method, params) {
  const id = nextId++;
  const req = { jsonrpc: "2.0", id, method, params };
  server.stdin.write(JSON.stringify(req) + "\n");
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 60_000);
  });
}

function notify(method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

async function main() {
  await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e-test", version: "0.0.1" },
  });
  notify("notifications/initialized", {});

  const { tools } = await call("tools/list", {});
  console.log(`Discovered ${tools.length} tools.`);

  // Test plan: tool name -> args
  // Bounded args to keep runs fast.
  const today = "2026-05-31";
  const wkAgo = "2026-05-24";
  const mthAgo = "2026-05-01";
  const yrStart = "2026-01-01";

  const plan = [
    ["eshop_info", {}],
    ["list_endpoints", {}],
    ["list_order_statuses", {}],
    ["list_order_sources", {}],
    ["list_payment_methods", {}],
    ["list_shipping_methods", {}],
    ["list_categories", {}],
    ["list_brands", {}],
    ["list_suppliers", {}],
    ["list_pricelists", {}],
    ["list_stocks", {}],
    ["list_sales_channels", {}],
    ["list_customer_groups", {}],
    ["list_orders", { date_from: yrStart, date_to: today, limit: 20 }],
    ["orders_summary", { date_from: yrStart, date_to: today, group_by: "month" }],
    ["orders_summary", { date_from: yrStart, date_to: today, group_by: "status" }],
    ["orders_summary", { date_from: yrStart, date_to: today, group_by: "source" }],
    ["orders_summary", { date_from: yrStart, date_to: today, group_by: "payment" }],
    ["revenue_trend", { date_from: mthAgo, date_to: today, granularity: "day" }],
    ["unpaid_orders", { date_from: yrStart, date_to: today, limit: 50 }],
    ["top_customers", { date_from: yrStart, date_to: today, by: "revenue", limit: 10, max_orders: 200 }],
    ["top_products", { date_from: yrStart, date_to: today, limit: 10, max_orders: 50 }],
    ["list_products", { limit: 5 }],
    ["inventory_overview", { low_stock_threshold: 2, max_products: 100 }],
    ["list_customers", { limit: 5 }],
    ["list_invoices", { date_from: yrStart, date_to: today, limit: 20 }],
    ["list_product_reviews", { limit: 100 }],
    ["reviews_summary", { group_by_product: true, limit: 1000 }],
    ["list_project_reviews", { limit: 100 }],
    ["list_stock_movements", { stock_id: 1, limit: 50 }],
    ["stock_movements_summary", { stock_id: 1, group_by: "month", limit: 2000 }],
    ["list_credit_notes", { date_from: yrStart, date_to: today, limit: 50 }],
    ["refunds_summary", { date_from: yrStart, date_to: today, group_by: "month" }],
    ["list_order_claims", { include_closed_and_cancelled: true, limit: 50 }],
    ["list_discount_coupons", { limit: 50 }],
    ["list_discussions", { limit: 50 }],
    ["list_articles", { limit: 50 }],
    ["list_article_sections", {}],
    ["list_pages", { limit: 50 }],
    ["shoptet_raw_get", { path: "/api/eshop/customer-fields" }],
  ];

  let pass = 0, fail = 0;
  const failures = [];
  for (const [name, args] of plan) {
    process.stdout.write(`- ${name.padEnd(28)} `);
    try {
      const res = await call("tools/call", { name, arguments: args });
      if (res.isError) throw new Error("isError=true: " + JSON.stringify(res.content).slice(0, 200));
      const text = (res.content?.[0]?.text ?? "").toString();
      let summary = text.length > 0 ? `${text.length}B` : "empty";
      try {
        const obj = JSON.parse(text);
        if (Array.isArray(obj)) summary = `array len=${obj.length}`;
        else if (obj && typeof obj === "object") {
          const keys = Object.keys(obj).slice(0, 4).join(",");
          summary = `{${keys}} ${text.length}B`;
        }
      } catch {}
      console.log("PASS", summary);
      pass++;
    } catch (e) {
      console.log("FAIL", e.message.slice(0, 200));
      fail++;
      failures.push([name, e.message.slice(0, 400)]);
    }
  }

  console.log();
  console.log(`Results: ${pass} pass / ${fail} fail`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const [n, m] of failures) console.log(`  ${n}: ${m}`);
  }

  // Hand-fetch sample outputs to eyeball:
  console.log("\n=== Sample: orders_summary monthly ===");
  const r = await call("tools/call", {
    name: "orders_summary",
    arguments: { date_from: yrStart, date_to: today, group_by: "month" },
  });
  console.log(r.content[0].text.slice(0, 800));

  console.log("\n=== Sample: top_products ===");
  const t = await call("tools/call", {
    name: "top_products",
    arguments: { date_from: yrStart, date_to: today, limit: 5, max_orders: 50 },
  });
  console.log(t.content[0].text.slice(0, 800));

  server.kill();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  server.kill();
  process.exit(1);
});
