# Wissen — Q&A knowledge enhancement from customer conversations

Turns conversations where Mo lacked knowledge into published Q&A: shown in the
storefront PDP "Q&A" tab, and fed back into Mo's context so the same question
never stumps him twice.

## Flow

```
Beratung (Mo scheitert / übergibt ans Kontaktformular)
   │  analysis_quality ∈ {unmet_need, dropped_off}  ODER  show_contact_form fired
   ▼
"Gespräche scannen" (admin Wissen tab, explicit click)
   │  1 Haiku pass per conversation (lib/qa-scan → lib/qa-draft)
   │  → { Wissenslücke, präzise Frage, Produkt-Handle? }  → qa_entries (status: open)
   ▼
Operator beantwortet im Wissen-Tab (Frage/Produkt anpassbar)  → status: answered
   ▼
"Veröffentlichen"
   ├─ Produkt-Frage → Shopify metafieldsSet auf custom.qa (JSON [{q,a}])
   │     → PDP-Q&A-Tab (Theme liest das Metafeld)
   │     → sofortiger Einzelprodukt-Refresh im Katalog-Blob (Mo weiß es SOFORT)
   │     → Nightly-Sync + Embeddings decken den Rest ab (Product.qa)
   └─ Allgemeine Frage → Mos System-Prompt-Wissensbasis (qa_entries, 5-min-Cache)
```

## Eligibility ("is there already a category for this?")

There is no separate analysis category; the existing signals ARE the flag:

- `analysis_quality = 'unmet_need'` ("Offener Bedarf") or `'dropped_off'`
  ("Abgesprungen") from the per-conversation analysis (Gespräche tab), OR
- the conversation contains a `show_contact_form` tool row (Mo handed over to
  a human).

`conversations.qa_scanned_at` marks a conversation as scanned (even when no
gap was found) so the bulk scan never re-spends tokens. Conversations must be
ANALYSED first to qualify via quality (the contact-form signal works without
analysis).

## Files

| File | Role |
| --- | --- |
| `migrations/0036_qa_entries.sql` | `qa_entries` table + `conversations.qa_scanned_at`. |
| `src/lib/qa-core.mjs` | Pure core: eligibility, draft prompt+parser, fingerprint de-dup, `custom.qa` format (parse/merge/serialize). |
| `src/lib/qa-store.ts` | CRUD + scan candidates + cached general-QA loader for the chat hot path. |
| `src/lib/qa-draft.ts` | The Haiku draft pass (call site `qa_draft`, linked to the conversation FK). |
| `src/lib/qa-scan.ts` | Orchestration: transcript → draft → entry → scanned stamp. |
| `src/lib/shopify-qa.ts` | Publish: handle → GID, `metafieldsSet` on `custom.qa`, targeted catalog refresh. |
| `src/app/api/admin/qa/*` | list / scan / draft / answer / publish / dismiss routes. |
| `src/app/admin/WissenTab.tsx` + `WissenWorkspace.tsx` | The admin queue UI. |

## How the knowledge reaches Mo

1. **Product-linked Q&A** — the `custom.qa` metafield flows through the
   catalog sync (generic metafield capture) into `Product.qa`:
   - rendered in the pre-retrieved product block ("Geprüfte Kunden-Q&A", up
     to 5 pairs, marked as team-verified so Mo may answer verbatim);
   - embedded ("Kundenfragen & Antworten" section in the embedding doc) so the
     next shopper asking the same thing retrieves this product;
   - exposed on `GET /api/products` (`qa`) for the widget.
   Publishing also triggers the SAME targeted single-product refresh the stock
   webhook uses, so Mo knows immediately — the nightly sync is the backstop.
2. **General Q&A** (no product) — `qa_entries` rows with
   `status='published' AND product_id IS NULL` are injected into the system
   prompt as "Wissensbasis aus Kundenfragen" (capped at 30, in-memory cached
   for 5 minutes on the chat path — a publish is live within ~5 min).

## Shopify prerequisites

- The app needs the **`write_products`** scope (metafieldsSet). Reads already
  required `read_products`.
- A product metafield **definition** for `custom.qa` (type: JSON) with
  **storefront access enabled** must exist so the theme can read
  `product.metafields.custom.qa` — see the operator checklist in the PR /
  admin docs. `metafieldsSet` itself works without a definition, but the
  definition makes values visible in the Shopify admin product page and
  readable from Liquid.

