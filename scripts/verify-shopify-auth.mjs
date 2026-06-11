#!/usr/bin/env node
// Verify Shopify Admin API auth and required scope grants via the OAuth
// client-credentials grant.
//
// Checks performed (all READ-SAFE — no data is created, modified, or deleted):
//   1. read_products  — shop{} query proves the token and the products scope
//   2. read_orders    — orders(first:1) query; empty list counts as SUCCESS
//   3. write_discounts — currentAppInstallation{accessScopes} lists every scope
//                        the token actually carries; we assert write_discounts
//                        is present (option b from the task spec because
//                        discountNodes only requires read_discounts and cannot
//                        distinguish read_discounts from write_discounts)
//
// Built against (as of 2026-05-28 / extended 2026-06-04):
//   - https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
//   - https://shopify.dev/docs/api/usage/versioning  (latest stable: 2026-04)
//   - https://shopify.dev/docs/api/admin-graphql/2026-04/queries/currentAppInstallation
//
// The Jan-2026 dev-dashboard auth model removed the static shpat_ token. Apps
// owned by your organization that are installed on stores in the same org
// can exchange their Client ID + Client Secret directly for a short-lived
// Admin API access token (24h TTL). The token goes in `X-Shopify-Access-Token`
// on subsequent Admin API calls.
//
// Run: npm run verify:shopify   (loads .env automatically via --env-file)

import process from "node:process";

const REQUIRED = [
  "SHOPIFY_STORE_DOMAIN",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET",
  "SHOPIFY_API_VERSION",
];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `\nFAILURE: Missing env vars: ${missing.join(", ")}.`,
    "\nSet them in .env (see .env.example). Run with: npm run verify:shopify"
  );
  process.exit(1);
}

const storeDomainRaw = process.env.SHOPIFY_STORE_DOMAIN.trim();
const storeDomain = storeDomainRaw
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");
if (!/\.myshopify\.com$/.test(storeDomain)) {
  console.error(
    `\nFAILURE: SHOPIFY_STORE_DOMAIN must look like "your-store.myshopify.com" (got "${storeDomainRaw}").`,
    "\nUse the *.myshopify.com domain, not the public domain. The client credentials grant only accepts the myshopify.com host."
  );
  process.exit(1);
}

const clientId = process.env.SHOPIFY_CLIENT_ID.trim();
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET.trim();
const apiVersion = process.env.SHOPIFY_API_VERSION.trim();

// ─── Step 1: client-credentials token ────────────────────────────────────────
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
  console.error("\nFAILURE: Network error contacting Shopify token endpoint.", err);
  process.exit(1);
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
  console.error(
    `\nFAILURE: Token endpoint returned HTTP ${tokenRes.status} ${tokenRes.statusText}.`,
    `\nResponse body:\n${tokenText}\n\nMost likely cause: ${likely}`
  );
  process.exit(1);
}

let tokenJson;
try {
  tokenJson = JSON.parse(tokenText);
} catch {
  console.error(
    "\nFAILURE: Token endpoint returned non-JSON response.",
    `Body: ${tokenText.slice(0, 500)}`
  );
  process.exit(1);
}

const accessToken = tokenJson.access_token;
const scope = tokenJson.scope ?? "(none reported)";
const expiresIn = tokenJson.expires_in;
if (!accessToken) {
  console.error(
    "\nFAILURE: Token response did not include an access_token field.",
    `Parsed body: ${JSON.stringify(tokenJson)}`
  );
  process.exit(1);
}

console.log(`  ok — scope=${scope}${expiresIn ? `, expires_in=${expiresIn}s` : ""}`);

// ─── Shared GraphQL helper ────────────────────────────────────────────────────
const gqlUrl = `https://${storeDomain}/admin/api/${apiVersion}/graphql.json`;

