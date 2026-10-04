# Frontend task — Renew the attribution token after a live consultation; blank the cart marker when the session ends (2026-10, after the backend PR for ATTR-TOKEN-LIFETIME)

Paste into the frontend agent that owns `ms_shopify_clone`. Attach: `docs/API_CONTRACT.md` (§10, §5 server-only table), `docs/ORDER_ATTRIBUTION.md` (§Widget), `docs/frontend-handoff/WIDGET_SPEC.md`.
Where this prompt and the attached files disagree, the files win.

## Baseline
Builds on widget `main` at `3e87341` (live since 2026-10-04, MANIFEST 2026-10-04 b).
- The widget mints `POST /api/attribution/token` only when no token is cached for the current sid (`moAttrEnsure()`; docs/frontend 06 §8.2, §8.4).
- It re-stamps the cached token on every page load (`initAttribution()`, 05 §10.2), and the sid has no expiry (06 §8.7). A device whose token the backend deleted keeps stamping that dead token until the sid rotates.
- `moAttrReset()` drops the cache on rotation, but the `_mo` already on the Shopify cart stays (06 §8.5).

## Goal and KPI
- **Task 1:** a device whose token was deleted gets a fresh token on its next live product consultation. Deletion causes: backend retention, 37 days after the device's last product consultation or at most 180 days after minting. KPI: „Mo-zugeordneter Umsatz“ rows „Beraten & gekauft“ and „Beraten, anderes gekauft“. The note „Markierte Bestellungen ohne Zuordnung“ (`unknown_token`) on the KPI tab should fall.
- **Task 2:** privacy hygiene on shared browsers. The cart stops carrying a marker of a session that signed out, was erased, was ended by the server, or whose analytics consent was withdrawn. KPI: none (it removes possible misattribution; not measurable).

## Contract references
- AC §10 `POST /api/attribution/token`: headers `x-ms-chat-key` + `x-ms-session`, no body; response `{ ok, token, cartAttributes }`; error table 400/401/403/429/503. After the backend PR: "returns the same token while it exists; after a purge or erasure, a new one".
- ORDER_ATTRIBUTION §Widget steps 1–4.
- AC §5 server-only table (no new event).

## Backend state
- No contract change.
- The endpoint already mints a new token when the (session, `widget`) row is gone (`mintAttributionToken`). Deployed since migration 0042.
- The backend switch `MO_ATTRIBUTION_SESSION_ANCHOR` is independent: this task helps with it on or off.
- No-op if the widget ships later: a renewal call returns the same token while it exists.
- Rate limit: shared `kpi` bucket. One extra call per page view at most.

## Rules that do not change
- No mint, renewal or stamp unless `window.Shopify.customerPrivacy.analyticsProcessingAllowed() === true` (`moAnalyticsAllowed()`), re-checked at stamp time.
- The raw sid never goes into a cart attribute or URL. Only the server's `cartAttributes`, passed through unchanged as a flat object.
- KPI events: ids and enums only; never the token. Never send server-only events (README rule 8). This task adds no event.
- Fail silent: never block chat or shopping.
- Unknown tools render nothing (unchanged).

## Tasks (in order)

