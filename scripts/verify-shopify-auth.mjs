#!/usr/bin/env node
// Verify Shopify Admin API auth via the OAuth client credentials grant.
//
// Built against (as of 2026-05-28):
//   - https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
//   - https://shopify.dev/docs/api/usage/versioning  (latest stable: 2026-04)
//
// The Jan-2026 dev-dashboard auth model removed the static shpat_ token. Apps
// owned by your organization that are installed on stores in the same org
// can exchange their Client ID + Client Secret directly for a short-lived
// Admin API access token (24h TTL). The token goes in `X-Shopify-Access-Token`
// on subsequent Admin API calls.
//
// Run: npm run verify:shopify   (loads .env automatically via --env-file)
//
// Prints SUCCESS (with token expiry and a sample shop field) or a precise
// FAILURE message — HTTP status, Shopify error body, and the most likely
// cause (wrong scope, app not installed, plan limitation, etc).

import process from "node:process";

const REQUIRED = [
  "SHOPIFY_STORE_DOMAIN",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET",
  "SHOPIFY_API_VERSION",
];

function fail(msg, details) {
  console.error("\nFAILURE:", msg);
  if (details) console.error(details);
  process.exit(1);
}

function ok(msg) {
  console.log("\nSUCCESS:", msg);
  process.exit(0);
}

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  fail(
    `Missing env vars: ${missing.join(", ")}.`,
    "Set them in .env (see .env.example). Run with: npm run verify:shopify"
  );
}

const storeDomainRaw = process.env.SHOPIFY_STORE_DOMAIN.trim();
const storeDomain = storeDomainRaw
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");
if (!/\.myshopify\.com$/.test(storeDomain)) {
  fail(
    `SHOPIFY_STORE_DOMAIN must look like "your-store.myshopify.com" (got "${storeDomainRaw}").`,
    "Use the *.myshopify.com domain, not the public domain. The client credentials grant only accepts the myshopify.com host."
  );
}

const clientId = process.env.SHOPIFY_CLIENT_ID.trim();
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET.trim();
const apiVersion = process.env.SHOPIFY_API_VERSION.trim();

// Step 1 — client credentials grant.
// POST https://{shop}.myshopify.com/admin/oauth/access_token
//   Content-Type: application/x-www-form-urlencoded
//   body: grant_type=client_credentials & client_id & client_secret
// Response: { access_token, scope, expires_in?, token_type? }
const tokenUrl = `https://${storeDomain}/admin/oauth/access_token`;
const tokenBody = new URLSearchParams({
  grant_type: "client_credentials",
  client_id: clientId,
  client_secret: clientSecret,
});

console.log(`[verify-shopify-auth] requesting access token`);
console.log(`  POST ${tokenUrl}`);

let tokenRes;
try {
  tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });
} catch (err) {
  fail("Network error contacting Shopify token endpoint.", err);
}

const tokenText = await tokenRes.text();
if (!tokenRes.ok) {
  let likely = "Unknown — check the response body above.";
  if (tokenRes.status === 401) {
    likely =
      "Likely wrong CLIENT_ID/CLIENT_SECRET, or the app is not installed on the store. Open the Dev Dashboard, confirm the app is installed on this store, then re-copy both values.";
  } else if (tokenRes.status === 400) {
    likely =
      "Likely an invalid grant or unsupported app type. Client-credentials only works for apps owned by your organization and installed on stores in the same org. Public apps and custom apps installed by other merchants must use authorization-code or token-exchange instead.";
  } else if (tokenRes.status === 404) {
    likely =
      "The token endpoint returned 404. Recheck SHOPIFY_STORE_DOMAIN (must be the *.myshopify.com domain).";
  } else if (tokenRes.status === 403) {
    likely =
      "Forbidden — could be a plan or org-policy restriction on the store.";
  }
  fail(
    `Token endpoint returned HTTP ${tokenRes.status} ${tokenRes.statusText}.`,
    `Response body:\n${tokenText}\n\nMost likely cause: ${likely}`
  );
}

let tokenJson;
try {
  tokenJson = JSON.parse(tokenText);
} catch {
  fail(
    "Token endpoint returned non-JSON response.",
    `Body: ${tokenText.slice(0, 500)}`
  );
}

const accessToken = tokenJson.access_token;
const scope = tokenJson.scope ?? "(none reported)";
const expiresIn = tokenJson.expires_in;
if (!accessToken) {
  fail(
    "Token response did not include an access_token field.",
    `Parsed body: ${JSON.stringify(tokenJson)}`
  );
}

console.log(`  ok — scope=${scope}${expiresIn ? `, expires_in=${expiresIn}s` : ""}`);

if (!/read_products/.test(scope)) {
  fail(
    "Granted scope does not include read_products.",
    `Granted scope: ${scope}\nFix: in the Dev Dashboard, edit your app's API access section, request the read_products scope, and reinstall the app on the store before retrying.`
  );
}

// Step 2 — minimal authenticated Admin API call.
// GraphQL `shop { name primaryDomain { host } }` proves the token works and
// that we can talk to the Admin GraphQL endpoint at the configured version.
const gqlUrl = `https://${storeDomain}/admin/api/${apiVersion}/graphql.json`;
const query = `{ shop { name myshopifyDomain primaryDomain { host } plan { displayName } } }`;

console.log(`\n[verify-shopify-auth] calling Admin GraphQL`);
console.log(`  POST ${gqlUrl}`);

let gqlRes;
try {
  gqlRes = await fetch(gqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query }),
  });
} catch (err) {
  fail("Network error contacting Admin GraphQL.", err);
}

const gqlText = await gqlRes.text();
if (!gqlRes.ok) {
  let likely = "Check the response body above.";
  if (gqlRes.status === 401)
    likely = "Access token rejected — re-fetch (it may have expired) and retry.";
  if (gqlRes.status === 404)
    likely = `API version "${apiVersion}" may not be valid. Use a supported version like 2026-04.`;
  if (gqlRes.status === 403)
    likely = "Forbidden — token lacks the required scope for this query.";
  fail(
    `Admin GraphQL returned HTTP ${gqlRes.status} ${gqlRes.statusText}.`,
    `Response body:\n${gqlText}\n\nMost likely cause: ${likely}`
  );
}

let gqlJson;
try {
  gqlJson = JSON.parse(gqlText);
} catch {
  fail("Admin GraphQL returned non-JSON response.", `Body: ${gqlText.slice(0, 500)}`);
}

if (gqlJson.errors) {
  fail(
    "Admin GraphQL returned GraphQL errors.",
    JSON.stringify(gqlJson.errors, null, 2)
  );
}

const shop = gqlJson.data?.shop;
if (!shop?.name) {
  fail(
    "Admin GraphQL succeeded but shop.name was empty.",
    JSON.stringify(gqlJson, null, 2)
  );
}

ok(
  `token works against Admin API ${apiVersion}.\n` +
    `  shop.name           = ${shop.name}\n` +
    `  shop.myshopifyDomain= ${shop.myshopifyDomain ?? "?"}\n` +
    `  shop.primaryDomain  = ${shop.primaryDomain?.host ?? "?"}\n` +
    `  shop.plan           = ${shop.plan?.displayName ?? "?"}\n` +
    `  scope               = ${scope}\n` +
    (expiresIn ? `  token expires in    = ${expiresIn}s (≈ ${Math.round(expiresIn / 3600)}h)\n` : "")
);