async function gqlQuery(query) {
  const res = await fetch(gqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { ok: res.ok, status: res.status, statusText: res.statusText, text, json };
}

// Results accumulator — values are { status: 'SUCCESS'|'FAILURE'|'CANNOT-VERIFY', detail? }
const results = {};

// ─── Check 1: read_products (existing logic, kept intact) ─────────────────────
// Shopify scope hierarchy: write_<x> implicitly grants read_<x>.
// So either read_products or write_products is enough for catalog sync.
{
  const scopes = scope.split(/[,\s]+/).filter(Boolean);
  const hasProductRead =
    scopes.includes("read_products") || scopes.includes("write_products");

  if (!hasProductRead) {
    results.read_products = {
      status: "FAILURE",
      detail:
        `Granted scope does not include read_products or write_products.\n` +
        `  Granted scope: ${scope}`,
    };
  } else {
    // Minimal authenticated Admin API call.
    // GraphQL shop{} proves the token works and that we can reach the configured
    // API version — unchanged from the original script.
    const shopQuery = `{ shop { name myshopifyDomain primaryDomain { host } plan { displayName } } }`;

    console.log(`\n[verify-shopify-auth] check read_products — Admin GraphQL`);
    console.log(`  POST ${gqlUrl}`);

    let r;
    try {
      r = await gqlQuery(shopQuery);
    } catch (err) {
      results.read_products = { status: "FAILURE", detail: `Network error: ${err}` };
      r = null;
    }

    if (r) {
      if (!r.ok) {
        let likely = "Check the response body above.";
        if (r.status === 401) likely = "Access token rejected — re-fetch (it may have expired) and retry.";
        if (r.status === 404) likely = `API version "${apiVersion}" may not be valid. Use a supported version like 2026-04.`;
        if (r.status === 403) likely = "Forbidden — token lacks the required scope for this query.";
        results.read_products = {
          status: "FAILURE",
          detail: `HTTP ${r.status} ${r.statusText}\n  body: ${r.text}\n  likely: ${likely}`,
        };
      } else if (r.json?.errors) {
        results.read_products = {
          status: "FAILURE",
          detail: `GraphQL errors:\n  ${JSON.stringify(r.json.errors, null, 2)}`,
        };
      } else {
        const shop = r.json?.data?.shop;
        if (!shop?.name) {
          results.read_products = {
            status: "FAILURE",
            detail: `shop.name was empty in response: ${JSON.stringify(r.json)}`,
          };
        } else {
          console.log(
            `  shop.name           = ${shop.name}\n` +
            `  shop.myshopifyDomain= ${shop.myshopifyDomain ?? "?"}\n` +
            `  shop.primaryDomain  = ${shop.primaryDomain?.host ?? "?"}\n` +
            `  shop.plan           = ${shop.plan?.displayName ?? "?"}\n` +
            `  scope               = ${scope}` +
            (expiresIn ? `\n  token expires_in    = ${expiresIn}s (≈ ${Math.round(expiresIn / 3600)}h)` : "")
          );
          results.read_products = { status: "SUCCESS" };
        }
      }
    }
  }
}

// ─── Check 2: read_orders ─────────────────────────────────────────────────────
// GraphQL orders(first:1) requires read_orders.
// An empty list is still a SUCCESS — permission was granted, the store just has
// no orders visible to this token.
// Shopify returns HTTP 200 + a top-level "errors" array (with an FORBIDDEN
// extension code) when the scope is missing, rather than a 4xx HTTP status.
{
  const ordersQuery = `{ orders(first: 1) { edges { node { id email } } } }`;

  console.log(`\n[verify-shopify-auth] check read_orders — Admin GraphQL`);
  console.log(`  POST ${gqlUrl}`);

  let r;
  try {
    r = await gqlQuery(ordersQuery);
  } catch (err) {
    results.read_orders = { status: "FAILURE", detail: `Network error: ${err}` };
    r = null;
  }

  if (r) {
    if (!r.ok) {
      results.read_orders = {
        status: "FAILURE",
        detail: `HTTP ${r.status} ${r.statusText}\n  body: ${r.text}`,
      };
    } else if (r.json?.errors) {
      const errStr = JSON.stringify(r.json.errors, null, 2);
      results.read_orders = {
        status: "FAILURE",
        detail: `Permission/scope error (HTTP ${r.status}):\n  ${errStr}`,
      };
    } else {
      const count = r.json?.data?.orders?.edges?.length ?? 0;
      console.log(`  ok — returned ${count} order(s) (limit 1)`);
      results.read_orders = { status: "SUCCESS" };
    }
  }
}

// ─── Check 3: write_discounts ─────────────────────────────────────────────────
// Strategy chosen: option (b) — query currentAppInstallation{accessScopes{handle}}
// and assert write_discounts is present in the returned list.
//
// Why not option (a) — discountNodes read query?
//   discountNodes requires read_discounts (per 2026-04 docs), which is a
//   separate, lesser scope. A token with only read_discounts (not write_discounts)
//   would pass that check, so it cannot confirm write_discounts is granted.
//   currentAppInstallation returns the exact scopes carried by the token, making
//   it the only non-destructive, unambiguous signal.
//
// Source: https://shopify.dev/docs/api/admin-graphql/2026-04/queries/currentAppInstallation
//         https://shopify.dev/docs/api/admin-graphql/2026-04/objects/AppInstallation
{
  const scopesQuery = `{ currentAppInstallation { accessScopes { handle } } }`;

  console.log(`\n[verify-shopify-auth] check write_discounts — Admin GraphQL (currentAppInstallation)`);
  console.log(`  POST ${gqlUrl}`);

  let r;
  try {
    r = await gqlQuery(scopesQuery);
  } catch (err) {
    results.write_discounts = { status: "FAILURE", detail: `Network error: ${err}` };
    r = null;
  }

  if (r) {
    if (!r.ok) {
      results.write_discounts = {
        status: "FAILURE",
        detail: `HTTP ${r.status} ${r.statusText}\n  body: ${r.text}`,
      };
    } else if (r.json?.errors) {
      results.write_discounts = {
        status: "FAILURE",
        detail: `GraphQL errors (HTTP ${r.status}):\n  ${JSON.stringify(r.json.errors, null, 2)}`,
      };
    } else {
      const grantedScopes = (r.json?.data?.currentAppInstallation?.accessScopes ?? [])
        .map((s) => s.handle);
      console.log(`  granted scopes: ${grantedScopes.join(", ") || "(none)"}`);
      if (grantedScopes.includes("write_discounts")) {
        results.write_discounts = { status: "SUCCESS" };
      } else {
        results.write_discounts = {
          status: "FAILURE",
          detail:
            `write_discounts not found in the token's granted scopes.\n` +
            `  Granted: [${grantedScopes.join(", ")}]`,
        };
      }
    }
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
const FAILURE_HINTS = [
  "    most likely causes:",
  "      (i)  The scope is not added in the Shopify Developer Dashboard app config.",
  "      (ii) The scope was added after the last app authorization — the app must",
  "           be re-installed / re-authorized so the new token carries it.",
];

const PAD = 16;
const hasFailures = Object.values(results).some((r) => r?.status === "FAILURE");

console.log("\n=== Shopify scope verification ===");
for (const [name, r] of Object.entries(results)) {
  console.log(`  ${(name + ":").padEnd(PAD)} ${r.status}`);
  if (r.status === "FAILURE") {
    console.log(`    detail: ${r.detail}`);
    FAILURE_HINTS.forEach((h) => console.log(h));
  }
  if (r.status === "CANNOT-VERIFY") {
    console.log(`    reason: ${r.detail}`);
  }
}
console.log("");

process.exit(hasFailures ? 1 : 0);
