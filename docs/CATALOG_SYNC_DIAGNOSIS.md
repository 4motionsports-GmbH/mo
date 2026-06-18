# Catalog Sync 503 — Diagnosis (read-only)

**Date:** 2026-06-18
**Scope:** `GET /api/cron/sync-catalog` returning **503 after ~40s** in production
(Vercel cron fires correctly; function runs; fails mid-execution; ~356 MB RSS;
host `mo-<hash>.vercel.app`, region `iad1`).
**Status:** Diagnosis only — **no code changed.** Reasoning is from the code
(I do not have the live Vercel logs / Sentry event); the "How to confirm in 5
minutes" section below pins down which of the ranked hypotheses is the actual one.

---

## TL;DR

1. **The 503 cannot come from Shopify, the DB, or pgvector.** The Shopify
   fetch+map is wrapped in a try/catch that *degrades to the bundled catalog
   and returns HTTP 200* (`mode:"fallback-bundle"`). This route **never touches
   Postgres/Neon/pgvector at all** — the catalog and its embeddings are stored
   as **JSON files in Vercel Blob**, and retrieval does in-memory cosine. So a
   Neon migration / missing column / pgvector-not-installed issue is **not
   applicable to this route.**
2. **A 503 can only originate from the unguarded tail** of the handler:
   `writeCatalogToBlob` → `embedAll` (OpenAI) → `writeEmbeddingsToBlob`. The
   route deliberately returns a 503 envelope for any error thrown there
   (added in PR #91 to "match the other three crons").
3. **Most likely root cause (ranked #1): the OpenAI embeddings call throws and
   takes the whole sync down.** `embedAll` is **all-or-nothing** — a single
   failed chunk (rate-limit / quota / transient 5xx) throws and 503s
   everything. The ~40s fits **Shopify pagination (≈33 sequential pages at
   30/page) completing first, then the first/early embeddings chunk failing.**
   Exact call: `client.embeddings.create(...)` at
   `src/app/api/cron/sync-catalog/route.ts:40`.
4. **The sync is NOT atomic.** The catalog blob is written **before** embeddings
   are generated. If embeddings fail, you are left with a **fresh catalog +
   stale/mismatched embeddings** — a silent semantic-search regression, not a
   clean outage. (See "Is the catalog stale/partial?")
5. **Cron region is `iad1` (US)** with **no region override anywhere** in the
   repo — a data-residency flag for an EU business, and it also adds
   cross-Atlantic latency to every (EU) Shopify and Neon call, inflating the
   ~40s window.

---

## 1. Pipeline map — every external call and where a failure surfaces

Handler: `src/app/api/cron/sync-catalog/route.ts` (`handle()`, line 68).
`maxDuration = 300` (route.ts:29) — so this is **not** a platform timeout
(~40s of a 300s budget).

| # | Step | Code | External call | Guarded? | Failure surfaces as |
|---|------|------|---------------|----------|---------------------|
| 0 | Cron auth | `requireCronAuth` route.ts:69 | none (HMAC compare) | n/a | **401** (not our 503) |
| 1 | Fetch products | `fetchAllProducts()` route.ts:80; `src/lib/shopify.ts:445` | **Shopify Admin GraphQL** — token exchange (shopify.ts:56) + **~33 sequential pages** at `first:30` (shopify.ts:265) | **YES** (try/catch route.ts:79-93) | **NOT a 503.** Caught → `mode:"fallback-bundle"`, uses `src/data/product-catalog.json`, logs `shopifyError`, continues, returns **200** |
| 2 | Map/filter | `mapShopifyProducts()` route.ts:81; catalog-mapping.ts:139 | none (pure) | inside same try | Same as #1. Also: if mapping yields 0 kept, route.ts:84 throws → still caught → fallback |
| 3 | Write catalog | `writeCatalogToBlob()` route.ts:95-97; catalog-store.ts:112 | **Vercel Blob `put`** (~4.8 MB JSON) | **NO** | **503** (outer catch route.ts:128) |
| 4 | Embeddings | `embedAll()` route.ts:102; route.ts:34-50 | **OpenAI `embeddings.create`** — **~10 chunks** of 100 (route.ts:32,40) | **NO** | **503** (outer catch) |
| 5 | Write embeddings | `writeEmbeddingsToBlob()` route.ts:104-106; catalog-store.ts:127 | **Vercel Blob `put`** (~28 MB JSON) | **NO** | **503** (outer catch) |
| 6 | Invalidate cache | `invalidateCache()` route.ts:111 | none (clears *this* lambda's memory only) | n/a | — |
| 7 | Error envelope | route.ts:128-135 | `reportError` → Sentry (non-throwing, observability.ts:141) | n/a | returns `{ok:false,error}` **503** |

**Key structural fact:** steps 1–2 (Shopify) are wrapped and *self-heal to the
bundled catalog*; steps 3–5 are **not** wrapped. **Therefore an observed 503
means the failing call is a Blob write or the OpenAI embeddings call — not
Shopify.** A Shopify problem would show up as a **200 with
`mode:"fallback-bundle"` and a `shopifyError` field**, never a 503.

Data scale (from committed snapshot, proxy for live): **965 products**,
embeddings `text-embedding-3-small`, dim 1536, 965 items
→ Shopify **≈33 pages** (30/page), embeddings **10 chunks** (100/chunk).

---

## 2. Most likely cause of a 503 after 40s — ranked

> I cannot see the production Sentry event, so this is ranked by code structure
> + the timing/symptoms. The exception **class** in Sentry (tagged
> `route: api/cron/sync-catalog`) will confirm #1 vs #2 instantly — see §5.

### #1 — OpenAI embeddings throws; `embedAll` is all-or-nothing (MOST LIKELY)
- `embedAll` (route.ts:34-50) loops chunks with **no per-chunk try/catch**. Any
  single `embeddings.create` rejection throws out of the whole function →
  outer catch (route.ts:128) → **503**, and **zero embeddings are written.**
- **Timing fit is strong:** the ~40s is dominated by the (successful) Shopify
  pagination — ~33 sequential GraphQL round-trips to an EU store from a US
  region (iad1) is easily ~30–38s — after which `writeCatalogToBlob` succeeds
  (~1–2s) and then the **first/early embeddings chunk fails at ~40s.**
- **Most probable sub-cause:** HTTP **429** — either genuine rate-limit
  (TPM/RPM on `text-embedding-3-small`) or, very commonly in practice,
  **`insufficient_quota`** (billing/credits). The OpenAI SDK auto-retries 429/5xx
  a couple of times with backoff, so the *throw* lands a few seconds after the
  first attempt — consistent with "fails while calling an external API at ~40s."
  A transient OpenAI **5xx** that outlives the SDK's default retries fits too.
- **Lower-probability sub-cause — "request exceeds limits":** unlikely here.
  `buildEmbeddingDoc` (catalog-mapping.ts:298) trims the description to 240 chars
  and ≤12 features, so no single input approaches the 8192-token per-input cap,
  and 100 small docs (~tens of k tokens) stay well under the per-request batch
  cap. Discount this unless logs say otherwise.
- **Exact failing call:** `client.embeddings.create({ model, input })`
  **route.ts:40**, invoked from route.ts:102, thrown to route.ts:128, returned
  503 at route.ts:134.

### #2 — Vercel Blob write throws (catalog or embeddings)
- `writeCatalogToBlob` (route.ts:96) is the **first unguarded call** after
  Shopify; `writeEmbeddingsToBlob` (route.ts:105) is the last. Either `put`
  throwing → 503. Plausible triggers: `BLOB_READ_WRITE_TOKEN` present but
  invalid/expired, or a transient `@vercel/blob` error.
- Slightly less likely than #1 given "fails while calling external APIs" + the
  40s profile, but it **cannot be ruled out from code alone** — confirm via the
  Sentry exception class (`BlobError`/`BlobAccessError` vs OpenAI `APIError`).

### #3 — Shopify (throttle / scope / shape change on 2026-04): NOT a 503 cause
- Important correction: Shopify problems are **caught and degraded** (route.ts:79-93),
  so they produce a **200 with `mode:"fallback-bundle"`**, not a 503. So:
  - **If logs show 503 → Shopify is exonerated as the proximate cause.**
  - Shopify is, however, the **most likely consumer of the ~40s** and a likely
    cause of a **silently stale catalog** (see §4). `graphql()` throws on the
    first `errors[]` entry (shopify.ts:139) — including a `THROTTLED` response —
    *without retrying*, so a throttle would actually fail **early** and fall
    back, not burn 40s. The page size was already tuned down to 30 to stay under
    the 1000 cost ceiling (shopify.ts:260-265), so MAX_COST_EXCEEDED is unlikely.
- Net: worth checking the cron's JSON `mode` field and `shopifyError`, but it is
  not what returns the 503.

### #4 — DB / Neon / pgvector: NOT APPLICABLE to this route
- `sync-catalog/route.ts` does **not import `@/lib/db` / `getSql`** and makes no
  SQL call. Embeddings are **Blob JSON** (catalog-store.ts:127) consumed by an
  in-memory `Map` + hand-rolled `cosine()` (`src/lib/retrieval.ts:38`); the only
  `vector` in the repo is the JSON data file, **not pgvector**. There is no
  catalog/embedding table in `migrations/` (latest is `0029_drop_bestandskunden`).
- A Neon migration / missing column / pgvector issue would surface in the
  **DB-backed crons** (`refresh-customers`, `retention`, `expire-bundles`) — **not
  here.** If those are also failing, that's a separate investigation.

### #5 — Memory / OOM: ruled out
- ~356 MB RSS is **well under** the Vercel function memory limit (default 1769 MB).
  Holding the 965-product catalog + the 965×1536 embedding array + Shopify
  responses at ~356 MB is expected and safe. OOM is not the trigger.

---

## 3. Cron configuration

### (a) Does it target the correct production deployment/domain?
- `vercel.json` (lines 3-20) schedules `/api/cron/sync-catalog` at `0 3 * * *`
  (03:00 UTC daily). The path matches the route. **Vercel Cron only runs against
  the project's current Production deployment**, invoking the auto-generated
  deployment URL — so the log host **`mo-<hash>.vercel.app` is expected and not a
  misconfiguration by itself** (cron does not use a custom domain). The function
  *is* running, which confirms routing/auth are fine.
- **To confirm (dashboard):** Vercel → Project → Settings → Cron Jobs — verify
  crons are **enabled on Production and not paused**, and the deployment behind
  the alias is the intended live one. Nothing in the repo indicates a wrong
  target.

### (b) Region — `iad1` (US East). FLAG.
- **There is no region pin anywhere:** no top-level `"regions"` in `vercel.json`,
  no `export const preferredRegion` in any route, nothing in `next.config.ts`.
  The function therefore inherits the **Vercel project default region, `iad1`
  (Washington DC, US)** — matching the log.
- **Data-residency flag (EU business):** the store is German (`motionsports.de`),
  Neon is EU, and the GDPR posture (`docs/LEGAL_READINESS_REPORT.md`) lists
  processors with `[confirm regions]`. `sync-catalog` itself handles **product
  catalog** data (not personal data, so lower sensitivity) — but the **same
  default `iad1`** applies to `refresh-customers` / `retention`, which **do**
  process EU personal data from the EU Neon DB **in a US region**. That is the
  more serious residency concern surfaced by this same gap. Additionally, this
  route's **OpenAI embeddings calls egress to OpenAI US** (`new OpenAI()`,
  route.ts:35 — default `api.openai.com`, no EU base URL).
- **Performance side-effect:** running in `iad1` while Shopify (EU) and Neon (EU)
  are across the Atlantic adds ~80–150 ms RTT to **each** of the ~33 Shopify
  pages — directly inflating the ~40s and widening the failure window. Pinning
  to **`fra1` (Frankfurt)** would help **both** residency and wall-time.
- **No auto-retry:** Vercel Cron does **not** retry a failed invocation, so a
  503 means that day's sync is simply lost until the next 03:00 UTC run — this
  compounds staleness (see §4).

---

## 4. Is the sync idempotent / resumable — is the current catalog stale or partial?

**Not atomic, not resumable; each run is a full replace.** The two blobs are
written at different points with no transaction:

- Order: **catalog blob first** (route.ts:95-97), **then** generate embeddings
  (route.ts:102), **then** embeddings blob (route.ts:104-106). Both use stable
  keys with `allowOverwrite:true` (catalog-store.ts:118-122) — i.e. a **full
  overwrite**, not an incremental per-product upsert.

**Consequences by failing call:**

- **If embeddings fail (hypothesis #1):** the **catalog blob is already
  updated (FRESH)** but the **embeddings blob is NOT (STALE)**. Result —
  *inconsistent pair*:
  - new/renamed products have **no vector** → they won't surface in semantic
    retrieval (they fall through to the keyword-search fallback in
    `retrieval.ts:160`);
  - removed products may still carry **stale vectors** whose ids no longer
    resolve against the fresh catalog;
  - prices / stock / cards are **fresh**, but **semantic-search recall is
    silently degraded.** This is a quality regression, not a visible outage.
- **If the catalog Blob write fails (hypothesis #2):** nothing is written this
  run → **both blobs frozen** at the last good state (or the bundled
  `src/data/*.json` if the keys never existed). Catalog fully **stale** (up to N
  days), but internally consistent.

**Self-healing, with a caveat:** because every run does a full replace, the
**next successful run fully reconciles both files** — no permanent corruption,
no resume needed. But there is **no atomicity**, so the inconsistent window
**persists for the entire duration of the failure** (daily cron + no retry →
potentially many days).

**Verdict on "can we trust the current catalog?":** Treat it as **suspect until
a run returns `ok:true`.** The **most likely live state is: catalog FRESH but
embeddings STALE/mismatched** (if embeddings is the failing call) — so Mo's
*recommendations* (semantic search) are running on an out-of-date vector set even
though *prices and stock on the cards are current*. Confirm by reading back the
two Blob keys' timestamps (see §5).

Minor: `invalidateCache()` (route.ts:111) only clears the **current lambda's**
memory; other warm lambdas keep serving their cached snapshot for up to
`CACHE_TTL_MS = 60_000` (catalog-store.ts:23) — negligible.

---

## 5. How to confirm in ~5 minutes (no code change)

1. **Read the Sentry event** tagged `route: api/cron/sync-catalog`
   (reportError, route.ts:133). The **exception class** disambiguates instantly:
   - OpenAI `APIError` / `RateLimitError` / message `insufficient_quota` → **#1**.
   - `BlobError` / `BlobAccessError` → **#2**.
2. **Read the Vercel function log** for the 03:00 UTC run. Even on a 503 the
   inner block logs `shopifyRawCount`, `filterStats`, and (on Shopify failure)
   `shopifyError`. If `mode` reached `fallback-bundle`, Shopify degraded but did
   **not** cause the 503 — the failure is in embeddings/blob.
3. **Manually re-run** (from `docs/CATALOG_SYNC.md`) and read the JSON envelope:
   ```bash
   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
     https://<prod-deployment>/api/cron/sync-catalog
   ```
   `{ok:false,error:"..."}` echoes the exact thrown message.
4. **Check the two Blob keys' timestamps** (`catalog/product-catalog.json` vs
   `catalog/product-embeddings.json`) in the Vercel Blob dashboard. If catalog is
   recent but embeddings is days old → confirms the **fresh-catalog /
   stale-embeddings** partial state from §4.
5. **Check the OpenAI dashboard** for `text-embedding-3-small` 429s /
   `insufficient_quota` / billing status around 03:00 UTC.

---

## 6. Smallest robust fix (recommended — NOT applied)

In priority order; (1) alone removes the outage, (2) removes the partial-state
risk.

1. **Make `embedAll` resilient (highest leverage).** Wrap each chunk in
   try/catch; on a chunk failure, retry it as smaller sub-batches / per item,
   and for any item that still fails **carry forward its previous vector from
   the existing embeddings blob** (or skip it) instead of throwing. **One bad
   item/chunk must never 503 the whole sync.** This directly fixes the #1
   all-or-nothing failure mode.
2. **Make the write atomic / correctly ordered.** Generate embeddings **before**
   writing *either* blob, then write **both** at the end (or write to temp keys
   and swap). This eliminates the fresh-catalog / stale-embeddings window from §4.
3. **Harden the OpenAI call.** Set an explicit `maxRetries` and a small
   inter-chunk delay to respect TPM/RPM; surface `insufficient_quota` distinctly
   (it's a billing fix, not a code fix). Verify the OpenAI account tier/credits.
4. **Pin the region to `fra1`** via `vercel.json` `"regions": ["fra1"]` (applies
   to all crons) — fixes the data-residency flag for the personal-data crons and
   cuts the EU↔US latency that inflates the ~40s here. Separately review an EU
   data option for OpenAI.
5. **Optional resilience:** reduce Shopify pagination wall-time (raise page size
   where the query cost allows, and/or honor `throttleStatus` for backoff) so
   the function spends less of its budget in sequential round-trips.

---

## Appendix — evidence (file:line)

- Handler + 503 envelope: `src/app/api/cron/sync-catalog/route.ts:68`, catch+503 `:128-135`, `maxDuration=300` `:29`.
- Shopify guarded + fallback: route.ts:79-93; "no products" throw route.ts:84.
- Unguarded tail: `writeCatalogToBlob` route.ts:95-97; `embedAll` route.ts:102 (`embeddings.create` `:40`, chunk=100 `:32`); `writeEmbeddingsToBlob` route.ts:104-106.
- Shopify pagination 30/page: `src/lib/shopify.ts:265`; fetch loop `:445-491`; `graphql()` throws on `errors[]` `:139`, on `!res.ok` `:134`; token exchange `:56-87`; pinned API version env `:33-40`.
- Blob store (overwrite stable keys; 60s cache TTL): `src/lib/catalog-store.ts:112-137`, `:23`.
- Retrieval = in-memory cosine + keyword fallback (no pgvector): `src/lib/retrieval.ts:22,38,160`.
- DB driver (Neon) — not imported by this route: `src/lib/db.ts:19-50`.
- Cron schedule, no region pin: `vercel.json:3-20`; no `preferredRegion`/`regions`/`next.config.ts` region (grep: none).
- reportError → Sentry, non-throwing: `src/lib/observability.ts:141-162`.
- Data scale: `src/data/product-catalog.json` (965 products, 4.8 MB), `src/data/product-embeddings.json` (965 items, dim 1536, 28 MB).
- Authoritative design doc: `docs/CATALOG_SYNC.md` (Blob-based flow; Shopify client-credentials; API `2026-04`).
