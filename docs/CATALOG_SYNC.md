# Catalog sync

The chat backend's product catalog and its embeddings used to be committed
files (`src/data/product-catalog.json`, `src/data/product-embeddings.json`).
That coupled every catalog change to a redeploy.

This document describes the new flow: a scheduled cron pulls the live catalog
from Shopify and writes both files to Vercel Blob, where the runtime picks
them up on the next warm invocation.

## Files in play

| File                                          | Role                                                    |
| --------------------------------------------- | ------------------------------------------------------- |
| `scripts/verify-shopify-auth.mjs`             | Standalone check that the Shopify auth grant works.    |
| `src/lib/shopify.ts`                          | Token cache + GraphQL pagination.                       |
| `src/lib/catalog-mapping.ts`                  | Shopify product → `Product` type (mirrors Path A rules).|
| `src/lib/catalog-store.ts`                    | Loader: Blob first, bundled JSON fallback. Cached.      |
| `src/app/api/cron/sync-catalog/route.ts`      | Cron handler. Fetch → filter → map → embed → write Blob.|
| `vercel.json`                                 | Cron schedule (`0 3 * * *`, i.e. 03:00 UTC daily).      |

## Shopify auth (Jan-2026 model)

As of January 2026 the Shopify admin no longer issues a static `shpat_…`
Admin API access token. Apps created in the Developer Dashboard get a
**Client ID** and **Client Secret** (`shpss_…`). The backend exchanges these
for a **short-lived Admin API token** at runtime via the OAuth
**client-credentials grant**, then sends the token in
`X-Shopify-Access-Token` on each Admin API call.

- Token endpoint: `POST https://{store}.myshopify.com/admin/oauth/access_token`
- Body (form-urlencoded): `grant_type=client_credentials`, `client_id`, `client_secret`
- Response: `{ access_token, scope, expires_in }`
- TTL: ~24h. `src/lib/shopify.ts` caches the token in process memory and
  refreshes 5 minutes before expiry.

The client-credentials grant only works for apps **owned by your
organization** and installed on **stores in the same organization**.

Reference: shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
(verified working against Admin API `2026-04` on 2026-05-28).

## Required env vars

See `.env.example` for the full list. Catalog sync needs:

```
SHOPIFY_STORE_DOMAIN     # e.g. motion-sports.myshopify.com (NOT motionsports.de)
SHOPIFY_CLIENT_ID
SHOPIFY_CLIENT_SECRET    # shpss_…
SHOPIFY_API_VERSION      # e.g. 2026-04
BLOB_READ_WRITE_TOKEN    # @vercel/blob token (also picked up automatically on Vercel)
CRON_SECRET              # protects /api/cron/sync-catalog
OPENAI_API_KEY           # used to regenerate embeddings
```

## Verifying auth works (run this first)

Before relying on the sync, prove the token exchange works:

```bash
npm run verify:shopify
```

The script POSTs to the token endpoint, then makes one minimal
`{ shop { … } }` GraphQL call. It prints either `SUCCESS` with the granted
scope, token TTL and shop fields, or `FAILURE` with the HTTP status, the
raw Shopify error body, and the most likely cause (wrong scope, app not
installed on the store, wrong API version, etc).

Required scope: `read_products` (or `write_products`, which implicitly
covers reads).

## How the runtime reads the catalog

`src/lib/catalog-store.ts`:

1. If `BLOB_READ_WRITE_TOKEN` is set, list Blob for the stable keys
   `catalog/product-catalog.json` and `catalog/product-embeddings.json`
   and load whichever exist.
2. Otherwise (or if either key is missing), fall back to the JSON committed
   in `src/data/`.
3. Cache the parsed result in module memory. Across a warm Lambda the read
   is amortized to a single fetch.

`src/lib/retrieval.ts` calls `loadProductCatalog()` / `loadEmbeddings()` on
every chat turn, so a fresh deploy + a successful cron run is enough to swap
the catalog without redeploying code. If embeddings are empty (e.g. OpenAI
key was absent at sync time), the existing keyword-search fallback in
`retrieve()` still works.

## Triggering the cron manually after deploy

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-deployment>/api/cron/sync-catalog
```

Response is a JSON summary with `mode` (`shopify` or `fallback-bundle`),
`productCount`, `embeddingsCount`, the Blob URLs, and timing. Check Vercel
function logs for the detailed filter-stats breakdown.

The route accepts `GET` and `POST` — Vercel Cron uses GET by default; the
schedule in `vercel.json` runs daily at 03:00 UTC.

## Rolling back to committed JSON

The bundled `src/data/product-catalog.json` and
`src/data/product-embeddings.json` files are still in the repo and act as
the fallback. To force the runtime to use them:

1. Remove `BLOB_READ_WRITE_TOKEN` from the Vercel project (Settings → Env).
2. Redeploy. The loader will skip the Blob lookup and import the JSON
   directly.

Alternatively, delete the two Blob keys (`catalog/product-catalog.json`,
`catalog/product-embeddings.json`) via the Vercel dashboard. The next warm
invocation will fall through to the bundled JSON.

## Fallback when Shopify auth is broken

If the cron's call to `fetchAllProducts()` throws (e.g. the grant stops
working, scope is revoked, or the Admin API returns an error), the route
catches the error, switches into `mode: "fallback-bundle"`, and uses the
committed JSON as the source of truth — embeddings are still regenerated
from it. This keeps the deployment healthy even when Shopify is degraded.

If the auth flow itself cannot be made to work at all, see
`docs/SHOPIFY_AUTH_BLOCKER.md` (created lazily when first hit).
