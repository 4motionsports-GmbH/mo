# Customer platform rollout — open todos

The owner's living to-do list since the customer platform went live (PR #197 and the
follow-ups #198–#200), and **the one place for live production status**: which migrations ran,
which switches are on in Vercel, what is uploaded to the theme or set up in Shopify. Every other
doc describes behaviour and defaults („default off in code“) and points here for the live state.
Work through it top to bottom; the order is deliberate. Each item says who does it, how, and how
to tell it is done. Ticked items stay in the list until the next clean-up so the history is visible.

**Owners:** **M** = Marcel · **C** = Claude (code, docs, checks) · **F** = the freelancer
who owns the Shopify app · **L** = the lawyer · **FE** = the frontend agent (theme +
widget).
Mo's admin is German; English translations are in brackets.

Last updated: 2026-10-06 late evening (three reworks on the branch, live with the next deploy together with the Verbesserung rework: Kunden profile card, KPI screen, Komplettanalyse as a decision report on the new AI tier `strategist` — Done; one migration `0077` for M; new open list item 3 „Neue Auswertungen prüfen“, new C.30; C.26 OI3 B4 needs the next free migration number); before: 2026-10-06 evening (four C tracks built, no migration, no new switch: consent — owner decision: no ask for a blocked address, OI1 F3; retention gaps + `db:reset`; admin texts and copy; attribution §9.1/§9.2/§4.9 — C.26, C.27; new C.28/C.29; Performance mail design on main `599e2e1`; open list item 1 = re-test after M's popup test of 06.10.); before: 2026-10-06 afternoon (widget checks evaluated: page context live and in use, both switches on since 05.10.; consent-popup check open); before: 2026-10-06 (widget `bc7fb5d` live, C.22 done); before: 2026-10-05 evening (all C items of 05.10. built; open list for M at the top; 5.2 + 5.4
done by M alone on 05.10. (Dev Dashboard + Shopify CLI); C.26 = the open follow-ups of the archived plans;
doc paths follow the new layout — widget docs in `docs/frontend/`, history in `docs/archive/`).

## ▶ Open for M — the one list (06.10.2026, in this order)

Everything below this box is the detailed history and the step-by-step instructions; this box is
the single list of what is still open for M. C's open items are at the end of „C · Claude's tasks“.

1. **Consent popup — works (06.10., M, fresh private window; the earlier miss was the widget's
   per-tab popup memory, D18 confirmed).** To close it (5 min): `npm run verify:live -- --since
   2026-10-06`; with `--session <the test session's 8 characters>` section 3 shows
   `consent_gate_shown` / `_accepted` with `variant: "a"`, `placement: "popup"` and the opt-in with
   `source: "mo_signin"`, `doiSent: true` → send C the output (closes the frontend agent's check 1).
   Then clean up the test customers: „Meine Daten löschen“ in the chat (or Kunden → „Kunde
   vollständig löschen“) and delete them in the Shopify admin (6.2 is off).
   **Second check (5 min):** at the sign-up of 06.10. M ticked the shop's newsletter box (Shopify
   sent its own confirmation mail; Mo recorded no Shopify consent event). About 10 min after such a
   sign-up, re-run the consent diagnosis for that address (Mo's side: Kunden → the address →
   „Werbe-Einwilligung“ → „Verlauf“) and check Shopify admin → Kunden → the address →
   E-Mail-Marketing status. Pending in Shopify but no `shopify` consent event in Mo → Mo misses the
   shop's sign-up consent and would ask again (two confirmation mails) → tell C (C.29).
2. **Live check on 09.10. (5 min).** `npm run verify:live -- --since 2026-10-06` → send C the
   output: section 9 (page-context base rate for the control group, C.23; product clicks by
   `samePage`), section 7b V2/V2b (both must be 0) and V3.
3. **Neue Auswertungen prüfen (nach dem Deploy, ~30 min).** The four reworks of 06.10. (Done) went
   live with C's push to main on 06.10. First `npm run db:migrate` (applies `0077`, the step claim of
   the Komplettanalyse — recommended before the first new report; without it a dropped request can
   start a second Opus call). Then:
   - **KPIs**, „Zeitraum…“ 06.09.–05.10.2026: the channel rows of „Wie der Umsatz entstand“ add up
     to „Umsatz durch Mo“, and no order number appears twice in „Was genau passiert ist“ (an order
     counted twice → tell C); compare three orders with Shopify admin (number, amount, code,
     products) and open their „Kunde öffnen“ / „Gespräch öffnen“; „Aktualisieren“ comes back faster
     (two Shopify queries instead of four).
   - **Analyse:** one Komplettanalyse for 30 days → note the minutes per Opus phase, any note „… im 2.
     Versuch …“ (the 240 s limit was hit, the effort lowered), the cost of the decision part (≈ 0,70 €)
     and the chapter „Seit dem letzten Bericht“. Vercel → Logs: no timeout (504) on
     `/api/admin/analytics/step` — the plan must allow the route's 300 s.
   - **Kunden:** one person with a Vollprofil, one with a Kaufprofil → Überblick: each part of the
     profile text sits in the right card, nothing is missing.
   - **Verbesserung:** one run on the new Komplettanalyse („Maßnahmen importieren“ on) → note the
     minutes per Opus phase (240 s limit), the cost (≈ 0,90 €) and whether „Wirkung“ judges the live
     Anweisungen or says „Zu früh“ / „Tendenz“ (too few analysed chats — C.30).
   Send C the notes; the open questions of the reworks are C.30.
4. **Test order through „Zur Kasse“ (P0.2, 10 min).** In the chat on www.motionsports.de let Mo
   recommend a cheap product, click „Zur Kasse“ on the card, complete the order (cancel/refund it
   afterwards). Shopify admin → the order → „Zusätzliche Details“: is there an `_mo` entry? Tell C
   yes/no (decides the next attribution task, A2).
5. **Optional checks when convenient:** order status once with an account that has orders (6.6);
   one „Einplanen“ campaign card (1.7); one letter on Pingen staging (1.10); „Unzufriedenheit“ in
   the Eingang once (C.9b).
6. **Later, when you decide:** 6.1–6.4 (Shopify accounts for Mo-only subscribers, deletions to
   Shopify, AI profiles for everyone, Shopify tags) and 7.1/7.2 (tuning, Claude GitHub App);
   Black Friday (4.x) when you bring it up; app ownership (5.3); with C, optional: the App Proxy
   handover and shop-logout tests (C.26). Tell F once: run `shopify app config link` before F's next
   `shopify app deploy` (5.4 step 15).
7. **Lawyer / privacy policy (as you update them):** dossier §19 (App Proxy, F-36 answered), §20
   (attribution window, F-37), §21 (consent bullets + page context, F-38); privacy-policy sentences
   F-05/F-28 for shop-login recognition and purchase attribution.

## Done

- [x] Four reworks of 06.10. (C; pushed to main on 06.10. at the owner's request; migration `0077`
  for M, no new switch; checks: open list item 3; open questions: C.30):
  - **Verbesserung:** runs on the business snapshot (a Komplettanalyse's period or 7/30/90 days vs
    the period before), measures live Anweisungen and „Erledigt“ suggestions against snapshot
    metrics with tested significance rules and confounders (`improvement-effects.mjs`), and makes
    decision-grade suggestions per lane (P1–P3, evidence, success metric, link) on Opus 5.5
    (strategist), importing the open recommendations of the chosen Komplettanalyse;
    `docs/IMPROVEMENT_LOOP.md`, screenshots `docs/screenshots/2026-10-06-verbesserung/`.
  - **Kunden → Überblick:** „Aktuelles Kundenverständnis“ is a visual card at the top — persona,
    Vollprofil / Kaufprofil, „Stand … · vor … Tagen“, stale badges; theme cards with „Schwerpunkt“,
    level and budget meters, chips; next steps with kind icons. The profile prompt asks for the most
    important goal and the most urgent step first (older profiles keep their order). Parser
    `src/lib/customer-profile-view.mjs` (tested). `docs/ADMIN_DASHBOARD.md` §3.3.
  - **KPIs:** seven groups, revenue first; new „Umsatz durch Mo“, „Wie der Umsatz entstand“, „Was
    genau passiert ist“, „Vom Chat zur Bestellung“; one order = one tier + one channel. **Owner
    decision 06.10.:** „Umsatz über Mo-Rabattcodes“ and „Mo-zugeordneter Umsatz“ merged into these;
    „Empfehlung → Kauf“, „Marketing-Funnel“, the standalone „Sprachen“ and the „Status-Verteilung“
    removed. `docs/ADMIN_DASHBOARD.md` §3.5, §5.
  - **Analyse:** the Komplettanalyse is a decision report — 12 chapters, owner filter, comparison with
    the previous report, the business snapshot (`docs/BUSINESS_SNAPSHOT.md`), decisions and plan on
    the new AI tier `strategist` (Opus 5.5, effort high; `docs/AI_MODELS.md`), ≈ 0,70 € per report;
    older reports keep their view; the PDF follows the new order. `docs/ADMIN_DASHBOARD.md` §3.8.
  - Screenshots `docs/screenshots/2026-10-06-kundenprofil/`, `docs/screenshots/2026-10-06-kpi/`,
    `docs/screenshots/2026-10-06-analyse/`.
