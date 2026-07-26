#!/usr/bin/env node
// One-shot setup for the "Wissen" Q&A feature's Shopify metafield definition:
// creates the PRODUCT metafield definition `custom.qa` (type: json) WITH
// storefront access enabled, so
//   - the storefront theme can read product.metafields.custom.qa (PDP Q&A tab),
//   - the value is visible/editable on the product page in the Shopify admin,
//   - the admin "Veröffentlichen" publish path (metafieldsSet) has a proper
//     definition to attach to.
//
// Idempotent: if the definition already exists (userErrors code TAKEN), the
// script reports that and exits 0 — safe to re-run.
//
// Auth: same OAuth client-credentials grant as scripts/verify-shopify-auth.mjs
// (see that file for the full error taxonomy). Requires the write_products
// scope on the app.
//
// Run: node --env-file=.env scripts/setup-qa-metafield.mjs

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
    "\nSet them in .env (see .env.example). Run with: node --env-file=.env scripts/setup-qa-metafield.mjs"
  );
  process.exit(1);
}

const storeDomain = process.env.SHOPIFY_STORE_DOMAIN.trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");
const apiVersion = process.env.SHOPIFY_API_VERSION.trim();

// ── Token (client-credentials grant) ─────────────────────────────────────────
const tokenRes = await fetch(`https://${storeDomain}/admin/oauth/access_token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.SHOPIFY_CLIENT_ID.trim(),
    client_secret: process.env.SHOPIFY_CLIENT_SECRET.trim(),
  }).toString(),
});
const tokenText = await tokenRes.text();
if (!tokenRes.ok) {
  console.error(
    `\nFAILURE: token exchange HTTP ${tokenRes.status}. Body:\n${tokenText}` +
      "\nRun `npm run verify:shopify` for a detailed auth diagnosis."
  );
  process.exit(1);
}
const accessToken = JSON.parse(tokenText).access_token;

async function graphql(query, variables) {
  const res = await fetch(
    `https://${storeDomain}/admin/api/${apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.errors?.length) {
    console.error(
      `\nFAILURE: GraphQL HTTP ${res.status}.`,
      JSON.stringify(json?.errors ?? json, null, 2)
    );
    process.exit(1);
  }
  return json.data;
}

// ── Already there? ───────────────────────────────────────────────────────────
const existing = await graphql(
  `query QaDefinition {
     metafieldDefinitions(first: 1, ownerType: PRODUCT, namespace: "custom", key: "qa") {
       nodes { id name type { name } access { storefront } }
     }
   }`
);
const found = existing.metafieldDefinitions?.nodes?.[0];
if (found) {
  console.log(
    `OK: definition already exists (${found.id}) — name "${found.name}", type ${found.type?.name}, storefront access: ${found.access?.storefront ?? "unknown"}.`
  );
  if (found.access?.storefront !== "PUBLIC_READ") {
    console.log(
      "NOTE: storefront access is NOT PUBLIC_READ — the theme cannot read it. " +
        "Enable it: Shopify Admin → Einstellungen → Benutzerdefinierte Daten → Produkte → Q&A → Storefront-Zugriff aktivieren."
    );
  }
  process.exit(0);
}

// ── Create ───────────────────────────────────────────────────────────────────
const data = await graphql(
  `mutation CreateQaDefinition($definition: MetafieldDefinitionInput!) {
     metafieldDefinitionCreate(definition: $definition) {
       createdDefinition { id name }
       userErrors { field message code }
     }
   }`,
  {
    definition: {
      name: "Q&A",
      namespace: "custom",
      key: "qa",
      description:
        "Vom motion sports Team beantwortete Kundenfragen (Wissens-Feature). " +
        'JSON-Liste: [{"q":"Frage","a":"Antwort"}]. Wird vom Admin-Backend ' +
        "(Wissen-Tab) geschrieben — nicht manuell bearbeiten.",
      type: "json",
      ownerType: "PRODUCT",
      pin: true,
      access: { storefront: "PUBLIC_READ" },
    },
  }
);

const result = data.metafieldDefinitionCreate;
const taken = (result.userErrors ?? []).some((e) => e.code === "TAKEN");
if (taken) {
  console.log("OK: definition already exists (created concurrently) — nothing to do.");
  process.exit(0);
}
if (result.userErrors?.length) {
  console.error(
    "\nFAILURE: metafieldDefinitionCreate userErrors:",
    JSON.stringify(result.userErrors, null, 2),
    "\nIf the code is ACCESS_DENIED / a scope error: the app needs write_products."
  );
  process.exit(1);
}

console.log(
  `SUCCESS: created product metafield definition "custom.qa" (${result.createdDefinition.id}) ` +
    "with storefront access PUBLIC_READ and pinned it. " +
    "It now appears on every product page in the Shopify admin under Metafelder → Q&A."
);
