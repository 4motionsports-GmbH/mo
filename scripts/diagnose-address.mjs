#!/usr/bin/env node
// Diagnose physical-mail address acquisition for ONE customer email.
//
// Answers "why can't we send a letter to this person?" by showing EXACTLY what
// Shopify returns for them and what our normaliser (lib/postal-address) would
// store — without touching the database. READ-ONLY: no order/customer/address is
// modified, and no letter is sent.
//
// It runs the SAME Shopify reads the app's fetchLawfulAddressByEmail uses (the
// customer's saved defaultAddress + completed orders' shippingAddress) and then
// applies the real normaliser, so a null result here is the SAME null the admin
// panel sees.
//
// Run: npm run diagnose:address -- someone@example.com
//   (loads .env automatically via --env-file)

import process from "node:process";
import {
  normalizeShopifyAddress,
  chooseLawfulAddress,
} from "../src/lib/postal-address.mjs";

// Local copy of the "completed purchase" check (the shared helper now lives in
// the TS lib, which this plain-.mjs diagnostic can't import). PAID /
// PARTIALLY_REFUNDED count as completed; everything else does not.
const COMPLETED_PURCHASE_STATUSES = new Set(["PAID", "PARTIALLY_REFUNDED"]);
function isCompletedPurchaseStatus(financialStatus) {
  if (typeof financialStatus !== "string") return false;
  return COMPLETED_PURCHASE_STATUSES.has(financialStatus.trim().toUpperCase());
}

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) {
  console.error("\nUsage: npm run diagnose:address -- someone@example.com\n");
  process.exit(1);
}

const REQUIRED = [
  "SHOPIFY_STORE_DOMAIN",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET",
  "SHOPIFY_API_VERSION",
];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`\nFAILURE: Missing env vars: ${missing.join(", ")} (see .env.example).\n`);
  process.exit(1);
}

const storeDomain = process.env.SHOPIFY_STORE_DOMAIN.trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");
const clientId = process.env.SHOPIFY_CLIENT_ID.trim();
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET.trim();
const apiVersion = process.env.SHOPIFY_API_VERSION.trim();

