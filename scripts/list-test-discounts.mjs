#!/usr/bin/env node
// scripts/list-test-discounts.mjs — List (and optionally delete) Shopify
// discount codes created by the motionsports-chatbot backend.
//
// Identification: this app mints codes with the prefix "MS5-" (see
// generateDiscountCodeString() in src/lib/shopify-discounts.ts).
// Codes are also recognisable by their title format:
//   "Persönlicher Rabatt (X%) — MS5-XXXXXXXX"
//
// The script pages through ALL discount codes in the store, then filters
// client-side to those whose code string starts with "MS5-". It never
// matches codes you created manually.
//
// ─── Modes ────────────────────────────────────────────────────────────────────
//
//   LIST only (default, read-safe):
//     node --env-file=.env.local scripts/list-test-discounts.mjs
//
//   DELETE matching codes (requires explicit confirmation at the prompt):
//     node --env-file=.env.local scripts/list-test-discounts.mjs --delete
//
// ─── API references (verified 2026-06-05 against api version 2026-04) ─────────
//
//   discountNodes query:
//     https://shopify.dev/docs/api/admin-graphql/2026-04/queries/discountNodes
//     Required scope: read_discounts
//
//   discountCodeDelete mutation:
//     https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/discountCodeDelete
//     Required scope: write_discounts
//     Input:   id: ID!  (the gid://shopify/DiscountCodeNode/… from discountNodes)
//     Returns: deletedCodeDiscountId, userErrors[]
//
// ─── Required env vars ────────────────────────────────────────────────────────
//
//   SHOPIFY_STORE_DOMAIN    e.g. your-store.myshopify.com
//   SHOPIFY_CLIENT_ID
//   SHOPIFY_CLIENT_SECRET
//   SHOPIFY_API_VERSION     e.g. 2026-04

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, argv, exit } from "node:process";

// ─── Flags ────────────────────────────────────────────────────────────────────

const DELETE_MODE = argv.includes("--delete");

// ─── Env validation ───────────────────────────────────────────────────────────

const REQUIRED_ENV = [
  "SHOPIFY_STORE_DOMAIN",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET",
  "SHOPIFY_API_VERSION",
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `\n[list-test-discounts] Missing env vars: ${missing.join(", ")}\n` +
      "  Set them in your env file and run with --env-file=.env.local\n"
  );
  exit(1);
}

const storeDomain = process.env.SHOPIFY_STORE_DOMAIN.trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");
const clientId = process.env.SHOPIFY_CLIENT_ID.trim();
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET.trim();
const apiVersion = process.env.SHOPIFY_API_VERSION.trim();

// ─── Code prefix — must match generateDiscountCodeString() in shopify-discounts.ts
const CODE_PREFIX = "MS5-";

// ─── Auth: client-credentials token exchange ─────────────────────────────────
// Same flow as src/lib/shopify.ts and scripts/verify-shopify-auth.mjs.

async function getAccessToken() {
  const url = `https://${storeDomain}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Token exchange failed: HTTP ${res.status} ${res.statusText}\n${text.slice(0, 400)}`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Token endpoint returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!parsed.access_token) {
    throw new Error(`Token response missing access_token: ${text.slice(0, 200)}`);
  }
  return parsed.access_token;
}

// ─── GraphQL helper ───────────────────────────────────────────────────────────

async function shopifyGraphql(token, query, variables = {}) {
  const url = `https://${storeDomain}/admin/api/${apiVersion}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `GraphQL request failed: HTTP ${res.status} ${res.statusText}\n${text.slice(0, 400)}`
    );
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`GraphQL returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (json.errors?.length) {
    throw new Error(
      `GraphQL errors:\n${json.errors.map((e) => `  ${e.message}`).join("\n")}`
    );
  }
  return json.data;
}

// ─── Query: paginate all discount nodes ──────────────────────────────────────
// Fetches all discounts in the store (cursor-paginated), 100 per page.
// We filter client-side on the MS5- prefix rather than relying on server-side
// title filtering, which varies by Shopify plan / search syntax support.
//
// discountNodes docs: https://shopify.dev/docs/api/admin-graphql/2026-04/queries/discountNodes
// Required scope: read_discounts