### 1. Renew the token after a live product consultation (required)
- **Where:** `ms-chat-widget.js → finalizeStream()`. When a streamed assistant turn finishes without `streamErrored`, call a new `moAttrRenew()` next to `moAttrEnsure()`.
- **Trigger and timing:** all of these must hold:
  - the finished assistant message contains a part of type `tool-show_product`, `tool-compare_products`, `tool-add_to_cart` or `tool-suggest_showroom` (the backend's consultation tools);
  - `moAttrLoad()` returns a cached token for the current sid;
  - `moAnalyticsAllowed()` is true.

  At most once per page view (`moAttrRenewed`). Never from restored history (`renderRestoredAssistant()`), never from `initAttribution()`. Without a cached token, nothing changes: the `show_product` render mints as today.
- **Request:** `POST {apiBase}/api/attribution/token`, headers `x-ms-chat-key` + `x-ms-session`, no body, no `Content-Type` (as 06 §8.2). Single-flight via `moAttrInflight`. Capture `sid` before the fetch.
- **Response handling:**

  | status | widget behaviour | KPI |
  |---|---|---|
  | 200, `moAttrValid()`, token ≠ cached | if the sid is unchanged: write `moAttr` and `localStorage['ms-mo-attr'] = {sid, token, cartAttributes}`, then `moStampCart()` (consent re-checked) | none |
  | 200, same token | nothing | none |
  | 200 invalid, 400/401/403/429/5xx, network | keep the cached token; no retry this page view; do **not** set `moAttrFailed` (the „Zur Kasse“ path keeps stamping the cached token) | none |
  | any, sid changed meanwhile (`onSidChangedElsewhere()`, rotation) | drop the response (05 §10.3 race) | none |

- **UI strings:** none.
- **Storage:** `ms-mo-attr` (existing key, overwritten); in-memory `moAttrRenewed` (page view).
- **KPI:** none. The backend reads the effect from `mo_order_marker_unresolved {reason:'unknown_token'}` and its V4 check. No new names; nothing collides with `%cart%` / `%checkout%`.
- **Failure mode:** fail silent.
- **Edge cases:**
  - stream aborted by a new chat or by opening a conversation (`abortActiveStream()`) → no renewal;
  - signed-in and anonymous behave the same;
  - voice mode the same;
  - `/en` the same;
  - a consent banner still loading (API missing) → no renewal on this page view;
  - several product turns on one page → one call.

### 2. Blank the cart marker when the session ends or consent is withdrawn (recommended; the lawyer's answer to F-37 may make it required)
- **Where:**
  - In `signOut()`, `clearAfterErase()` and `endedSignInCleanup()`, before `dropSessionHistory()` / `rotateSession()` → `moAttrReset()` clears the cache.
  - In the `visitorConsentCollected` listener in `initAttribution()`, when `moAnalyticsAllowed()` is now false and a token is cached.
- **Not** on anonymous „Neuen Chat starten“ or `mo_new=1`: the same person keeps shopping, and the backend window bounds it.
- **Request:** `fetch('/cart/update.js', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ attributes: blanked }), keepalive:true })`. `blanked` has every key of the cached `cartAttributes` with value `""`. Same origin, fire-and-forget. Without a cached entry, skip: the widget does not hard-code the key.
- **Consent gate:** not gated. It removes a marker and sends nothing for analytics.
- **Response handling:** none (fail silent). Verify once on live that `/cart.js` no longer lists `_mo` after the call, i.e. that Shopify removes an attribute set to an empty string.
- **UI strings:** none.
- **Storage:** none new.
- **KPI:** none.
- **Edge cases:**
  - erase answered with 401 → still blank, then clean up;
  - another tab rotated first → its cache is gone, skip;
  - a cart already ordered (empty) → harmless.

## Legal constraints
- Task 1 calls the endpoint only with analytics consent and only after a live chat turn (an interaction), so it adds no interaction-free call (05 §13.3).
- Task 2 deletes a marker; nothing leaves the browser except the same-origin cart update.
- No served copy, no `lawyerApproved` / `enLegalReviewed` surface.
- Context: ANWALTSDOSSIER §20, F-37.

## Deployment
Files to upload: `assets/ms-chat-widget.js`. Shared files to hand-edit: none. MANIFEST entry required. Switches to flip after the live check: none (independent of `MO_ATTRIBUTION_SESSION_ANCHOR`).

## Acceptance checklist
- [ ] Harness, mock token endpoint returns token A, then B. With A cached, a streamed `show_product` turn sends exactly one POST with `x-ms-chat-key` + `x-ms-session` and no body; the cache becomes B; one `/cart/update.js` with `{attributes:{_mo:B}}`.
- [ ] A second product turn on the same page view → no second POST. A compare-only or showroom-only turn with a cached token → one POST.
- [ ] Same token returned → no cache write, no extra stamp.
- [ ] Page load with restored history containing product cards → no renewal POST.
- [ ] `analyticsProcessingAllowed() === false` or the API is missing → no POST, no stamp.
- [ ] 401/403/429/503 or network on renewal → cache unchanged; „Zur Kasse“ still stamps the cached token.
- [ ] Sid rotated while the POST is in flight → response ignored, cache of the new sid untouched.
- [ ] Task 2: sign-out, erase and server-ended sign-in → one `/cart/update.js` with `{attributes:{_mo:""}}` before the reset; anonymous „Neuen Chat starten“ → none; consent withdrawn via the banner → one blank call.
- [ ] Live: the backend deletes a test token by hand (`DELETE FROM mo_attribution_tokens WHERE token = '<test>'`). The next product turn writes a new token to `ms-mo-attr`, and `/cart.js` shows the new `_mo`.
- [ ] Harness: new checks added and passing in DE + EN, 1280 + 390.
- [ ] No console errors; no new hard-coded legal text; no pre-selection; no server-only events; no new KPI event.
- [ ] Screenshots: none (no visible surface changes); state so in the PR.
```

---