// ── Shopify client-credentials token (same flow as verify:shopify) ───────────
const tokenRes = await fetch(`https://${storeDomain}/admin/oauth/access_token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  }).toString(),
});
if (!tokenRes.ok) {
  console.error(`\nFAILURE: Shopify token grant HTTP ${tokenRes.status}:\n${await tokenRes.text()}\n`);
  process.exit(1);
}
const accessToken = (await tokenRes.json()).access_token;

async function gql(query, variables) {
  const res = await fetch(`https://${storeDomain}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

// ── Scope check — proves the token carries the rights the address read needs ──
console.log(`\nShopify Admin API — scope check (store ${storeDomain})\n`);
try {
  const scopeData = await gql(`{ currentAppInstallation { accessScopes { handle } } }`);
  const scopes = (scopeData.data?.currentAppInstallation?.accessScopes ?? []).map((s) => s.handle);
  const has = (s) => scopes.includes(s);
  console.log(`  read_orders:    ${has("read_orders") ? "✓" : "✗ MISSING"}`);
  console.log(
    `  read_customers: ${
      has("read_customers")
        ? "✓"
        : "✗ MISSING — add it + Protected Customer Data approval (needed for the address)"
    }`
  );
  console.log(`  (all granted scopes: ${scopes.join(", ") || "none"})\n`);
} catch (e) {
  console.warn(`  could not read scopes: ${e?.message ?? e}\n`);
}

const QUERY = `
  query DiagnoseAddress($q: String!) {
    customers(first: 1, query: $q) {
      nodes { id email defaultAddress { ...A } }
    }
    orders(first: 10, query: $q, sortKey: CREATED_AT, reverse: true) {
      nodes { name displayFinancialStatus shippingAddress { ...A } }
    }
  }
  fragment A on MailingAddress {
    city countryCodeV2 address1 address2 zip firstName lastName company name
  }
`;

const data = await gql(QUERY, { q: `email:"${email}"` });
if (data.errors) {
  // Partial denial (e.g. ACCESS_DENIED on `customers`) still returns whatever
  // other fields were allowed, so warn and CONTINUE rather than bailing.
  console.warn("\n⚠ Shopify returned GraphQL errors (some fields were denied):");
  console.warn(JSON.stringify(data.errors, null, 2));
  console.warn(
    "\n  ACCESS_DENIED on `customers`/address fields ⇒ the Admin token lacks\n" +
      "  read_customers and/or Shopify Protected Customer Data approval. The saved\n" +
      "  account address can't be read via the Admin API, and order shipping\n" +
      "  addresses are Protected Customer Data too (often withheld the same way).\n" +
      "  → Quick test path: have the customer SIGN IN, then the tier-3 Customer\n" +
      "    Account API returns their OWN address without Admin approval.\n"
  );
}

function showRaw(label, node) {
  if (!node) {
    console.log(`  ${label}: (none)`);
    return;
  }
  const f = (k) => (node[k] == null || node[k] === "" ? "·empty·" : node[k]);
  console.log(
    `  ${label}: name=${f("name") }| first=${f("firstName")} last=${f("lastName")} | ` +
      `addr1=${f("address1")} | addr2=${f("address2")} | zip=${f("zip")} | ` +
      `city=${f("city")} | country=${f("countryCodeV2")} | company=${f("company")}`
  );
  const normalized = normalizeShopifyAddress(node);
  console.log(`     → normalises to: ${normalized ? "COMPLETE ✓" : "INCOMPLETE ✗ (not storable)"}`);
}

const customer = data.data?.customers?.nodes?.[0] ?? null;
const orders = data.data?.orders?.nodes ?? [];

console.log(`\nAddress diagnosis for: ${email}\n`);

console.log("Shopify customer record:");
if (!customer) {
  console.log("  (no Shopify customer found for this email)");
} else {
  console.log(`  found: ${customer.email ?? "?"}`);
  showRaw("defaultAddress (saved account address)", customer.defaultAddress);
}

console.log("\nOrders (newest first):");
if (orders.length === 0) console.log("  (no orders found for this email)");
const completedShipping = [];
for (const o of orders) {
  const completed = isCompletedPurchaseStatus(o.displayFinancialStatus);
  console.log(`\n  Order ${o.name ?? "?"} — status ${o.displayFinancialStatus ?? "?"}` +
    `${completed ? " (completed ✓)" : " (not a completed purchase — skipped for 'purchase' basis)"}`);
  showRaw("  shippingAddress", o.shippingAddress);
  if (completed) completedShipping.push(o.shippingAddress);
}

// The EXACT decision the app makes.
const chosen = chooseLawfulAddress({
  orderShippingAddresses: completedShipping,
  defaultAddress: customer?.defaultAddress ?? null,
});

console.log("\n=== Result (what the app would store) ===");
if (chosen) {
  console.log(`  ✓ LAWFUL ADDRESS FOUND — basis: ${chosen.source}`);
  console.log(`  ${JSON.stringify(chosen.address)}`);
  console.log(
    `\n  → Click "Käufe aktualisieren" on this customer in the admin to capture it,\n` +
      `    then "Brief senden" enables (for a DOI-confirmed customer with a draft).\n`
  );
} else {
  console.log("  ✗ NO storable lawful address.");
  console.log(
    "\n  Likely reasons:\n" +
      "    - the address fields (addr1/zip/city/country) come back ·empty· above →\n" +
      "      either no full address is saved in Shopify, OR the app lacks Protected\n" +
      "      Customer Data access (street/zip are withheld);\n" +
      "    - the address is incomplete (we never part-fill);\n" +
      "    - there's no completed order AND no saved account address.\n"
  );
}

process.exit(0);
