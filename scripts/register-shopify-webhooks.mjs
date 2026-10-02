#!/usr/bin/env node
// Register the Shopify webhook subscriptions Mo needs, idempotently, and check
// the app's scopes for the customer platform (docs/CUSTOMER_PLATFORM_PLAN.md
// Phase 0, docs/CATALOG_SYNC.md "Shopify-side registration").
//
//   npm run shopify:webhooks                       # dry run: what exists, what is missing
//   npm run shopify:webhooks -- --apply            # create the missing subscriptions
//   npm run shopify:webhooks -- --url https://…    # endpoint base (default PUBLIC_BASE_URL)
//
// Subscriptions created through the Admin API with the app's client-credentials
// token are signed with the app's client secret — /api/webhooks/shopify accepts
// SHOPIFY_WEBHOOK_SECRET and SHOPIFY_CLIENT_SECRET. The mandatory compliance
// topics (customers/data_request, customers/redact, shop/redact) CANNOT be
// subscribed here: set their URL in the app configuration (Dev Dashboard → app
// → Configuration → Compliance webhooks, or shopify.app.toml). The script
// prints that reminder.
//
// Never deletes or changes an existing subscription.

import process from "node:process";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const urlArg = args.includes("--url") ? args[args.indexOf("--url") + 1] : null;

const REQUIRED_ENV = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "SHOPIFY_API_VERSION"];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]?.trim());
if (missingEnv.length) {
  console.error(`Missing env vars: ${missingEnv.join(", ")} (see .env.example).`);
  process.exit(1);
}
const base = (urlArg || process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
if (!/^https:\/\//.test(base)) {
  console.error("Need the deployment base URL: --url https://<deployment> or PUBLIC_BASE_URL.");
  process.exit(1);
}
const endpoint = `${base}/api/webhooks/shopify`;

const domain = process.env.SHOPIFY_STORE_DOMAIN.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
const apiVersion = process.env.SHOPIFY_API_VERSION.trim();

// Catalog sync + order attribution (existing) and the customer platform, each
// with the access scope Shopify requires to subscribe to the topic.
const TOPICS = [
  ["PRODUCTS_CREATE", "Katalog", "read_products"],
  ["PRODUCTS_UPDATE", "Katalog", "read_products"],
  ["PRODUCTS_DELETE", "Katalog", "read_products"],
  ["INVENTORY_LEVELS_UPDATE", "Katalog", "read_inventory"],
  ["ORDERS_CREATE", "Bestellungen", "read_orders"],
  ["ORDERS_UPDATED", "Bestellungen", "read_orders"],
  ["ORDERS_PAID", "Bestellungen", "read_orders"],
  ["ORDERS_CANCELLED", "Bestellungen", "read_orders"],
  ["CUSTOMERS_CREATE", "Kundenstamm", "read_customers"],
  ["CUSTOMERS_UPDATE", "Kundenstamm", "read_customers"],
  ["CUSTOMERS_DELETE", "Kundenstamm", "read_customers"],
  ["CUSTOMERS_EMAIL_MARKETING_CONSENT_UPDATE", "Einwilligung", "read_customers"],
  ["BULK_OPERATIONS_FINISH", "Import", null],
];

const REQUIRED_SCOPES = [
  "read_products",
  "write_products",
  "read_inventory",
  "read_orders",
  "read_all_orders",
  "read_customers",
  "write_customers",
  "write_discounts",
  "read_publications",
  "write_publications",
];

async function token() {
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID.trim(),
      client_secret: process.env.SHOPIFY_CLIENT_SECRET.trim(),
    }),
  });
  if (!res.ok) throw new Error(`token request failed: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error("token response without access_token");
  return json.access_token;
}

async function gql(accessToken, query, variables = {}) {
  const res = await fetch(`https://${domain}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  return json;
}

// `uri` replaced `endpoint { callbackUrl }` / `callbackUrl` in recent Admin API
// versions; fall back to the older shape when the field is unknown.
const LIST_URI = `{ webhookSubscriptions(first: 100) { nodes { id topic uri } } }`;
const LIST_LEGACY = `{ webhookSubscriptions(first: 100) { nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }`;
const CREATE_URI = `mutation($topic: WebhookSubscriptionTopic!, $url: String!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $url, format: JSON }) {
    webhookSubscription { id } userErrors { field message } } }`;
const CREATE_LEGACY = `mutation($topic: WebhookSubscriptionTopic!, $url: URL!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $url, format: JSON }) {
    webhookSubscription { id } userErrors { field message } } }`;

const unknownField = (json) => (json.errors ?? []).some((e) => /field|argument|doesn't exist|undefined/i.test(e.message ?? ""));

async function main() {
  const accessToken = await token();

  // Scopes.
  const scopes = await gql(accessToken, `{ currentAppInstallation { accessScopes { handle } } }`);
  const granted = new Set((scopes.data?.currentAppInstallation?.accessScopes ?? []).map((s) => s.handle));
  const missingScopes = REQUIRED_SCOPES.filter((s) => !granted.has(s));
  console.log(`\nScopes: ${granted.size} granted.`);
  if (missingScopes.length) {
    console.log(`  MISSING: ${missingScopes.join(", ")} — add them to the app, then REINSTALL it on the store.`);
  } else {
    console.log("  All required scopes are granted.");
  }

  // Existing subscriptions.
  let legacy = false;
  let list = await gql(accessToken, LIST_URI);
  if (list.errors && unknownField(list)) {
    legacy = true;
    list = await gql(accessToken, LIST_LEGACY);
  }
  if (list.errors) throw new Error(`listing subscriptions failed: ${JSON.stringify(list.errors)}`);
  const nodes = list.data?.webhookSubscriptions?.nodes ?? [];
  const existing = new Set(
    nodes
      .map((n) => ({ topic: n.topic, url: legacy ? n.endpoint?.callbackUrl : n.uri }))
      .filter((n) => n.url === endpoint)
      .map((n) => n.topic)
  );

  console.log(`\nEndpoint: ${endpoint}`);
  const missing = [];
  for (const [topic, area, scope] of TOPICS) {
    const ok = existing.has(topic);
    const noScope = !ok && scope && !granted.has(scope) ? `  (needs ${scope})` : "";
    console.log(`  ${ok ? "ok      " : "MISSING "} ${topic.padEnd(42)} ${area}${noScope}`);
    if (!ok) missing.push(topic);
  }

  if (missing.length && apply) {
    console.log(`\nCreating ${missing.length} subscription(s)…`);
    for (const topic of missing) {
      const res = await gql(accessToken, legacy ? CREATE_LEGACY : CREATE_URI, { topic, url: endpoint });
      const errs = [...(res.errors ?? []), ...(res.data?.webhookSubscriptionCreate?.userErrors ?? [])];
      const scope = TOPICS.find(([t]) => t === topic)?.[2];
      const hint = errs.length && scope && !granted.has(scope) ? ` — add the scope ${scope}, release, reinstall the app` : "";
      console.log(errs.length ? `  FAILED  ${topic}: ${errs.map((e) => e.message).join("; ")}${hint}` : `  created ${topic}`);
    }
  } else if (missing.length) {
    console.log(`\nDry run — ${missing.length} missing. Re-run with --apply to create them.`);
  } else {
    console.log("\nAll subscriptions are in place.");
  }

  console.log(
    "\nCompliance topics (customers/data_request, customers/redact, shop/redact) are set in the app" +
      `\nconfiguration, not here: Dev Dashboard → app → Configuration → Compliance webhooks → ${endpoint}`
  );
}

main().catch((err) => {
  console.error(`\nFAILURE: ${err.message}`);
  process.exit(1);
});
