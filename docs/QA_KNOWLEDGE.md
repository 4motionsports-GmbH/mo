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