- [x] Code tracks of 06.10. (C; no migration, no new switch — live with their deploy): **owner
  decision 06.10.:** an address on the suppression list (any reason) is never asked after sign-in;
  a capture keeps a signed-in customer's chats; opt-ins record whether the DOI mail went out (OI1
  F3); retention gaps closed on existing windows; `db:reset` works on the current schema; admin
  texts, Systemstatus and copy fixed (C.27); attribution §9.1/§9.2/§4.9 (C.26). KPI release notes
  `doi-mail-sent`, `consent-ask-suppressed`, `attribution-threads-maillinks` (06.10.). Detail: C.26,
  C.27; screenshots `docs/screenshots/2026-10-06-c27/`.
- [x] Performance e-mail design (owner, 06.10., on main `599e2e1`): text links and the rule under
  card titles blue `#008ccb`; „Zum Produkt“, „Zur Kasse“ and „Code einlösen“ in the black outline
  look of „Beratung mit Mo starten“; the rating row as black-and-white line-drawn faces
  (`public/email-rating-1…5.png`) instead of colour emoji. `docs/EMAIL_DESIGNS.md`; screenshots
  `docs/screenshots/2026-10-06-performance-mail/`.
- [x] Widget checks of 06.10. (M + C): `verify:widget` ✔ (`bc7fb5d`). Page context works in
  production: the first typed product-page question came 06.10. 09:13 UTC, the product was found
  and Mo answered with one card of that product. The test session `d63d2e26` typed on the home page
  (no page context — correct) and got its `_mo` token after the product turn. No
  `product_cta_clicked` with `samePage` yet: the three clicks of 06.10. came from the previous
  widget before the upload. Consent popup: open list item 1. The optional token deletion (task 3)
  was skipped.
- [x] Switches of 05.10. (M): migration `0076` and `MO_ATTRIBUTION_SESSION_ANCHOR=true` — the first
  nightly run with it (06.10. 03:30 UTC) kept the widget token of 29.08. because its device kept
  consulting; `CHAT_PAGE_CONTEXT_ENABLED=true` before the widget upload, so Mo uses the page context
  from the first typed product-page message (`CHAT_PAGE_CONTEXT_HOLDOUT_PCT` = 0). The KPI release
  dates of 05.10. stand.
