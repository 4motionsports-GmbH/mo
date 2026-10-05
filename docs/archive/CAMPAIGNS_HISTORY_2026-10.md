# Campaign module — history notes

Archived 2026-10-05 from docs/CAMPAIGNS.md — historical, not maintained.

Current state: [`docs/CAMPAIGNS.md`](../CAMPAIGNS.md) (rules, data, gates, endpoints) and
[`docs/ADMIN_DASHBOARD.md`](../ADMIN_DASHBOARD.md) §3.2 (screens). The texts below are kept as they
stood before the 2026-10-05 docs restructure.

## The retired Shopify newsletter sync (until migration `0066`)

Until the customer platform, the audience was the shop's SUBSCRIBED newsletter list, pulled into
`campaign_contacts` by `src/lib/campaign-sync.ts` / `campaign-sync-core.mjs` /
`src/lib/shopify-customers.ts` — daily by `/api/cron/sync-campaign-audience` and on demand by the
desk's **Sync** button (`POST /api/admin/campaign/sync`), which also linked contacts to `customers`
(`linkCampaignContactsToCustomers`, source `kampagne`). All of it is removed. Replaced by the
customer mirror (`lib/shopify-sync.ts`, bulk import + webhooks + nightly reconcile — see
`CUSTOMERS.md`), the one consent, and the audience refresh of CAMPAIGNS.md §2.3 („Zielgruppe
aktualisieren“ on the desk, `/api/cron/campaign-audiences` at night).

## The lawyer-approval box of §3 (as written after 2026-07-21)

> ✅ **APPROVED by the lawyer (2026-07-21)** for the Shopify-checkbox audience, including
> `SINGLE_OPT_IN`/`UNKNOWN`. `.env.example` ships both flags `false` so a fresh copy never sends;
> production enables them in the deployment env. The code fails closed (an absent env var means
> false), and either flag can be set false there at any time to re-lock the channel.

The approval record is in `ANWALTSDOSSIER.md` Anhang A; the production state of the flags is in
`ROLLOUT_TODO.md` 6.5.

## The widget side before the 2026-10-04 theme upload

- §4 item 5 (deep link) read: „Theme-side handling (Task F in the theme repo — a separate
  follow-up): `mo=open` auto-opens the widget after init and strips the params; the modifiers
  `mo_new=1` (start a FRESH consultation, no old thread resumed) and `mo_view=fullscreen` (open the
  panel full-screen) shape how it opens.“ `.env.example` and `src/lib/campaign-flags.mjs` still cite
  „Task F“ in comments.
- §5 „Chat-Start“ and the KPI section ended with: „The widget side (capture `mo_c` before the theme
  strips the URL parameters, send it once) is a frontend task; until it ships the column stays at
  0.“ The theme upload of 2026-10-04 (PR #73) added the head-script stash and
  `captureCampaignToken()`; as-built: `docs/frontend/05-engagement-and-kpi.md` §9.
- `campaign_chat_started` gained `test: true` for test sends on 2026-10-04.

## Letters (migration `0074`, 2026-10-03) — change notes

- Before `0074`, the 1:1 letter of Kunden → Brief accepted any complete stored address; since then
  every advertising letter, the 1:1 letter included, takes only the shipping address of the latest
  completed order (`not_purchase_address` otherwise).
- Since 03.10.2026 the purchase lines in the AI prompts (campaign mails and letters) carry no shop
  order name — date and items only.
- Before the WinAnsi fix (2026-10-03) „ “ – — … € came out as „?“ in the letter PDFs.

## Other removed details

- The Kunden screen had a bulk-draft bar; „Auswählen“ → „Zur Kampagne…“
  (`POST /api/admin/campaigns/add-recipients`) replaced it.
