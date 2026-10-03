# Customer platform rollout — open todos

The single list of what is left after the customer platform went live (PR #197 and
the follow-ups #198–#200). Work through it top to bottom; the order is deliberate.
Each item says who does it, how, and how to tell it is done. Ticked items stay in the
list until the next clean-up so the history is visible.

**Owners:** **M** = Marcel · **C** = Claude (code, docs, checks) · **F** = the freelancer
who owns the Shopify app · **L** = the lawyer · **FE** = the frontend agent (theme +
widget).
Mo's admin is German; English translations are in brackets.

Last updated: 2026-10-03.

## Done

- [x] Migrations `0061`–`0069` run on production.
- [x] Shopify scopes (incl. `read_inventory`), app reinstalled.
- [x] 13 webhooks registered by the app (each once); the hand-made admin webhooks deleted;
      `SHOPIFY_WEBHOOK_SECRET` removed from Vercel.
- [x] `SHOPIFY_CUSTOMER_SYNC_ENABLED=true`; first import done (24,357 customers,
      31,441 orders; 02.10.26 15:38).
- [x] Fixes merged: webhooks wait for the sync switch (#198), webhook script checks
      `read_inventory` (#199), counts duplicates and can `--dedupe` (#200).

## 1 · Now

- [ ] **1.6 Security fix: a typed e-mail must never count as a sign-in** — C built it 03.10.,
  M runs the migration
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

- [ ] **1.7 „Einplanen“ for campaigns (approve now, send later)** — C built it 03.10., M
  switches it on
  - **M:** right after the merge pull main and run `npm run db:migrate` (applies `0072`).
    Until it has run the review desk and campaign sends fail (they read the new columns) —
    migrate right away.
  - **M:** Vercel → `CAMPAIGN_RELEASE_ENABLED` = `true` (Production) → Redeploy. Optional:
    `CAMPAIGN_RELEASE_MAX_PER_RUN` (default 30 per 10 min), `CAMPAIGN_RELEASE_SPACING_MS`.
  - Done when: Kampagnen → a campaign → a reviewed card → „Einplanen“ (A) → „Mit dem
    nächsten Lauf“ → within 10 minutes the mail is in „Gesendet“. Lawyer: dossier § 17 (F-33)
    → goes with 3.2.

- [ ] **1.8 „Prüfen & testen“ in the campaign editor** — C built it 03.10., nothing to switch on
  - No migration, no env var. Uses the campaign send path for the test mail, so
    `CAMPAIGN_SENDS_APPROVED` must be on (it is).
  - Done when: Kampagnen → a campaign → „Bearbeiten“ → „Prüfen & testen“ shows the estimate;
    „Muster erzeugen“ shows three different people with their mails; „Testpostfach …“ with your
    own address delivers that mail (with a real code if the campaign has a discount).

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

- [ ] **3.2 Lawyer dossier** — M → L
  - Send `docs/ANWALTSDOSSIER.md` (focus §13 and §14, questions F-22 to F-30).
  - Mention the deadline: Black Friday is **27 Nov 2026**; the campaign send gate (6.5)
    needs the sign-off by **~18 Nov** so mails can go out from 20 Nov.
  - Done when: L has it and has given a date.

- [ ] **3.3 Privacy policy** (F-28) — M (L reviews) — *urgent, customer data already
  flows into Mo*
  - Add: customer and order data from the shop are processed in Mo; AI customer profiles
    (and the right to object); one shared e-mail consent and one deletion with Shopify;
    advertising letters with the right to object; AI suggestions in the Eingang; contact
    requests stored in Mo and AI-assisted replies to incoming mails (F-30); the
    retention periods (`docs/DATA_RETENTION.md`).

- [ ] **3.4 One consent text** (F-29) — M (L approves)
  - The newsletter checkbox text in the shop (checkout, account, footer) and Mo's consent
    text must say the same thing (personalised offers by e-mail, analysis of purchases and
    chats).
  - Then set `SHOPIFY_CONSENT_TEXT_VERSION` in Vercel to the new text's version (e.g.
    `shopify-2026-11`) and redeploy.

## 4 · Black Friday

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

- [ ] **5.1 Frontend task** — M → FE, then C reviews
  - Give the frontend agent `docs/frontend-handoff/FRONTEND_PROMPT_2026-10.md` plus all
    files in `docs/frontend-handoff/`.
  - Done when: its acceptance checklist is ticked; send C the screenshots (gate both blocks,
    opt-in card, „already subscribed“, erase dialog, DE + EN) and C checks them against
    the contract.

- [ ] **5.2 Compliance webhooks** — F adds M to the app's Dev Dashboard organisation,
  then M + C together (~10 min)
  - `shopify app config link` → check the toml (20 scopes, app proxy) → add the
    `compliance_topics` block (`customers/data_request`, `customers/redact`, `shop/redact`
    → `https://mo.motionsports.de/api/webhooks/shopify`) → `shopify app deploy`. No
    other topics in the toml, no reinstall.
  - **Until then:** a deletion request → „Delete customer“ in Shopify (Mo follows); if you
    use „Erase personal data“ instead, also „Löschen“ (delete) the person in Mo → Kunden.
    A data request → also look the person up in Mo → Kunden.

- [ ] **5.4 Shop sign-in detection** (customers signed in to the shop are recognised in
  the chat without „Anmelden“) — M + C, FE
  - In the 5.2 session: add the App Proxy to `shopify.app.toml` — `[app_proxy]`
    `url = "https://mo.motionsports.de/api/auth/storefront"`, `subpath = "chat"`,
    `prefix = "apps"` — and deploy.
  - FE: task 6 of the frontend prompt (calls `/apps/chat/whoami`, falls back silently while
    the proxy is missing — can ship before the proxy exists).
  - Done when: `https://www.motionsports.de/apps/chat/whoami` shows `{"signedIn":true,…}`
    while you are signed in to the shop, and the chat greets you by name without „Anmelden“.

- [ ] **5.3 App ownership** (optional) — M + F
  - Move the Shopify app to an organisation owned by motionsports, or at least keep M as a
    member, so scopes, secret and configuration no longer depend on one freelancer.

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
  F-25 (single opt-in, now one switch for all marketing mail) and F-27 (letters, Robinson
  list) is still worth having; switch a gate off in Vercel if the answer says so.

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
      manual rule from 5.2 while it is missing).
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
  - [ ] **C.9b** — M — after C's follow-up merge: Vercel → project `mo` → Settings → Cron Jobs →
        `/api/cron/shopify-reconcile` → **Run** (otherwise it happens tonight at 03:45 by itself),
        then Mo → Eingang → **„Jetzt prüfen“**.
        Done when: Einstellungen → Shopify-Abgleich shows a new „Nächtlicher Abgleich“ time and
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
- [ ] **C.3** „Chat gestartet“ (chat started): make the once-per-send count race-safe and
      index the lookup (next free migration number; `0071` went to the session-link fix) —
      low priority.
- [ ] **C.4** Komplettanalyse (full analysis report): day boundaries in Berlin time instead
      of UTC — low priority.
- [ ] **C.5** Keep this file current after every step.

## Backlog — not built, decide later

- „Serien-Mail“ for big campaigns (D-10) — see 4.1.
- Verbesserung (improvement) lane „Marketing“: offers, segments and triggers as proposals.
- Letters as a campaign channel (batch letters with review and Pingen costs); today
  letters go out per customer.
- Legacy clean-up, one release later: move open `marketing_sends` drafts into the
  Einzelansprache, drop `customers.marketing_status` and `purchase_summary`.
