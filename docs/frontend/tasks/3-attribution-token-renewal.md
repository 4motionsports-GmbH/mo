# Frontend task 3 — Renew the attribution token after a live consultation; blank the cart marker when the session ends (backend deployed 2026-10-05)

For the frontend agent that owns `ms_shopify_clone`. Attachments: see the prompt. The contract is `API_CONTRACT.md` (§10, §0, §5), `ACCOUNT_CONTRACT.md` and `CONSENT_CONTRACT.md`; where this task and a contract file disagree, the contract file wins.

References marked "(background: …)" point into the backend repo; its chapters `docs/frontend/01`–`07` are the backend's code-verified description of your widget. They are background in the backend repo, not attached — everything needed is written out here. In your own repo, the code is the source of truth.

## Baseline
Builds on widget `main` at `3e87341` (live since 2026-10-04, MANIFEST 2026-10-04 b).
- The widget mints `POST /api/attribution/token` only when no token is cached for the current sid (`moAttrEnsure()`; background: `docs/frontend/06` §8.2, §8.4).
- It re-stamps the cached token on every page load (`initAttribution()`; background: `docs/frontend/05` §10.2), and the sid has no expiry (background: `docs/frontend/06` §8.7). A device whose token the backend deleted keeps stamping that dead token until the sid rotates.
- `moAttrReset()` drops the cache on rotation, but the `_mo` already on the Shopify cart stays (background: `docs/frontend/06` §8.5).

## Goal and KPI
- **Task 1:** a device whose token was deleted gets a fresh token on its next live product consultation. Deletion causes:
  - the backend's nightly retention: 37 days after minting (the 30-day attribution window + 7 days) while the backend switch `MO_ATTRIBUTION_SESSION_ANCHOR` is off (the code default); with the switch on, 37 days after the device's last product consultation, at most max(`KPI_RETENTION_DAYS` or 180, 37) days after minting (180 with the defaults);
  - an erasure, at once (API_CONTRACT §11.1).

  KPI (backend): „Mo-zugeordneter Umsatz (Bestell-Webhook)“, rows „Beraten & gekauft“ and „Beraten, anderes gekauft“. The note „… markierte Bestellungen im Zeitraum ohne Zuordnung: … mit unbekannter oder gelöschter Markierung …“ (`unknown_token`) on the KPI tab should fall.
- **Task 2:** privacy hygiene on shared browsers. The cart stops carrying a marker of a session that signed out, was erased, was ended by the server, or whose analytics consent was withdrawn. KPI: none (it removes possible misattribution; not measurable).

## Contract references
- **API_CONTRACT §10** `POST /api/attribution/token`: headers `x-ms-chat-key` + `x-ms-session`, no body; response `{ ok, token, cartAttributes }` with `Cache-Control: no-store`; error table 400/401/403/429/503/500. "Lifetime and renewal": the same token while it exists, a new one after the backend deleted it (retention, erasure); the widget MAY call again after a live product consultation. "Ending the marker": blank every key of the cached `cartAttributes` with `""` when the session ends or analytics consent is withdrawn (SHOULD).
- **API_CONTRACT §5:** this task adds no event; the server-only names (rule 14) stay unsent.
- **API_CONTRACT §0:** rule 7 (raw sid never in a cart attribute or URL; attribution only with analytics consent), rule 13 (KPI data), rule 14 (server-only events), rule 18 (fail silent).
- **ACCOUNT_CONTRACT §5.1:** when a sign-in ends (sign-out, erase, a sign-in the server reports ended), the widget drops the stored chat and continues on a fresh sid — task 2 blanks the marker before that.

## Backend state
- Deployed on 2026-10-05 (backend `main`): with the backend switch `MO_ATTRIBUTION_SESSION_ANCHOR` (default off in code) on, the 30-day attribution window counts from the device's latest product consultation instead of the token's minting, and widget tokens of devices that keep consulting are kept (up to the cap above). Marked orders the backend cannot attribute are counted (server-only `mo_order_marker_unresolved`).
- No contract change: the endpoint has always returned the same token while the session's token exists and minted a new one once it is gone (API_CONTRACT §10 "Lifetime and renewal").
- The switch is independent: this task helps with it on or off.
- No-op if the widget ships later: a renewal call returns the same token while it exists.
- Rate limit: shared `kpi` bucket (120 req / 60 s). One extra call per page view at most.

## Rules that do not change
API_CONTRACT §0 applies in full; for this task that means:
- No mint, renewal or stamp unless `window.Shopify.customerPrivacy.analyticsProcessingAllowed() === true` (`moAnalyticsAllowed()`), re-checked at stamp time (rule 7).
- The raw sid never goes into a cart attribute or URL. Only the server's `cartAttributes`, passed through unchanged as a flat object (rule 7).
- KPI events: ids and enums only; never the token (rule 13). Never send server-only events (rule 14; the names are listed in API_CONTRACT §5). This task adds no event.
- Fail silent: never block chat or shopping (rule 18).
- Unknown tools render nothing (unchanged, rule 16).

## Tasks (in order)