const LIST_DISCOUNTS_QUERY = /* GraphQL */ `
  query ListDiscountNodes($cursor: String) {
    discountNodes(first: 100, after: $cursor) {
      nodes {
        id
        discount {
          ... on DiscountCodeBasic {
            title
            status
            codes(first: 1) {
              nodes {
                code
              }
            }
            endsAt
          }
          ... on DiscountCodeFreeShipping {
            title
            status
            codes(first: 1) {
              nodes {
                code
              }
            }
            endsAt
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

async function fetchAllAppDiscounts(token) {
  const matches = [];
  let cursor = null;
  let totalFetched = 0;
  let page = 1;

  while (true) {
    process.stdout.write(
      `  Fetching page ${page} (cursor: ${cursor ? cursor.slice(0, 16) + "…" : "start"})…`
    );
    const data = await shopifyGraphql(token, LIST_DISCOUNTS_QUERY, {
      cursor,
    });
    const nodes = data?.discountNodes?.nodes ?? [];
    const pageInfo = data?.discountNodes?.pageInfo ?? {};
    totalFetched += nodes.length;
    process.stdout.write(` ${nodes.length} nodes\n`);

    for (const node of nodes) {
      const discount = node.discount;
      if (!discount) continue;
      // codes() returns at most 1 node per our query
      const code = discount.codes?.nodes?.[0]?.code ?? null;
      if (!code) continue;
      if (!code.startsWith(CODE_PREFIX)) continue;
      matches.push({
        id: node.id,
        code,
        title: discount.title ?? "(no title)",
        status: discount.status ?? "(unknown)",
        expiresAt: discount.endsAt ?? null,
      });
    }

    if (!pageInfo.hasNextPage) break;
    cursor = pageInfo.endCursor;
    page++;
  }

  console.log(`  Scanned ${totalFetched} total discount node(s).`);
  return matches;
}

// ─── Mutation: delete a single discount code node ─────────────────────────────
// discountCodeDelete docs:
//   https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/discountCodeDelete
// Required scope: write_discounts
// Input:   id: ID!  (the gid://shopify/DiscountCodeNode/… from discountNodes)
// Returns: deletedCodeDiscountId (the same id on success), userErrors[]

const DELETE_DISCOUNT_MUTATION = /* GraphQL */ `
  mutation DeleteDiscountCode($id: ID!) {
    discountCodeDelete(id: $id) {
      deletedCodeDiscountId
      userErrors {
        field
        code
        message
      }
    }
  }
`;

async function deleteDiscount(token, id) {
  const data = await shopifyGraphql(token, DELETE_DISCOUNT_MUTATION, { id });
  const payload = data?.discountCodeDelete;
  if (payload?.userErrors?.length) {
    const msgs = payload.userErrors.map((e) => e.message).join("; ");
    throw new Error(`userErrors: ${msgs}`);
  }
  return payload?.deletedCodeDiscountId ?? null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(
  `\n[list-test-discounts] Store  : https://${storeDomain}` +
    `\n[list-test-discounts] API ver: ${apiVersion}` +
    `\n[list-test-discounts] Mode   : ${DELETE_MODE ? "⚠  DELETE (codes will be permanently removed)" : "LIST only (read-safe)"}` +
    `\n[list-test-discounts] Filter : code starts with "${CODE_PREFIX}"\n`
);

// 1. Authenticate
console.log("[list-test-discounts] Obtaining access token…");
let token;
try {
  token = await getAccessToken();
  console.log("[list-test-discounts] ✓ Token obtained.\n");
} catch (err) {
  console.error(`[list-test-discounts] Auth failed: ${err.message}`);
  exit(1);
}

// 2. Fetch all app-created discount codes
console.log("[list-test-discounts] Scanning discount nodes…");
let matches;
try {
  matches = await fetchAllAppDiscounts(token);
} catch (err) {
  console.error(`[list-test-discounts] Fetch failed: ${err.message}`);
  exit(1);
}

if (matches.length === 0) {
  console.log(
    `\n[list-test-discounts] No discount codes with prefix "${CODE_PREFIX}" found.\n`
  );
  exit(0);
}

// 3. Print results
console.log(
  `\n[list-test-discounts] Found ${matches.length} code(s) matching prefix "${CODE_PREFIX}":\n`
);
console.log(
  "  " +
    "CODE".padEnd(16) +
    "STATUS".padEnd(12) +
    "EXPIRES".padEnd(26) +
    "NODE ID"
);
console.log("  " + "─".repeat(90));
for (const m of matches) {
  const expires = m.expiresAt
    ? new Date(m.expiresAt).toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : "(no expiry)";
  console.log(
    "  " +
      m.code.padEnd(16) +
      m.status.padEnd(12) +
      expires.padEnd(26) +
      m.id
  );
}
console.log("");

// 4. Optional delete mode
if (!DELETE_MODE) {
  console.log(
    "[list-test-discounts] Run with --delete to permanently delete these codes.\n"
  );
  exit(0);
}

// ─── DELETE MODE ──────────────────────────────────────────────────────────────

console.log(
  "⚠  DELETE MODE — the following codes will be PERMANENTLY deleted from Shopify:\n"
);
for (const m of matches) {
  console.log(`  • ${m.code}  (${m.status})  ${m.id}`);
}
console.log("");

const rl = createInterface({ input, output });
let answer;
try {
  answer = await rl.question(
    `  Type "yes" to permanently delete all ${matches.length} code(s): `
  );
} finally {
  rl.close();
}

if (answer.trim().toLowerCase() !== "yes") {
  console.log("\n[list-test-discounts] Aborted — no codes deleted.\n");
  exit(0);
}

console.log("\n[list-test-discounts] Deleting codes…\n");
let deleted = 0;
let failed = 0;
for (const m of matches) {
  process.stdout.write(`  Deleting ${m.code} … `);
  try {
    await deleteDiscount(token, m.id);
    process.stdout.write("✓ deleted\n");
    deleted++;
  } catch (err) {
    process.stdout.write(`✗ FAILED: ${err.message}\n`);
    failed++;
  }
}

console.log("");
console.log(
  `[list-test-discounts] Done. Deleted: ${deleted}  Failed: ${failed}\n`
);
if (failed > 0) exit(1);
