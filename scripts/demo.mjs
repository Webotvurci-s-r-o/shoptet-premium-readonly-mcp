/**
 * Demo script: run the six demo queries against the live shop and pretty-print
 * the answers. Loads token from .env.local.
 */
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const server = spawn("node", ["dist/index.js"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});
server.stderr.on("data", () => {});

let buf = "";
const pending = new Map();
let nextId = 1;

server.stdout.on("data", (c) => {
  buf += c.toString();
  let i;
  while ((i = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.r(msg.error) : p.s(msg.result);
    }
  }
});

function call(method, params) {
  const id = nextId++;
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((s, r) => pending.set(id, { s, r }));
}
function notify(method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}
async function tool(name, args) {
  const r = await call("tools/call", { name, arguments: args });
  return JSON.parse(r.content[0].text);
}

await call("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "demo", version: "0.0.1" },
});
notify("notifications/initialized", {});

const yearStart = "2026-01-01";
const today = "2026-05-31";

const out = {};

// 1. monthly revenue 2026
out.q1_monthly_2026 = await tool("orders_summary", {
  date_from: yearStart,
  date_to: today,
  group_by: "month",
});

// 2. top products this year
out.q2_top_products = await tool("top_products", {
  date_from: yearStart,
  date_to: today,
  limit: 10,
  by: "revenue",
  max_orders: 500,
});

// 3. top 5 customers
out.q3_top_customers = await tool("top_customers", {
  date_from: yearStart,
  date_to: today,
  limit: 5,
  by: "revenue",
  max_orders: 500,
});

// 4. inventory < 5 in "Boty" — need category guid first
const cats = await tool("list_categories", {});
const allCats = cats?.data?.categories ?? [];
const boty = allCats.find((c) => (c.name || "").toLowerCase() === "boty");
out.q4_meta_category_used = boty
  ? { guid: boty.guid, name: boty.name }
  : { error: "category 'Boty' not found", available_categories: allCats.map((c) => c.name) };

if (boty) {
  out.q4_inventory_boty = await tool("inventory_overview", {
    low_stock_threshold: 5,
    category_guid: boty.guid,
    max_products: 300,
  });
}

// 5a. status breakdown
out.q5a_by_status = await tool("orders_summary", {
  date_from: yearStart,
  date_to: today,
  group_by: "status",
});

// 5b. source breakdown
out.q5b_by_source = await tool("orders_summary", {
  date_from: yearStart,
  date_to: today,
  group_by: "source",
});

// 6. unpaid orders
out.q6_unpaid = await tool("unpaid_orders", {
  date_from: yearStart,
  date_to: today,
  limit: 500,
});

console.log(JSON.stringify(out, null, 2));
server.kill();