### 1. Renew the token after a live product consultation (required)
- **Where:** `ms-chat-widget.js → finalizeStream()`. When a streamed assistant turn finishes without `streamErrored`, call a new `moAttrRenew()` next to `moAttrEnsure()`.
- **Trigger and timing:** all of these must hold:
  - the finished assistant message contains a part of type `tool-show_product`, `tool-compare_products`, `tool-add_to_cart` or `tool-suggest_showroom` (the backend's consultation tools);
  - `moAttrLoad()` returns a cached token for the current sid;
  - `moAnalyticsAllowed()` is true.

  At most once per page view (`moAttrRenewed`). Never from restored history (`renderRestoredAssistant()`), never from `initAttribution()`. Without a cached token, nothing changes: the `show_product` render mints as today.
- **Request:** `POST {apiBase}/api/attribution/token`, headers `x-ms-chat-key` + `x-ms-session`, no body, no `Content-Type` (as today's mint; background: `docs/frontend/06` §8.2). Single-flight via `moAttrInflight`. Capture `sid` before the fetch.
- **Response handling:**

  | status | widget behaviour | KPI |
  |---|---|---|
  | 200, `moAttrValid()`, token ≠ cached | if the sid is unchanged: write `moAttr` and `localStorage['ms-mo-attr'] = {sid, token, cartAttributes}`, then `moStampCart()` (consent re-checked) | none |
  | 200, same token | nothing | none |
  | 200 invalid, 400/401/403/429/5xx, network | keep the cached token; no retry this page view; do **not** set `moAttrFailed` (the „Zur Kasse“ path keeps stamping the cached token) | none |
  | any, sid changed meanwhile (`onSidChangedElsewhere()`, rotation) | drop the response (the sid-rotation race; background: `docs/frontend/05` §10.3) | none |

- **UI strings:** none.
- **Storage:** `ms-mo-attr` (existing key, overwritten); in-memory `moAttrRenewed` (page view).
- **KPI:** none. The backend reads the effect from `mo_order_marker_unresolved {reason:'unknown_token'}` (its V3 check, `npm run verify:live` section 7b). No new names; nothing collides with `%cart%` / `%checkout%`.
- **Failure mode:** fail silent.
- **Render-path race:** a `show_product` card stamps through `moAttrOnProductCard()` after its async `/api/products` hydration, so a render stamp issued with the old token just before the renewal answer arrives can land after the renewal's stamp of the new one. Read the token at stamp time (as `moStampCart()` does through `moAttrLoad()`) and skip the render-path stamp while a renewal is in flight.
- **Edge cases:**
  - stream aborted by a new chat or by opening a conversation (`abortActiveStream()`) → no renewal;
  - signed-in and anonymous behave the same;
  - voice mode the same;
  - `/en` the same;
  - a consent banner still loading (API missing) → no renewal on this page view;
  - several product turns on one page → one call.

### 2. Blank the cart marker when the session ends or consent is withdrawn (recommended — API_CONTRACT §10 "Ending the marker" says SHOULD; the open legal question F-37 may make it required, background: `docs/ANWALTSDOSSIER.md` §20)
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
- Task 1 calls the endpoint only with analytics consent and only after a live chat turn (an interaction), so it adds no interaction-free call (background: `docs/frontend/05` §13.3).
- Task 2 deletes a marker; nothing leaves the browser except the same-origin cart update.
- No served copy, no `lawyerApproved` / `enLegalReviewed` surface.
- Context (background): `docs/ANWALTSDOSSIER.md` §20, F-37.

## Deployment
Files to upload: `assets/ms-chat-widget.js`. Shared files to hand-edit: none. MANIFEST: one entry, shared with tasks 1 and 2 (one upload). Fingerprint: this task adds no marker (see the prompt). Switches to flip after the live check: none (independent of `MO_ATTRIBUTION_SESSION_ANCHOR`).

## Acceptance checklist
- [ ] Harness, mock token endpoint returns token A, then B. With A cached, a streamed `show_product` turn sends exactly one POST with `x-ms-chat-key` + `x-ms-session` and no body; the cache becomes B; one `/cart/update.js` with `{attributes:{_mo:B}}`.
- [ ] A second product turn on the same page view → no second POST. A compare-only or showroom-only turn with a cached token → one POST.
- [ ] Same token returned → no cache write, no extra stamp.
- [ ] A `show_product` card whose `/api/products` hydration resolves while the renewal POST is in flight (no stamp yet on this page view) → no `/cart/update.js` with A is issued after the stamp of B; the last stamp of the page view carries B.
- [ ] Page load with restored history containing product cards → no renewal POST.
- [ ] `analyticsProcessingAllowed() === false` or the API is missing → no POST, no stamp.
- [ ] 401/403/429/503 or network on renewal → cache unchanged; „Zur Kasse“ still stamps the cached token.
- [ ] Sid rotated while the POST is in flight → response ignored, cache of the new sid untouched.
- [ ] Task 2: sign-out, erase and server-ended sign-in → one `/cart/update.js` with `{attributes:{_mo:""}}` before the reset; anonymous „Neuen Chat starten“ → none; consent withdrawn via the banner → one blank call.
- [ ] Live (with the backend, after the upload): the backend deletes a test token by hand (`DELETE FROM mo_attribution_tokens WHERE token = '<test>'`). The next product turn writes a new token to `ms-mo-attr`, and `/cart.js` shows the new `_mo`.
- [ ] Harness: new checks added and passing in DE + EN, 1280 + 390.
- [ ] No console errors; no new hard-coded legal text; no pre-selection; no server-only events; no new KPI event.
- [ ] Screenshots: none (no visible surface changes); state so in the PR.
