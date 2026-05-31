// One-off script: hit each lookup endpoint, print just the first-level shape.
// Run via: SHOPTET_PRIVATE_API_TOKEN=... node scripts/discover.mjs
import { request } from "undici";

const TOKEN = process.env.SHOPTET_PRIVATE_API_TOKEN;
if (!TOKEN) {
  console.error("Need SHOPTET_PRIVATE_API_TOKEN");
  process.exit(1);
}

const paths = [
  "/api/orders/statuses",
  "/api/orders/sources",
  "/api/payment-methods",
  "/api/shipping-methods",
  "/api/categories",
  "/api/brands",
  "/api/stocks",
  "/api/sales-channels",
  "/api/customers/groups",
  "/api/pricelists",
  "/api/suppliers",
  "/api/system/endpoints",
];

function summarize(value, depth = 0) {
  const indent = "  ".repeat(depth);
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[] (empty)";
    return `[len=${value.length}] sample=${summarize(value[0], depth + 1)}`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    return "\n" + keys.map((k) => `${indent}  ${k}: ${shortVal(value[k])}`).join("\n");
  }
  return String(value).slice(0, 60);
}
function shortVal(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return `[len=${v.length}]`;
  if (typeof v === "object") return `{${Object.keys(v).slice(0, 6).join(",")}}`;
  return `${typeof v}=${String(v).slice(0, 40)}`;
}

for (const path of paths) {
  const res = await request("https://api.myshoptet.com" + path, {
    method: "GET",
    headers: { "Shoptet-Private-API-Token": TOKEN, Accept: "application/json" },
  });
  const text = await res.body.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  console.log(`=== ${path} (${res.statusCode}) ===`);
  if (typeof body !== "object") {
    console.log(text.slice(0, 300));
  } else if (body?.errors) {
    console.log("errors:", JSON.stringify(body.errors).slice(0, 200));
  } else {
    console.log("data:", summarize(body?.data));
  }
  console.log();
}