- [x] Frontend tasks of 05.10. live (06.10., FE PR #75 in the theme repo, `bc7fb5d`): served consent
  benefits with variant/placement, page context on typed product- and collection-page messages,
  attribution token renewal and blanking of the `_mo` marker on sign-out / erase / withdrawal. The
  agent checked `_mo` on and off in `/cart.js` live. Prompt and tasks archived in
  `docs/archive/frontend-tasks-2026-10-05/`.
- [x] 5.2 + 5.4 App Proxy + compliance webhooks (05.10., M): new app version in the Dev Dashboard
  (scope `write_app_proxy`, App proxy `apps/chat`), compliance webhooks with the Shopify CLI (5.4b),
  checks passed, `APP_PROXY_SIGNIN_ENABLED=true` + `APP_PROXY_SIGNIN_MAX_AGE_HOURS=24` in Production.
  Visitors logged in to the shop are recognised in the chat; the manual deletion rule of 5.2 is no
  longer needed.
- [x] Migrations `0061`–`0075` run on production (`0070`–`0074` on 03.10., `0075` on 04.10.);
      `0076` on 05.10.
- [x] Shopify scopes (incl. `read_inventory`), app reinstalled.
- [x] 13 webhooks registered by the app (each once); the hand-made admin webhooks deleted;
      `SHOPIFY_WEBHOOK_SECRET` removed from Vercel.
- [x] `SHOPIFY_CUSTOMER_SYNC_ENABLED=true`; first import done (24,357 customers,
      31,441 orders; 02.10.26 15:38).
- [x] Fixes merged: webhooks wait for the sync switch (#198), webhook script checks
      `read_inventory` (#199), counts duplicates and can `--dedupe` (#200).

## 1 · Now

- [x] **1.6 Security fix: a typed e-mail must never count as a sign-in** — done 03.10.:
  `0071` run; exposure check: **never exploitable** — no session was ever linked by a typed
  e-mail to a person after their sign-in; no data export ever; the one deletion (04.09.) was
  M's own test. Result in dossier § 15.1; L assesses F-31 with 3.2.
  - Found while preparing „order status in the chat“: a session where someone *typed* the
    e-mail of a customer who had used „Anmelden“ in the chat (and not logged out) resolved
    as that customer's signed-in session — `/api/account/export`, `…/conversations`,
    `…/erase`, `/api/auth/me` and the chat memory. Since the customer mirror every shop
    customer qualifies on the Shopify-id side; the token is per customer, not per session.
  - Fix: migration `0071_session_link_kind` records how each session was linked; only a
    sign-in in that session (Customer Account OAuth or the App Proxy) counts. Existing
    signed-in sessions become `legacy` → those customers sign in once more.
  - **M:** right after the merge pull main and run `npm run db:migrate` (until then sign-in
    and the account features fail closed — nobody sees foreign data, but signing in fails).
  - **M (exposure check), Neon → SQL Editor:**
    `SELECT count(*) FROM customer_oauth_tokens;` — customers who could have been affected;
    `SELECT event, count(*), min(created_at), max(created_at) FROM kpi_events WHERE event IN
    ('account_signin_succeeded','account_export_requested','account_erased') GROUP BY event;`
    — exports/erasures without a matching number of sign-ins would be suspicious. If anything
    looks wrong: tell L the same day (Art. 33 DSGVO: 72 h to notify the authority).

- [x] **1.1 Consent write-back on** — M — done 02.10.: 0 offen · 5 erledigt
  - Vercel → project `mo` → Settings → Environment Variables: `SHOPIFY_CONSENT_WRITEBACK`
    = `true` (Production only) → Deployments → latest → ⋯ → Redeploy.
  - Done when: Mo admin → Einstellungen (Settings) → „Shopify-Abgleich“ → „Warteschlange an
    Shopify“ (queue to Shopify) shows **0 offen · 5 erledigt** (0 open, 5 done) within ~5 min.
  - From now on every unsubscribe in Mo also unsubscribes in Shopify, and a deletion in Mo
    switches the Shopify consent off.

- [x] **1.2 Names and e-mails came through** — M — done 02.10.: filled, protected data access works
  - Mo admin → Kunden (Customers) → open 2–3 customers.
  - Done when: name and e-mail are filled. If they are empty, the app lacks *protected
    customer data* access (name, e-mail, address) → ask F to request it, then tell C.

- [x] **1.3 Which domain is live** — M — done 02.10.: only `mo.motionsports.de` is attached
  in Vercel; the widget calls it (`POST /api/chat` on `mo.`); the Customer Account API
  callback and logout URIs (Shopify admin → Headless) point at it. Docs updated (C.2).

- [x] **1.4 App Proxy (shop-native sign-in detection)** — M — done 02.10.: „Page not found“ → no App Proxy configured; the feature is off (the chat's „Anmelden“ works). Wanted → 5.4.
  - Open `https://www.motionsports.de/apps/chat/whoami` in the browser.
  - `{"signedIn":false}` (or `true` while logged in to the shop) → works, done.
  - Shopify's „Page not found“ → no App Proxy configured: the feature is simply off (the
    chat's own „Anmelden“ still works). Optional to add later — with 5.2.
  - Any other error page → the proxy points at a dead address (probably `chat.`): F (or
    M+C in 5.2) sets the proxy URL to `https://mo.motionsports.de/api/auth/storefront`.

- [x] **1.5 Inbound e-mail (customer replies)** — M (C diagnoses) — done 03.10.: Resend
  receives on `reply.motionsports.de` (MX at Resend, verified), `INBOUND_EMAIL_ADDRESS` =
  `hello@reply.motionsports.de`, redeployed, test mail arrived in the Eingang. Mails sent
  before the redeploy still carry `hello@mo.…` as Reply-To (no MX possible on the CNAME), so
  replies to them bounce; a new mail typed to `hello@mo.…` bounces too. Revisit only if that
  matters (A records on `mo.` instead of the CNAME, planned change).
  - `INBOUND_EMAIL_ADDRESS` = `hello@mo.motionsports.de` (also the Reply-To of every mail
    Mo sends). A test mail on 02.10. did **not** arrive in Mo.
  - Check in this order: (a) did the sender get a bounce („Undeliverable“)? (b) Resend →
    the receiving / inbound section: does the test mail appear there? (c) Resend →
    Webhooks: is there one with the event `email.received` → `https://mo.motionsports.de/api/inbound/resend`?
    (d) Vercel → Logs: any `POST /api/inbound/resend`, and with which status?
  - **Found 02.10.:** Resend → Emails → Receiving: „No received emails yet“ — receiving is
    not set up for `mo.motionsports.de` (sending only); no bounce yet (servers retry for
    days). The webhook `…/api/inbound/resend` exists.
  - **Pipeline test without DNS — passed 02.10.:** a mail to `test@ieisteagra.resend.app`
    (Resend's built-in address) appeared in Resend → Receiving and in Mo → Eingang „E-Mails
    nicht zugeordnet“. Webhook (`email.received`) and Mo work.
  - `mo.motionsports.de` is a CNAME to Vercel (checked 02.10.), so it cannot carry an MX
    record → receive on `reply.motionsports.de` (next point, second variant).
  - **1.5b Fix (M, in progress 02.10.):** Resend → Domains → add `reply.motionsports.de`
    with receiving on → add the MX record Resend shows at the DNS provider of
    motionsports.de → wait until Resend shows it verified → Vercel: `INBOUND_EMAIL_ADDRESS`
    = `hello@reply.motionsports.de` (Production) → Redeploy. Replies to mails already sent
    (Reply-To `hello@mo.…`) cannot arrive; every mail sent after the redeploy carries the
    new Reply-To.
  - Done when: a test mail to `hello@reply.motionsports.de` from an unknown address appears
    in Mo → Eingang → „E-Mails nicht zugeordnet“; one from a customer's address opens
    „E-Mail beantworten“ in the Eingang (C.10) with an AI draft.

- [x] **1.7 „Einplanen“ for campaigns (approve now, send later)** — done 05.10.: `0072` run
  03.10., `CAMPAIGN_RELEASE_ENABLED=true` set by M. Check once when convenient: a card →
  „Einplanen“ → within 10 minutes in „Gesendet“.
  - **M:** right after the merge pull main and run `npm run db:migrate` (applies `0072`).
    Until it has run the review desk and campaign sends fail (they read the new columns) —
    migrate right away.
  - **M:** Vercel → `CAMPAIGN_RELEASE_ENABLED` = `true` (Production) → Redeploy. Optional:
    `CAMPAIGN_RELEASE_MAX_PER_RUN` (default 30 per 10 min), `CAMPAIGN_RELEASE_SPACING_MS`.
  - Done when: Kampagnen → a campaign → a reviewed card → „Einplanen“ (A) → „Mit dem
    nächsten Lauf“ → within 10 minutes the mail is in „Gesendet“. Lawyer: dossier § 17 (F-33)
    → goes with 3.2.

- [x] **1.9 Security fix: a sign-in counts only for the chat that started it** — done: `0073` run
  and exposure check 03.10. (all 22 sign-ins visible, none silent; no foreign export or
  deletion — dossier § 15.3); the widget redeems the code since the 04.10. upload, verified live
  04.10. (1.11: 3/3 sign-ins redeemed, none stuck). Lawyer F-34 still goes with 3.2.
  - Found by the review of „order status in the chat“ (still unmerged). The chat's
    „Anmelden“ took the chat session from the login link. A prepared link carrying a
    stranger's session id, opened by a customer who is logged in to the shop, signed the
    customer in silently — into the stranger's chat. That chat then had the customer's
    history, data export, self-deletion and signed-in chat context. The App Proxy (whoami)
    had the same flaw, but it isn't set up in the shop (1.4).
  - Fix: migration `0073_session_link_grants`.
    - A sign-in only yields a one-time code (10 min, single use).
    - The chat of the same browser redeems it with its own session (`POST /api/auth/link`).
    - Logout ends every chat sign-in of the person.
    - Existing chat sign-ins end.
  - **M:** right after the merge, pull main and run `npm run db:migrate` (applies `0073`).
    Until it has run, every sign-in returns `ms_auth=error` (fail closed).
  - **Consequence:** „Anmelden“ in the chat signs nobody in until the widget redeems the
    code. Send FE the frontend prompt of 03.10. (second version; now
    `docs/archive/frontend-handoff/FRONTEND_PROMPT_2026-10.md`) — **task 1** first (spec: today
    `docs/frontend/ACCOUNT_CONTRACT.md` §2a). Nothing breaks meanwhile; the account features are off.
  - **M (exposure check), Neon → SQL Editor.** Every session that signed in and then
    exported or erased. A `silent = true` sign-in followed by an export/erasure with no chat
    of its own is the pattern of this attack:
    `SELECT s.session_id, min(s.created_at) AS signed_in, bool_or((s.data->>'silent')::boolean)
    AS silent, string_agg(DISTINCT a.event, ', ') AS account_actions FROM kpi_events s JOIN
    kpi_events a ON a.session_id = s.session_id AND a.event IN ('account_export_requested',
    'account_erased') WHERE s.event = 'account_signin_succeeded' GROUP BY s.session_id ORDER BY 2;`
    Send C the result. If a row looks wrong, tell L the same day (72 h, Art. 33 DSGVO).
  - Lawyer: dossier § 15.3 (F-34) → goes with 3.2.

- [x] **1.8 „Prüfen & testen“ in the campaign editor** — done: built 03.10., test mail and its
  Mo link verified live 05.10. (1.11)
  - No migration, no env var. Uses the campaign send path for the test mail, so
    `CAMPAIGN_SENDS_APPROVED` must be on (it is).
  - Done when: Kampagnen → a campaign → „Bearbeiten“ → „Prüfen & testen“ shows the estimate;
    „Muster erzeugen“ shows three different people with their mails; „Testpostfach …“ with your
    own address delivers that mail (with a real code if the campaign has a discount).

- [x] **1.10 Letters as a campaign channel** — done 05.10.: `0074` run 03.10., Pingen set up by M.
  Optional: one test letter on Pingen's staging (below).
  - **M:** right after the merge pull main and run `npm run db:migrate` (applies `0074`). Until it
    has run, saving a campaign, the audience match (live count and refresh — fail closed, nobody
    matches) and every letter, Kunden → Brief included, fail, and the nightly retention run stops
    at its campaign step — migrate right away.
  - Optional env (Vercel; defaults in `.env.example`): `LETTER_MIN_INTERVAL_DAYS` (days between two
    advertising letters to one person, default 60), `CAMPAIGN_LETTER_ADDRESS_NIGHTLY` (purchase
    addresses fetched per night, default 200), `CAMPAIGN_LETTER_SHOP_URL` (shop address the letter
    may name; default the shop's host).
  - Production already has the letter gate on (6.5). Nothing new happens until a campaign's
    „Briefe“ is set to something other than „Keine Briefe“ — and then every letter still needs
    „Freigeben“ and „Freigegebene senden“. Kunden → Brief now takes only the shipping address of
    the latest completed order: a customer whose stored address came from elsewhere needs
    „Adresse aus letzter Bestellung holen“ first.
  - **Try it with Pingen's test environment first** — on a Preview deployment with
    `PHYSICAL_MAIL_SENDS_APPROVED=true` and `PINGEN_STAGING=true` (Preview only): Kampagnen → a
    campaign → „Bearbeiten“ → section „Brief“ → „Briefe“ = „An alle ohne E-Mail-Einwilligung“
    (optionally a „Porto-Budget (€)“) → Speichern → „Öffnen“ → view „Briefe“ → „Adressen holen“ →
    „Entwürfe schreiben“ → open a letter, read it, „Vorschau“, „Freigeben“ → „Freigegebene senden“.
    The view shows „Pingen-Testumgebung (PINGEN_STAGING) — es wird nichts gedruckt oder
    verschickt.“
  - Done when: the letter is under „Versendet“ with a Pingen status, and the PDF shows the
    objection notice in the footer and prints „ “ – € correctly.
  - Production letters only after L's answer on F-35 (dossier § 18) → goes with 3.2.

- [x] **1.11 Live check after the widget upload of 04.10.** (live = theme `main` @ `3e87341`) —
  done 05.10. (only the optional consent-popup test with a never-subscribed account is left) —
  checks built and merged (#217, `0075` run 04.10.); **M runs them** (C's container cannot reach
  the shop or the production database). `npm run verify:widget` and `npm run verify:live`
  (read-only; `-- --since 2026-10-05` for a later start).
  - **Verified 04.10. (M ran both):**
    - [x] Widget build: 3e87341 live (Shopify serves it minified), head script, `/cart` style ✔.
    - [x] Sign-in end to end: 3/3 Shopify sign-ins redeemed (`account_signin_linked
      customer_account`) with `account_signin_return {result:"ok"}`; 0 stuck between succeeded
      and linked; 0 refused codes; 1 sign-in cancelled at Shopify (not a bug).
    - [x] Anmelde-Popup funnel fills every stage (3 shown → 2 „Anmelden“ → 2 Shopify → 2 chat,
      1 „Später“).
    - [x] No widget-sent `account_erased`; no duplicate chat start.
    - [x] Contact form: the submission after the upload carries its session (the one before,
      09:53, cannot).
    - [x] No consent popup — correct: all three sign-ins were an already subscribed account
      (`marketing_status = confirmed`); the popup only asks people who never decided.
  - **Left — M:**
    - [ ] Consent popup once with a never-subscribed account (optional, 5 min): sign out in the
      chat → „Anmelden“ with e.g. `name+test1@…` (Shopify creates the customer) → write a
      message → popup „Angebote aktivieren“ → accept → click the DOI mail → `verify:live` section 3
      shows `consent_gate_shown/_accepted` `surface = signin`, an opt-in row `quelle = mo_signin`,
      `ergebnis = doi_required` (after the next widget upload also `variante = a`,
      `platzierung = popup`), a `consent_events` row `mo_signin`, and after the click one DOI
      confirmation with `quelle = mo_signin` (the opt-in row itself never changes); „popup_erwartet“
      is true for that session.
    - [x] Campaign link — verified 05.10.: test mail → Mo button → one message →
      `campaign_chat_started` with `test = true`, 1 event. (Opening the chat alone records
      nothing: the widget hands the token over with the first message, in the tab the link
      opened.)
    - [x] 6.6 (order status) — on for everyone since 05.10.
    - [x] 5.4 (App Proxy) — done 05.10. (see „Done“ above).
  - KPI tab (30 days): „Änderungen im Zeitraum“ lists the release days (01.10., 03.10., 04.10.,
    05.10.); the Anmelde-Popup, Einwilligung, Kundenkonto and Kampagnen sections say „Erst ab dem
    04.10.2026 aussagekräftig“ (the attribution section: 05.10.) — for clean numbers pick
    „Zeitraum…“ from that day.

## 2 · Tomorrow morning

- [x] **2.1 The first nightly run** — M (C checks with you) — done 03.10.: reconcile shows a
  time, customers have Lebenszyklus/Wertstufe. Kunden header 24,378 vs Shopify 24,367: the
  header counts everyone incl. „Interessenten“ (Mo-only people without a shop account);
  „Kund:innen aus Shopify“ in the Shopify-Abgleich card is the number to compare.
  - Einstellungen → „Shopify-Abgleich“: „Nächtlicher Abgleich“ (nightly reconcile) shows a
    time instead of „noch nie“ (never). It runs at 03:45 Berlin time.
  - Kunden: customers show „Lebenszyklus“ (lifecycle) and „Wertstufe“ (value tier), not
    „Noch nicht berechnet“ (not yet computed).
  - „Kund:innen aus Shopify“ equals the Shopify customer count (yesterday 24,357 vs 24,358).
  - If it still says „noch nie“: Vercel → project → Settings → Cron Jobs — are the jobs
    listed, and is `CRON_SECRET` set? Send C a screenshot.

## 3 · This week — Shopify and legal

- [x] **3.1 Double opt-in in Shopify** — M — done 03.10.: „Customer marketing confirmation“ was
  already on for new email (and SMS) subscribers.
  - Shopify admin → Settings → search „double opt-in“ (marketing / customer notification
    settings) → turn it on.
  - Only affects new sign-ups in the shop. Without it, shop sign-ups count as single
    opt-in and are only mailed with `CAMPAIGN_ALLOW_SINGLE_OPT_IN=true` (see 6.5).

- [x] **3.2 Lawyer dossier** — M → L — M keeps it current as features ship (05.10.); D-AP1
  (App Proxy sign-in without a chat token) confirmed by L 05.10. C adds a Nachtrag per new
  feature (§19 App Proxy sign-in, §20 attribution window, §21 consent bullets + page context).
  - Send `docs/ANWALTSDOSSIER.md` (focus §13 to §21, questions F-22 to F-38; F-31 and F-34
    — the two sign-in flaws of 03.10. — are the urgent ones; F-32 = order status in the chat,
    blocks 6.6; F-35 = advertising letters from campaigns, before production letters, 1.10).
  - Mention the deadline: Black Friday is **27 Nov 2026**; the campaign send gate (6.5)
    needs the sign-off by **~18 Nov** so mails can go out from 20 Nov.
  - Done when: L has it and has given a date.

- [x] **3.3 Privacy policy** (F-28) — M (L reviews) — M handles it as features ship (05.10.)
  - Add: customer and order data from the shop are processed in Mo; AI customer profiles
    (and the right to object); one shared e-mail consent and one deletion with Shopify;
    advertising letters with the right to object — also from campaigns, AI-drafted, sent via
    Pingen (F-35 c); AI suggestions in the Eingang; contact
    requests stored in Mo and AI-assisted replies to incoming mails (F-30); once 6.6 is
    on, Mo answering signed-in customers' questions about their own orders (F-32); the
    retention periods (`docs/DATA_RETENTION.md`).

- [x] **3.4 One consent text** (F-29) — M (L approves) — M handles it (05.10.); the English Mo
  consent text is a translation of the German one and approved as such (D-AP3, 05.10.; served
  with `enLegalReviewed: true` since then)
  - The newsletter checkbox text in the shop (checkout, account, footer) and Mo's consent
    text must say the same thing (personalised offers by e-mail, analysis of purchases and
    chats).
  - Then set `SHOPIFY_CONSENT_TEXT_VERSION` in Vercel to the new text's version (e.g.
    `shopify-2026-11`) and redeploy.

## 4 · Black Friday

*Deferred by M (05.10.) — not before M brings it up again.*

- [ ] **4.1 Decide: per-mail review or „Serien-Mail“** (D-10) — M
  - Today every campaign mail is drafted and reviewed one by one (realistic ≈ 200 per
    operator and day). Check the audience size first (4.2): if it is in the thousands,
    per-mail review will not make it by 27 Nov.
  - Option A: keep per-mail review, narrow the audience (e.g. top customers, recent buyers).
  - Option B: C builds „Serien-Mail“ (one approved master text + automatic per-person
    blocks, sample review, batch send). Needs the lawyer's OK because it ends „a human
    reviews every e-mail“. Build time ≈ 1 week → decide by **mid-October**.

- [ ] **4.2 Create the campaign** — M (C helps)
  - Mo admin → Kampagnen → „Neue Kampagne“ (new campaign) → type „Aktion“ (promotion),
    name „Black Friday 2026“, dates (e.g. 20–30 Nov), offer/discount, audience.
  - The editor shows the live audience count — note it for 4.1.
  - „Starten“ (start) only takes over the audience; nothing is sent before 6.5.

- [ ] **4.3 Drafts, review, send** — M — from ~20 Nov
  - Kampagnen → the campaign → „Vorbereiten…“ (prepare) → review each draft → send.
  - Needs `CAMPAIGN_SENDS_APPROVED=true` (6.5).

## 5 · Frontend and app access

- [x] **5.1 Frontend task** — done 04.10.: the frontend agent built the customer-platform
  widget (theme PR #73 + `8d0a0c4` + `3e87341`), the owner uploaded it on 04.10.; the frontend
  docs are in `docs/frontend/`. Live check: 1.11. The next widget tasks (from the backlog in
  `docs/frontend/07` §7) are written: `docs/archive/frontend-tasks-2026-10-05/README.md` (live since 06.10., theme `bc7fb5d`).

- [x] **5.2 Compliance webhooks** (done 05.10.) — now part of 5.4 (steps 5 and 11; fallback 5.4b): the same new
  app version in the Dev Dashboard carries the App Proxy and the compliance webhooks, and M can do it
  alone (Dev Dashboard access since 05.10.).
  - **Until 5.4 step 11 has passed:** a deletion request → „Delete customer“ in Shopify (Mo follows);
    if you use „Erase personal data“ instead, also „Löschen“ (delete) the person in Mo → Kunden.
    A data request → also look the person up in Mo → Kunden.

- [x] **5.4 Shop sign-in detection (App Proxy) + compliance webhooks** (done 05.10.) — M alone in the Shopify Dev
  Dashboard (~30 min), C checks with you — **ready since 05.10.** (backend P0.3 Phase 1+2: fresh
  signatures only, no code without proof, handover on shared browsers, renewals not counted as
  sign-ins, kill switch; D-AP1 decided: a visitor logged in to the shop counts as signed in to the
  chat). Result: whoever is logged in to the shop is greeted by name in the chat without clicking
  „Anmelden“, sees their chat history and gets the consent popup (if they never decided). Order
  status still needs one „Anmelden“ in the chat — Mo says so and links „Meine Bestellungen“.

  **A · New app version (Dev Dashboard, dev.shopify.com)**
  1. Apps → the app (its Client ID is Mo's `SHOPIFY_CLIENT_ID` in Vercel) → Versions → note the
     active version — the way back if anything goes wrong.
  2. „Create a version“ → check that the form is pre-filled with the active version's values (app
     URL, redirect URLs, scopes, webhooks API version). Empty or different → stop and tell C: a
     release replaces the app's whole configuration.
  3. Scopes: add `write_app_proxy`; keep every scope that is there.
  4. App proxy: subpath prefix `apps`, subpath `chat`, proxy URL
     `https://mo.motionsports.de/api/auth/storefront`.
  5. Compliance webhooks: the version form has **no** such section (seen 05.10.) → release anyway
     (step 6) and do 5.4b afterwards.
  6. Release. **Never rotate the client secret:** Mo's Admin API access, every webhook signature and
     the App Proxy signature use it (Vercel `SHOPIFY_CLIENT_SECRET`); a new secret breaks all three
     until Vercel has it.

  **B · Shopify admin**
  7. Apps → the app: accept the updated permissions (new scope).
  8. Settings → Apps and sales channels → the app → „App proxy“: the URL must read
     `https://www.motionsports.de/apps/chat` → if it shows anything else, „Customize URL“ → prefix
     `apps`, subpath `chat` → Save (a version's prefix/subpath only apply to new installs). Vercel:
     nothing (the proxy signs with `SHOPIFY_CLIENT_SECRET`, which Mo has).

  **C · Checks (switches still off, nothing changes for visitors)**
  9. `npm run verify:widget` → „✔ App Proxy /apps/chat/whoami antwortet JSON — signedIn=false (ohne
     Shop-Cookie erwartet: false)“.
  10. In a browser logged in to the shop (www.motionsports.de/account) open
      `https://www.motionsports.de/apps/chat/whoami?session=livecheck-manual` → `{"signedIn":false}`.
      Then `npm run verify:live` → section 8 „Manuelle Prüfung“ shows one row whose `data` has
      `"noCode":"flag_off"`. **No row** → Shopify sends no logged-in customer for this store's
      account type: do not switch on (skip D) and tell C.
  11. **Compliance test** (after step 5 or 5.4b): Shopify admin → Customers → your own customer →
      More actions → „Request customer data“ → Mo → Eingang shows „Datenauskunft angefordert
      (Shopify)“ → „Erledigt“. From then on the manual rule in 5.2 is no longer needed. **Never test
      with „Erase personal data“** — it really deletes the person in Shopify and in Mo.

  **D · Switch on**
  12. Vercel → Production → `APP_PROXY_SIGNIN_ENABLED=true` and `APP_PROXY_SIGNIN_MAX_AGE_HOURS=24`
      → Redeploy.
  13. **Test** in a private window: log in at www.motionsports.de/account → open any shop page → open
      the chat: your name shows, no „Anmelden“, the history drawer works. `npm run verify:live` →
      section 8 shows a code issued and redeemed; section 1 „Vom Shop erkannt“. Tell C the date (C
      adds the KPI release note). Optional, with C: the handover and shop-logout tests (C.26).
  14. **Kill switch** (any time, e.g. a theme re-sync brings back an old widget — `verify:widget`
      fails): `APP_PROXY_SIGNIN_ENABLED=false` → Redeploy. Visitors are then simply not recognised.
  15. **Tell F:** run `shopify app config link` before the next `shopify app deploy`, so F's
      `shopify.app.toml` keeps the new scope, the App proxy and the compliance webhooks (a deploy
      from an old toml replaces the whole configuration and removes them).
  - Watch: KPI → Anmeldung → „Kundenkonto & Self-Service“ → „Shop-Login-Erkennung (App Proxy)“ (a
    warning appears if the widget leaves codes unredeemed); KPI → Anmeldung →
    „Einwilligung nach der Anmeldung (Marketing-Opt-in)“ → „Nach Anmeldeweg“.

  **5.4b · Compliance webhooks with the Shopify CLI** (the Dev Dashboard version form has no
  compliance section — confirmed 05.10.) — F in F's project folder (~5 min), or M alone; then step 11.
  - (0) M alone, no project folder yet: `npm install -g @shopify/cli@latest`; in an empty folder
    `shopify app init --client-id <Client ID>` (Dev Dashboard → App settings; = Vercel
    `SHOPIFY_CLIENT_ID`; if asked for a template, take the extension-only one) → `cd` into the new
    folder.
  - (a) In the app's project folder: `shopify app config link` → pick the app (writes the
    configuration released in step 6, incl. scope and App proxy, into `shopify.app.toml`).
  - (b) Check `shopify.app.toml`: `[access_scopes]` `scopes` contains `write_app_proxy` and every
    other scope of the active version, and the `[app_proxy]` block below is there (add what is
    missing). Then add the `[webhooks]` part below:
    ```toml
    [app_proxy]
    url = "https://mo.motionsports.de/api/auth/storefront"
    prefix = "apps"
    subpath = "chat"

    [webhooks]
    api_version = "2026-04"

      [[webhooks.subscriptions]]
      compliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]
      uri = "https://mo.motionsports.de/api/webhooks/shopify"
    ```
    (if the toml already has a `[webhooks]` block, add only the `[[webhooks.subscriptions]]` part
    under it and keep its `api_version`). No other webhook topics in the toml — `npm run
    shopify:webhooks` registers those, and a second copy doubles every event.
  - (c) `shopify app deploy` → **read the summary before confirming**: the only new thing must be
    the compliance webhooks. If it says an extension would be removed, or scopes / URLs change →
    answer no and tell C. No reinstall (it would delete the subscriptions the script registered).

- [ ] **5.3 App ownership** (optional) — M + F
  - M has Dev Dashboard access to the app since 05.10. (5.4 needs nobody else). Left, optional: move
    the app to an organisation owned by motionsports, so scopes, secret and configuration no longer
    depend on the freelancer's organisation.

## 6 · After the lawyer's answer

Each is one Vercel variable + Redeploy unless noted. Do them one at a time.

- [ ] **6.1 Create Shopify accounts for Mo-only subscribers** (F-24) — M
  - Einstellungen → „Shopify-Abgleich“ → „Erstabgleich der Einwilligung“ → „In Shopify
    anlegen…“ (create in Shopify) — currently 2 people.

- [ ] **6.2 Deletions reach Shopify** (F-26) — M
  - `SHOPIFY_ERASURE_SYNC=true`. A deletion in Mo then also requests the deletion in Shopify.

- [ ] **6.3 AI profiles for everyone** (F-23) — M
  - Set hard monthly spend caps in the Anthropic and OpenAI consoles first.
  - `CUSTOMER_AI_PROFILE_SCOPE=all`; optionally `CUSTOMER_PROFILE_LIGHT_BATCH` (e.g. `200`
    purchase profiles per night).

- [ ] **6.4 Mo's insights as Shopify tags** (F-28, optional) — M
  - `SHOPIFY_WRITEBACK_ENABLED=true` → `mo-…` customer tags usable in Shopify segments.

- [x] **6.5 Send gates** — already on in production (Systemstatus, 02.10.): campaign mails
  „Freigegeben“, single-opt-in contacts „Erlaubt“, letters „Freigegeben“ — the state from
  before the customer platform. Black Friday is not blocked by a gate. The lawyer's view on
  F-25 (single opt-in, now one switch for all marketing mail), F-27 (letters, Robinson
  list) and F-35 (letters from campaigns, 1.10) is still worth having; switch a gate off in
  Vercel if the answer says so.

- [x] **6.6 Order status in the chat** (F-32) — done 05.10.: `CHAT_ORDER_STATUS_ENABLED=true`
  in Production (M); verified live: signed in without orders → lookup `no_orders`, Mo says so in
  words with „Meine Bestellungen“ and asks before opening the contact form; signed out → Mo
  explains „Anmelden“ and asks (wording fixed in #221/#222). Still to see once: an account with
  orders (date, items, state; no number or amount). Watch KPI → „Bestellstatus im Chat“.
  - Signed-in customers ask „Wo ist meine Bestellung?“ and Mo answers from the order ledger
    plus a short live Shopify read (`get_order_status`, `docs/ANWALTSDOSSIER.md` §16).
    Built 03.10.
  - Before: the lawyer's answer on F-32 (and the privacy-policy sentence it asks for); FE
    confirms the live widget renders nothing for `get_order_status` and clears the stored
    chat history on logout (frontend prompt task 6; contract today: `docs/frontend/API_CONTRACT.md`
    §2 and `docs/frontend/ACCOUNT_CONTRACT.md` §3a/§5). `SHOPIFY_CUSTOMER_SYNC_ENABLED` stays on (it is — the answer needs the ledger).
  - Optional: `SHOPIFY_ACCOUNT_ORDERS_URL` if „Meine Bestellungen“ should open another page
    than `https://www.motionsports.de/account`.
  - Live check with your own account first (no Preview needed, 04.10.): Vercel Production
    `CHAT_ORDER_STATUS_TEST_CUSTOMERS=<your Shopify customer id>` (digits from the customer's
    admin URL) → Redeploy. On www.motionsports.de sign in with „Anmelden“ in the chat, ask „Wo
    ist meine Bestellung?“ → Mo names date, items and state, no order number or amount; the
    widget shows **no card, no error, no empty bubble** for the tool (unknown tools render
    nothing, `docs/frontend/07` §6.3); „Ich möchte das zurückschicken“ → contact form with
    „Kontakt zum motion sports Team“. Everyone else is unaffected. KPI → „Bestellstatus im
    Chat“ shows the lookups.
  - Then `CHAT_ORDER_STATUS_ENABLED=true` (Production), remove
    `CHAT_ORDER_STATUS_TEST_CUSTOMERS` → Redeploy. Watch „Bestellstatus im Chat“: mostly
    „Beantwortet“; „Nicht angemeldet“ means people ask without signing in (Mo offers
    „Anmelden“); „Hauptbuch hinterher“ / „Import unvollständig“ point at the order sync.
  - Done when: Neon → `SELECT data->>'outcome', count(*) FROM kpi_events WHERE event =
    'order_status_lookup' GROUP BY 1;` shows `ok` rows, and Gespräche shows the tool label
    „Bestellung“.

## 7 · Optional tuning

- [ ] **7.1** `INBOX_AI_DAILY_LIMIT` (AI suggestions in the Eingang per day, ≈ $0.01 each,
      recommended `25`) and `CAMPAIGN_AUTO_PREPARE_COUNT` (campaign drafts prepared nightly
      for the review desk, costs per draft) — M, once the team works the Eingang and the
      desk daily.
- [ ] **7.2** Install the Claude GitHub App
      (https://github.com/apps/claude/installations/select_target) so C gets PR events — M.

## C · Claude's tasks

- [x] **C.1** Correct the compliance-webhook hint in `scripts/register-shopify-webhooks.mjs`
      and `docs/CATALOG_SYNC.md` (no Dev Dashboard field; `shopify.app.toml` + CLI; the
      manual rule from 5.2 while it is missing). Since 05.10. 5.4 tries the Dev Dashboard version
      form first; the CLI route is the fallback 5.4b.
- [x] **C.2** Domain in the docs and the `base-url.ts` fallback → `mo.motionsports.de`.
- [x] **C.6** `/api/auth/storefront/whoami` answers like `/api/auth/storefront` (the App
      Proxy appends `/whoami` to the proxy URL).
- [x] **C.7** False alarm „Der nächtliche Abgleich ist seit über 36 Stunden nicht
      durchgelaufen“ right after the import (counted „no reconcile yet“ as overdue) — now
      measured from the newer of import and reconcile; tested core `shopify-sync-health.mjs`.
- [x] **C.8** Eingang customer card said „Noch keine Bestellung“ before the nightly figures
      existed — now „Kennzahlen werden heute Nacht berechnet“.
- [x] **C.9** Eingang rule „Unzufriedenheit“ — built 03.10.: the order ledger stores the date
      of the newest notable refund (≥ 10 % of the order value; `customer_orders.last_refund_at`,
      migration `0070`) and the rule uses it instead of the order's last change; smaller
      refunds are ignored, a cancelled order stays one case (its refund raises nothing new).
      Follow-up after the review (03.10.): existing orders have no refund date yet, so the
      first hourly run after `0070` closes every refund-only item — real ones too. The next
      Shopify sync therefore re-reads the orders of the last 15 days once and then reopens the
      items the job closed by itself; the next Eingang run closes only the false ones again.
  - [x] **C.9a** — M — `0070` run on production right after the merge (03.10.).
  - [ ] **C.9b** — M — only a check now: the follow-up is merged (03.10.) and the nightly
        reconcile (01:45 UTC = 03:45 Berlin summer time) runs the one-off look-back by itself; a manual run (Vercel →
        project `mo` → Settings → Cron Jobs → `/api/cron/shopify-reconcile` → **Run**, then Mo →
        Eingang → **„Jetzt prüfen“**) is no longer needed.
        Done when: Einstellungen → Shopify-Abgleich lists a run „Erstattungsdaten nachgelesen“ and
        the Eingang shows „Unzufriedenheit“ only for refunds and cancellations of the last 14 days.
- [x] **C.10** **E-Mails im Eingang** — built 02.10. (no migration): every incoming mail of
      a known customer opens „E-Mail beantworten“ in the Eingang at once (later mails join
      it; the hourly job catches up missed ones); the item shows the conversation, an AI
      summary and a reply draft (service reply, never advertising — placeholders in
      [brackets] for anything it cannot know); „Antwort senden“ sends it threaded and
      closes the item, as does a reply from Kunden → Korrespondenz. Unknown senders: „Als
      Interessent anlegen“ next to „Zuordnen“. The contact form now also lands in Mo
      (prospect + Korrespondenz + item); the team mail is unchanged. Filter: „Alle Arten“ →
      „E-Mail beantworten“. Lawyer: dossier § 14 (F-30) → goes with 3.2.
- [x] **C.11** **Bestellstatus im Chat** — built 03.10. (no migration, switch off): a customer
      signed in via „Anmelden“ in the same chat session asks about their orders and Mo answers
      from the ledger plus a short live Shopify read — date, items, shipping/payment state,
      carrier, delivery day; never order number, amount, tracking number or address.
      Returns, cancellations and complaints stay with the contact form. Turning it on: 6.6.
      Lawyer: dossier § 16 (F-32) → goes with 3.2.
- [x] **C.12** **Briefe als Kampagnen-Kanal** — built 03.10. (migration `0074`; every campaign
      starts at „Keine Briefe“): a campaign can also write advertising letters (Pingen) — „An
      alle ohne E-Mail-Einwilligung“ or „An alle (auch mit Einwilligung)“, with an optional
      postage budget. Address = the shipping address of the latest completed order only (now
      also for Kunden → Brief, with „Adresse aus letzter Bestellung holen“); an AI draft per
      letter; each letter is read and released by hand in the desk view „Briefe“; „Freigegebene
      senden“ checks every gate again per letter (objection, consent, address, 60-day cadence,
      budget). `docs/CAMPAIGNS.md` §8. Turning it on: 1.10. Lawyer: dossier § 18 (F-35) → goes
      with 3.2.
- [x] **C.13** **Widget of 01.10. in the KPIs** — built 03.10. (no migration, no switch): the
      new KPI section „Anmelde-Popup“ (per session up to „Im Chat angemeldet“ — the server now
      writes `account_signin_linked` / `account_signin_link_refused` at `POST /api/auth/link`),
      the consent section shows only the popup after sign-in, `starter_*` are marked
      „eingestellt“. The frontend prompt is rewritten on top of that widget (5.1).
- [x] **C.3** „Chat gestartet“ (chat started) race-safe and indexed — `0075` (04.10.).
- [x] **C.14** **Live check of the 04.10. widget** — built 04.10. (`0075`, no switch): KPI
      release dates and notes, sign-in diagnosis per session, „Geöffnet → geschrieben“,
      „Bestellstatus im Chat“, contact-form split; `/api/kpi` drops server-only events;
      `/api/contact` session fallback; test sends count the chat start (`test:true`);
      `CHAT_ORDER_STATUS_TEST_CUSTOMERS`; `npm run verify:widget` / `verify:live` (1.11).
- [x] **C.4** Komplettanalyse (full analysis report): day boundaries in Berlin time instead
      of UTC — done 05.10. (every range query of the report runs midnight to midnight Berlin time).
- [x] **C.15** Next items planned (item 8 of the 04.10. request) — done 04.10.: five ranked,
      verified plans, all built 05.10. (C.16–C.21) and archived in `docs/archive/plans-2026-10-04/`
      (README = ranking, findings, decisions, order; open follow-ups → C.26); the widget tasks went
      live on 06.10. (`docs/archive/frontend-tasks-2026-10-05/`, C.22).
- [x] **C.16** OI1 F1 (opt-in loss) fixed 05.10.: a submit without the marketing tick keeps a
      `pending` DOI (status, token, `doi_sent_at`, marketing flag) unless the address is
      suppressed, so the link in the inbox keeps working; rules in the tested
      `email-capture-core.mjs`. Already lost links are not restored — M's size check of 05.10.
      found none (F1 and F2 both 0). F2 (a suppressed address answered „already subscribed“) is
      fixed in C.18.
- [x] **C.17** P0.3 Phase 1 + 2 — built 05.10. (no migration, both switches off in code):
      fresh App Proxy signatures, code only with a proof, handover on shared browsers, stamp guard,
      renewals, kill switch, shop proof without a chat token (D-AP1, max age), anti-nag for the
      consent popup, proof note in the consent evidence, order-status wording for shop sessions,
      KPI „Shop-Login-Erkennung“ + „Nach Anmeldeweg“, `verify:live` section 8, dossier §19.
      **M:** 5.4 — done 05.10.
- [x] **C.18** OI1 — PR 1 done 05.10. (no e-mail-summary offer and no forced checkout ask for
      signed-in sessions); PR 2 done 05.10. (opt-ins carry `source` / `outcome`, DOI confirmations
      their source; capture funnel = capture form only with „DOI-Mail fällig“ as the DOI base;
      consent popup counted per session; F2: a suppressed address is never answered „already
      subscribed“). No migration.
- [x] **C.19** OI3 — done 05.10.: `surface=signin` serves three benefit bullets (C's wording,
      D-AP4) and `variant: "a"` (copy version `v5`); the opt-in POST takes `placement` /
      `variant`; KPI „Nach Variante und Platzierung“. FE task 1:
      `docs/archive/frontend-tasks-2026-10-05/TASKS.md` task 1 (live since 06.10.).
- [x] **C.20** A3 backend — done 05.10.: `context.source`, softer page notes,
      `CHAT_PAGE_CONTEXT_ENABLED` / `_HOLDOUT_PCT` off, `page_context_applied/_answered`, KPI
      „Seitenkontext auf Produktseiten“, `verify:live` section 9, fingerprint row for the next
      upload. FE task 2: `docs/archive/frontend-tasks-2026-10-05/TASKS.md` task 2 (live since 06.10.).
- [x] **C.21** ATTR-TOKEN-LIFETIME — built 05.10. (pre-checks by M: webhooks once each, widget
      tokens since 24.08., purge cliff reached 05.10. 08:40 UTC). Migration `0076`
      (`messages.session_id`; the code works before and after it), `MO_ATTRIBUTION_SESSION_ANCHOR`
      (off in code), `mo_order_marker_unresolved`, KPI notes, `verify:live` 7b, dossier §20 (F-37).
      **M:** done 05.10. (migration and switch). FE task 3:
      `docs/archive/frontend-tasks-2026-10-05/TASKS.md` task 3 (live since 06.10.).
- [ ] **C.5** Keep this file current after every step.
- [x] **C.22** Widget upload of 06.10. (`bc7fb5d`): fingerprint row `tasks-2026-10-05` is current
      (measured raw, whitespace-only and minified), KPI release notes of 06.10. („Einwilligungs-Popup:
      Vorteile vom Server, Variante und Platzierung“, „Seitenkontext bei getippten Fragen (Widget)“,
      „Bestell-Zuordnung: Markierung wird nach einer Beratung erneuert“), `docs/frontend/01`–`07`
      refreshed to `bc7fb5d`, the round archived; `verify:live --session` also lists a session's
      consent rows (section 3). Afternoon: the checks evaluated (Done), `verify:live` 7b V2/V2b
      (against the latest nightly run, `--ran-at` optional) and section 9 clicks by `samePage`,
      dossier §21.3 with both switch states.
- [ ] **C.23** Page context: the switch is on since 05.10., the context in use since the upload of
      06.10.; once 2–3 days of base rate are in (≈ 09.10., open list item 2), pre-register
      the control-group experiment (`PAGE_CONTEXT_EXPERIMENT`, target size per arm) and tell M
      the `CHAT_PAGE_CONTEXT_HOLDOUT_PCT` value; read the result once the target is reached.
- [ ] **C.24** Attribution: remove the legacy fallback (rows without `messages.session_id`) 37 days
      after `0076` ran on production (it ran on 05.10. → from 11.11.2026); A2 (`_mo` on the „Zur Kasse“
      link) after M's test order (P0.2).
- [ ] **C.25** Backlog, no deadline: D14 sanitize, B2 sign-in entry points, B6 handle mapping,
      E6 widget version header, D18 popup memory per person instead of per tab / device (the likely
      cause of the missing popup on 06.10., open list item 1) (`docs/frontend/07` §7).
- [ ] **C.26** Open follow-ups of the built 04.10. plans (not built unless marked done; detail in
      `docs/archive/plans-2026-10-04/<plan>`):
  - **P0.3** — after 5.4 step 12, with M: the shop-logout token test (does a shop logout end the
    chat's Customer-Account sign-in?) and the handover test (two test customers in one browser →
    `noCode:'handover'`, the earlier person's chat sign-in ends) — not part of 5.4, which goes from
    „switches off“ straight to `true`/`24` (P0.3.md §8 „Stage A“). SIGNIN-ORDER: order status for
    shop-recognised sessions — today `customer_account` links only (`order-status-core.mjs`), needs
    L (dossier §16.1, F-32) (P0.3.md §11 step 8). O1b, optional: refuse a second use of an App Proxy
    signature within its 5 minutes (KV, fails open) (P0.3.md §3.5, §10). `KPI_RELEASES` entries with
    per-section notes (`sections` / `sectionNote`) — only if the App Proxy release should annotate
    the Anmelde-Popup / Einwilligung / Kundenkonto sections (P0.3.md §3.11).
  - **OI1 F3** — done 06.10. (no migration): opt-in events carry `doiSent`, written after the send
    attempt (`/api/capture-email`, `/api/account/marketing-opt-in`); „DOI-Mail fällig“ became „DOI-Mail
    verschickt“, with „nicht verschickt“ shown only when > 0; the DOI rate divides by mails sent
    (capture funnel and „Nach Variante und Platzierung“), older rows count as sent; `verify:live`
    section 3 column `doi_verschickt`; release `doi-mail-sent` (OI1.md §1 F3, §13).
  - **OI3 B4** — a second consent-popup variant only after L's answer on F-38 (b); if the shown
    variant must be on the consent record: a migration `email_captures.consent_variant` with the next
    free number (`0077` is taken since 06.10. by the report step claim), written by the opt-in route
    before the second variant is activated (OI3.md „B4“).
  - **A3**, data-dependent (the page-context switch is on since 05.10.): many `en` sessions with
    `resolved: false` → a backend fallback over the `/en` translated handle; over-pivoting on order
    or shipping questions → tighten `pagePivotNote()`; suppress repeated cards of the open product
    only together with an attribution replacement (A3.md §9 step 7).
  - **ATTR** — V2/V2b (no old widget token survived without a same-session consultation; the
    180-day cap holds) are in `verify:live` 7b since 06.10.; M's next run reports them (open list
    item 2). Done 06.10. (no migration, no switch): §9.1 a reused mail-link token re-stamps
    `created_at` per mail (window and purge count from the latest mail); §9.2 the overlap check reads
    every thread of the session active within the window before the order; §4.9
    `mo_order_marker_unresolved` counts once per `X-Shopify-Event-Id` (claim `mo-unresolved:<id>` in
    `shopify_webhook_events`). Live check after the first unresolved order:
    `SELECT count(*) FROM shopify_webhook_events WHERE webhook_id LIKE 'mo-unresolved:%'` equals V3's
    events since the deploy (0 means Shopify sends no event id; behaviour as before). Still open:
    §9.5 (decide with F-37 (b)).
- [ ] **C.27** Code findings of the docs audit of 05.10. (the docs now describe the code as it is;
      these are code changes, none urgent). Built 06.10. (no migration, no new switch) except the
      two small items marked open:
  - **Bug — fixed 06.10.:** a capture no longer moves a signed-in customer's chats. Typing someone
    else's address still ends the sign-in, but only chats without an owner — or, on a correction
    of an earlier typed e-mail, that e-mail's chats — follow the typed address
    (`attachSessionOnEmailCapture` / `captureMovesConversationsFrom` in
    `src/lib/customer-session-link.mjs`, tested). **Open edge case:** after a sign-in ended, typing
    the signed-in person's own address and then a third address moves their chats as a
    „correction“; closing that needs a link-kind record per chat (a migration).
  - **Decided (M) 06.10.:** any `suppression_list` row (unsubscribe, manual, complaint, bounce,
    erasure) makes `optInActionable` false — `isMarketingOptInActionable` in
    `src/lib/consent-ask-policy.mjs` (tested), used by `resolveMarketingOptInState`; release
    `consent-ask-suppressed`.
  - Copy — done 06.10.: `marketing_consent_required` no longer mentions a checkbox; `/api/contact`'s
    502 is localised; campaign CTA `/api/r/<token>` links and set links carry `locale=en` for English
    recipients (`withLocaleParam` in `src/lib/locale.mjs`). The unsubscribe links of the 1:1 mail
    (Einzelansprache) already carried the locale; the links without it belong to the German-only
    legacy MS5 mail, left as is.
    **Open, small:** `/api/newsletter-rating` links carry no locale (noted in
    `docs/frontend/API_CONTRACT.md` §12.2).
  - `db:reset` — fixed 06.10.: the tables come from `migrations/` at run time
    (`src/lib/db-reset-plan.mjs`, tested); it keeps `_migrations`, `campaigns` and
    `email_design_selections` and stops on a database without `_migrations`, on an unknown table or
    on a foreign key from a kept table (`TRUNCATE … RESTART IDENTITY`, no CASCADE). Tested on a
    local database at 0076.
  - Retention gaps — closed 06.10. on existing windows: skipped outbox rows go with done / dead
    (`SHOPIFY_SYNC_LOG_RETENTION_DAYS`, step 7); reviewed `customer_merge_conflicts` by
    `resolved_at` (step 7b); finished, fully decided `improvement_runs` and their suggestions on
    `ANALYTICS_REPORT_RETENTION_DAYS` (step 5h); counters `deletedImprovementRuns`,
    `deletedImprovementSuggestions`, `deletedMergeConflicts`; tested status lists in
    `src/lib/retention-rules.mjs`. Step 7b removes nothing yet → C.28.
  - Admin texts — done 06.10.: the `LoginGateSection` InfoTip and the `widget-popups` release detail
    (~0.7 s after a send, at most one popup per browser tab); `RevenueSection` InfoTips name MK- and
    MS5-; `AiCostSection` labels for `hero_image`, `campaign_assist`, `inbox_suggestion`,
    `inbox_mail_reply`, `customer_ask`, `improvement` (map typed `Record<AiCallSite, string>`);
    Systemstatus shows four new rows with InfoTips (Seitenkontext im Chat ± Kontrollgruppe,
    Shop-Login-Erkennung (App Proxy), Bestell-Zuordnung ab letzter Beratung, Einwilligungs-Popup:
    Varianten); `email-theme.mjs` label „Kampagne (Kund:innen mit Einwilligung)“.
  - Comment sweep — done 06.10. (22 files, comments only): consent stamp versions and the button
    consent in the opt-in routes, the `consent-copy` route header, the full step list in the
    `retention.ts` header, `kpi-events.ts` link data, `seed-dev.mjs`, the MS5-/MK- prefixes in
    `shopify-discounts.ts`, the image model names, the two delivery paths of marketing mail, and a
    few more from the audit reports.
- [ ] **C.28** Merge conflicts, decide later: nothing ever sets `customer_merge_conflicts.resolved_at`
      (there is no admin view of the table), so retention step 7b (C.27) removes nothing today and
      the rows leave only with the complete erasure. Either add a review action, or also purge
      unresolved conflicts after a window (`docs/DATA_RETENTION.md`).
- [ ] **C.29** Shop sign-up consent, to check (after the second check of open list item 1): M ticked
      the shop's newsletter box at the sign-up of 06.10. — Shopify sent its own confirmation mail,
      Mo recorded no Shopify consent event. If Shopify shows the address as pending while Mo has no
      `shopify` consent event, Mo misses the shop's sign-up consent and the popup after the sign-in
      would ask again (two confirmation mails): find where it is lost and fix it.
- [ ] **C.30** Open decisions of the four reworks of 06.10. — **M decides**, C builds what changes:
  - **Order list and privacy:** „Was genau passiert ist“ shows per order the order number, amount, Mo
    code and product titles, linked to the customer and the conversation by id (no name, no e-mail on
    the KPI page). Does dossier §20 / F-37 need a note?
  - **„Umsatz je 1 € KI-Kosten“** divides revenue incl. VAT by the AI cost alone (no postage, no other
    cost) — keep, or net of VAT / with postage?
  - **Journey funnel:** „Bestellt“ counts only sessions with a cart click in the chat; orders without
    one are shown beside it („Beratung → Bestellung“) — keep?
  - **Previous period:** the comparisons use the order ledger only (no Shopify code complement) — keep?
  - **Strategist time limit:** if Opus often needs more than 240 s at effort high (open list item 3
    shows „im 2. Versuch“), start at medium instead of high, or give the pass more time (the
    240 s abort and the route's 300 s would both have to rise)?
  - **Prompt caching** is not used for the two strategist passes — worth adding?
  - **New reports:** the business snapshot replaces the old chapters Kennzahlen, Kundenbasis and
    Kampagnen (still stored, shown only for older reports) — keep it that way?

  - **Verbesserung (06.10.):** directives are judged on analysed chats only (≈ 36 % of conversations are
    analysed) — most verdicts stay „Tendenz“; options: analyse daily, a 28-day default horizon, or
    another metric (M decides). Named columns via a migration later, or keep the versioned JSONB? A
    switch log would make switch confounders exact (today they start with the first v2 run). An
    optional „live seit“ date for „Erledigt“ suggestions. The shared `CardContent` has `pt-0`, so
    cards on other screens look cramped at the top (Verbesserung pads its own).

## Backlog — not built, decide later

- „Serien-Mail“ for big campaigns (D-10) — see 4.1.
- Verbesserung (improvement) lane „Marketing“: offers, segments and triggers as proposals.
- ~~Letters as a campaign channel (batch letters with review and Pingen costs)~~ — built
  03.10. (C.12, 1.10).
- Legacy clean-up, one release later: move open `marketing_sends` drafts into the
  Einzelansprache, drop `customers.marketing_status` and `purchase_summary`.