## i18n (German + English) — the team writes German ONLY

The storefront runs German and English, but nobody maintains two answers:

- The operator writes the German pair. At **publish time** the backend runs
  ONE cheap Haiku translation pass (call site `qa_translate`) — unless the
  entry already carries an English pair (cached from an earlier publish, or
  operator-provided in the Wissen tab's optional "Englische Version" fields).
- The metafield stores both: `[{ "q", "a", "q_en", "a_en" }]`. The theme picks
  the storefront language and falls back to German when `q_en`/`a_en` are
  absent; pre-i18n values (plain `{q,a}`) keep working everywhere.
- Mo's context is locale-aware: the English prompt (product Q&A lines + the
  general knowledge block) prefers the English pair and falls back to German
  (Mo translates on the fly).
- A failed translation NEVER blocks a publish — the pair goes out German-only
  and re-publishing retries. Clearing the English override fields forces a
  fresh auto-translation on the next publish (e.g. after editing the German).
- Columns: `qa_entries.question_en` / `answer_en` (migration 0037).

## Produkt-Links in Antworten (markdown)

Answers may contain **markdown links** `[Angezeigter Text](https://…)` — the
storefront and the admin preview render them as clickable text, never as a raw
URL. Questions stay plain text.

- **Eingabe:** the Wissen tab's answer field explains the syntax; the
  „Produkt verlinken“ helper searches the synced catalog
  (`/api/admin/catalog/search`, which returns the storefront `url`) and
  inserts a ready `[Produktname](URL)` at the cursor. A live preview appears
  as soon as the answer contains a link (`qa-links.mjs` — the SAME renderer
  used at publish time, so preview = storefront).
- **Metafeld:** the serializer writes the raw markdown as `a` (source of
  truth) and ADDITIONALLY `a_html` / `a_en_html` — pre-rendered, escaped HTML
  with plain anchors (`target="_blank" rel="noopener noreferrer"`, no inline
  styles) — but only for answers that actually contain a link. **Theme rule:**
  render `a_html` when present, else `a` (no markdown parser needed in
  Liquid); style the anchors with theme CSS. The HTML is recomputed from the
  text on every publish/unpublish, so text and HTML can never drift.
- **Mo:** the prompt context keeps the raw markdown (`a`) — the chat renders
  markdown links natively, so Mo reuses them verbatim.
- **Übersetzung:** the publish-time translation pass is instructed to keep
  `[text](url)` intact — label translated, URL byte-identical.
- **Sicherheit:** `qa-links.mjs` escapes every fragment and only ever links
  http(s) URLs (bare URLs are linkified with a compact host/path label).

## Reversibility ("Zurückziehen")

Every publish is one-click reversible from the Wissen tab: a published entry
shows **Zurückziehen** instead of Verwerfen. It

- product-linked → removes the pair from the product's `custom.qa` metafield
  (fingerprint match, idempotent; an empty list is written as `[]`, the theme
  hides the tab) and runs the same targeted catalog refresh as publish, so Mo
  forgets it immediately;
- general → drops it from Mo's prompt knowledge base (cache invalidated;
  other warm instances follow within the 5-minute TTL);
- returns the entry to **answered**, so it can be edited, re-published or
  dismissed.

Route: `POST /api/admin/qa/unpublish { id }` (access-logged as
`qa.unpublish`).

Dismissed entries are recoverable too: the "Verworfen" view shows a
**Wiederherstellen** button (`POST /api/admin/qa/restore`, access-logged as
`qa.restore`) that returns the entry to *open* (or *answered* when it already
carries an answer). Refused with 409 when the same question meanwhile exists
actively in the queue — two active copies would fight the de-dup rule.

## Cost & safety

- Only the explicit "Gespräche scannen" / "Entwurf" clicks spend tokens
  (Haiku, ~like the bulk conversation analysis; usage recorded under
  `qa_draft`, conversation-linked so it cascade-deletes).
- Drafted questions must be free of personal details (prompt rule); the
  operator reviews EVERYTHING before it becomes public — nothing auto-publishes.
- De-dup: a normalized question fingerprint blocks duplicate queue entries;
  the metafield merge replaces same-fingerprint pairs instead of appending.
- A published Q&A survives retention/erasure of its source conversation
  (`conversation_id` detaches via ON DELETE SET NULL).
