# Behavior reference — how the old chat UI rendered

This document captures, in framework-agnostic terms, exactly how the
**previous React chat UI** rendered the streamed conversation. It exists
so the Shopify widget can be rebuilt in vanilla JS with the same visible
behavior, **without** access to the React source or the backend repo.

It is a *behavior* spec, not code. Where the original React did something
that no longer applies (it read products from a bundled local catalog;
the widget instead calls `GET /api/products`), the difference is called
out explicitly. Pair this with `API_CONTRACT.md` (the wire format) and
`WIDGET_SPEC.md` (the deliverable).

---

## 1. The stream: text parts vs tool parts

`POST /api/chat` returns an **AI SDK UI-message stream over SSE**. The
wire carries lower-level stream *chunks* (`text-delta`,
`tool-input-available`, … — the chunk protocol is specified in
`API_CONTRACT.md` §2); assembled client-side, they grow the `parts`
array of a single "current assistant message". This document describes
rendering in terms of those assembled parts. There are two kinds the UI
cares about:

- **Text parts** (`part.type === "text"`) — the assistant's prose,
  streamed token by token. Multiple text deltas for the same message are
  **concatenated** into one visible bubble.
- **Tool parts** (`part.type` starting with `"tool-"`) — structured tool
  calls the assistant made. Each renders as its own **card** below /
  interleaved with the text, *not* inside the prose bubble.

The old UI iterated `message.parts` **in arrival order** and rendered
each part in place:

1. If `part.type === "text"` and the text is non-empty → render a prose
   bubble (with the markdown subset, see §3).
2. Else if `part.type` starts with `"tool-"` → run the tool dispatcher
   (§2). If it returns nothing, render nothing.
3. Else → ignore the part entirely.

So a single assistant turn can be: a text bubble, then a product card,
then more text, then a contact form — in whatever order the parts
streamed. Order is preserved; the widget must not hoist all cards to the
bottom.

### Matching tool parts robustly

An assembled tool part's `type` is always exactly `tool-<name>` (never
suffixed — `tool-<name>-partial` / `tool-<name>-result` types do not
exist in the pinned AI SDK v6), and its `state` progresses
`input-streaming → input-available → output-available` (an erroring tool
yields `output-error`; there is no `"partial"`/`"result"` state). On the
wire this corresponds to the
`tool-input-start → tool-input-delta → tool-input-available →
tool-output-available` chunk sequence — see `API_CONTRACT.md` §2 for the
chunk protocol; the wire's `toolName` is the bare name (`show_product`).

Crucially, **a tool part is only renderable once its args are complete —
i.e. once the `tool-input-available` chunk has arrived and `input` is
present**. The dispatcher rendered nothing whenever `input` was missing.
So:

- While args are still streaming (`tool-input-start` /
  `tool-input-delta` chunks) → render nothing for that part yet.
- Once the `tool-input-available` chunk populates `input` → render the
  card.

### De-duplication / keying

Each tool part carries a stable `toolCallId`. The old UI used it as the
render key, so re-emitted states of the *same* call **replace** the
existing card rather than appending a second one. The vanilla widget must
do the same: key rendered tool cards by `toolCallId` and update in place,
not push a duplicate when a later state of the same call arrives (e.g.
when its `tool-output-available` chunk flips the part to
`output-available`).

### Tools that render nothing (consume silently)

Two tools always appear in the stream but **must not produce any visible
card** in production:

- `update_customer_profile` — persona bookkeeping.
- `search_products` — internal RAG; the assistant uses its result to
  decide which visible tools to call.

(The old UI had a hidden `?debug=1` mode that dumped these as small
monospace blocks. That is a dev affordance only; the production widget
should ignore both tools entirely.)

---

## 2. The six visible tools → UI cards

Each renderable tool maps to one card. The old UI looked products up in a
**bundled local catalog** by id; the widget instead **hydrates from
`GET /api/products`** (`?id=` / `?ids=`) — see `API_CONTRACT.md` §3. The
visual mapping below is what matters.

A field-availability note up front: the old local `Product` type had a
few fields the public `/api/products` response does **not** expose —
specifically `dimensions` (width/height/depth/weight) and `targetGroup`.
Those were used only in the comparison table. The widget should build the
comparison table from the fields the API actually returns
(`specifications`, `price`/`salePrice`, `deliveryTime`) and simply drop
the dimensions/target-group rows. This is flagged again in §2.2.

### 2.1 `show_product` → product card

Input: `{ productId: string; reason?: string }`.

Behavior:
- Look up the one product (`GET /api/products?id=<productId>`). **If the
  product is missing/unknown (`null`), render nothing** — the old card
  bailed out when the product wasn't found.
- Card layout (top to bottom):
  - **Image**: first entry of `images`, contained on a white background
    (products are photographed on white), lazy-loaded.
  - **Series badge**: if `series` is set, a small pill overlaid top-left
    of the image.
  - **Name**: product `name`, bold.
  - **Tag pills**: one small pill per entry in `tags`. The old UI
    color-coded a few known tags (case-insensitive): `bestseller` →
    amber, `neu`/`new` → blue, `sale` → red, `preis-tipp` → accent red,
    `premium` → purple; anything else → neutral grey. Re-create the
    color map or simplify to neutral pills — not load-bearing.
  - **Price**: if `salePrice` is set, show `salePrice` prominently in the
    sale color with the original `price` struck through next to it;
    otherwise show `price` plain. Format as German currency:
    thousands-separated, trailing ` €` (e.g. `1.499 €`) — i.e.
    `Number.toLocaleString("de-DE")` + ` €`.
  - **Key specs**: the **first 4** entries of `specifications` (object
    insertion order), each as a small label (key) + value (value) pair,
    laid out in a 2-column grid. Values stringified.
  - **Reason**: if `reason` is present, show it as an *italic* note,
    visually set off (the old UI used a left accent border). This is the
    assistant's one-line "why this product".
  - **Footer**: left = a truck icon + `deliveryTime`; right = a "Zum
    Produkt" link to `shopifyUrl`, opening in a new tab
    (`target="_blank" rel="noopener noreferrer"`), with an
    external-link icon.
- Max width ~`28rem` (it's a compact card, not full-width).

### 2.2 `compare_products` → comparison table

Input: `{ productIds: string[]; comparisonContext?: string }` (2–3 ids).

Behavior:
- Hydrate all ids (`GET /api/products?ids=a,b,c`). **The old UI rendered
  nothing if fewer than 2 products resolved.** Keep that guard (drop
  `null`s, require ≥2).
- Layout: a horizontally-scrollable table.
  - **Caption**: if `comparisonContext` is present, show it above the
    table as an italic muted line.
  - **Column headers**: one column per product. The header cell stacks
    the product image (contained on white) above the product `name`.
    There's an empty top-left corner cell for the row-label column.
  - **Rows**, in this order:
    1. **Preis** — same sale/regular price formatting as the product
       card, per column.
    2. **Spec rows** — one row per spec key. The old UI used keys present
       in **at least 2** of the products (or all keys when there are
       exactly 2 products), then showed each product's value or `—` when
       that product lacks the key.
    3. **Lieferzeit** — `deliveryTime` per column.
    4. **Links row** — a "Zum Produkt" link (`shopifyUrl`,
       `target="_blank"`) per column.
  - The old table additionally had **Maße (B×H×T)**, **Gewicht**, and
    **Zielgruppe** rows sourced from `dimensions` and `targetGroup`.
    **These fields are NOT in the public `/api/products` response — omit
    these three rows.** (If equivalent values appear inside
    `specifications`, they'll already surface via the spec rows.)

### 2.3 `add_to_cart` → quick-checkout CTA card

Input: `{ productId?: string; productIds?: string[]; message: string }`
(at least one of `productId`/`productIds` — see `API_CONTRACT.md` §2 for
the multi-product form, which postdates the old UI).

> The tool id is still `add_to_cart`, but it now drives a **direct
> checkout** and can cover one or several products in a single cart. Frame
> the card as a low-friction "order now", not an
> add-to-cart-and-keep-shopping action.

Behavior:
- Normalise to an id list (`input.productIds ?? [input.productId]`) and
  hydrate. **Render nothing if no product resolves**, and also **render
  nothing if there is no checkout link** (single: `shopifyCartUrl` absent;
  multi: top-level `cartUrl` null) — the multi-product checkout button
  always uses the server-built top-level `cartUrl`, never a client-side
  stitched permalink.
- Card layout:
  - The assistant's `message` as a short bold line at the top.
  - Each resolved product's name + price as a compact line so the shopper
    sees exactly what one click will buy.
  - A **full-width primary button** (accent fill) labeled
    `"Jetzt direkt bestellen"` with a cart/checkout icon. The button is a
    **link to the checkout permalink** (`product.shopifyCartUrl` for a
    single product, the response's top-level `cartUrl` for several),
    opening in a new tab (`target="_blank" rel="noopener noreferrer"`).
    It does **not** do an in-page fetch — it sends the shopper straight
    to Shopify checkout.
  - A small muted caption beneath:
    `"Direkt zur sicheren Kasse bei motionsports.de"`.

### 2.4 `suggest_showroom` → showroom prompt card

Input: `{ productIds: string[] }`.

Behavior:
- Hydrate the ids. **Render nothing if zero products resolve.**
- Card layout:
  - A map-pin icon + heading `"Showroom in Gröbenzell bei München"`.
  - A line that inlines the product names, comma-joined:
    `"Möchtest du <name1>, <name2> vor dem Kauf testen? Besuche unseren
    Showroom!"`.
  - A **secondary button** (outlined, not accent-filled) labeled
    `"Termin vereinbaren"` linking to
    `https://motionsports.de/pages/showroom-munchen-grobenzell`
    (`target="_blank"`), with an external-link icon.
  - A small muted caption: `"Terminvereinbarung erforderlich"`.

### 2.5 `show_contact_form` → inline contact form

Input:
`{ reason: ContactReason; message: string; productIds?: string[] }`
where `ContactReason` is one of `studio_consultation`,
`public_sector_quote`, `physio_consultation`, `bulk_discount`,
`leasing`, `maintenance`, `order_support`, `general`.

> **New (`order_support`):** the assistant now also opens this form for
> customer-service escalations that need a human at motion sports —
> order status / tracking, starting a return/refund, cancelling an
> order, complaints, or "I want to reach the team". Render it exactly
> like the other reasons (it is a normal `show_contact_form` call);
> only the label row below is new. See
> `CONTACT_FORM_ORDER_SUPPORT.md` for the full rationale and the
> recommended copy/field tweaks. Until you add the row, the
> "unknown reason → `general` label" fallback already renders a working
> form, so nothing breaks if this ships ahead of the widget.

Behavior — note this is where the widget should **diverge** from the old
UI. The old card was just a *teaser* that linked to a separate
`/contact` page (a Next.js route). The widget has no separate page, so it
must render the **actual form inline** in the chat panel (the widget
brief calls for an inline contact form posting to `/api/contact`). Below
is both: the teaser content (reason labels, "in reference to" products)
that the widget should reuse, and the real form fields from the old
standalone `/contact` page.

**Reason → German labels** (the old teaser used a title + subline per
reason; reuse the title as the form heading):

| reason                | Title (heading)                  | Subline                                                       |
| --------------------- | -------------------------------- | ------------------------------------------------------------- |
| `studio_consultation` | Persönliche Studio-Beratung      | Ein Studio-Spezialist meldet sich für ein individuelles Konzept. |
| `public_sector_quote` | Formelles Angebot anfordern      | Mit Kauf auf Rechnung, Zahlungsziel und CE-Doku.              |
| `physio_consultation` | Physio- / Reha-Beratung          | Persönliche Beratung zu Reha-Einsatz und Medizinprodukten.    |
| `bulk_discount`       | Mengenrabatt anfragen            | Wir erstellen ein individuelles Angebot.                      |
| `leasing`             | Leasing-Anfrage                  | Flexible Finanzierung für gewerbliche Kunden.                 |
| `maintenance`         | Wartungsvertrag                  | Langfristige Wartung und Ersatzteilversorgung.                |
| `order_support`       | Kontakt zum motion sports Team   | Bestellstatus, Retoure/Rückgabe, Stornierung oder Reklamation — das Team kümmert sich. |
| `general`             | Persönliche Beratung             | Wir helfen dir gerne weiter.                                  |

Unknown reason → fall back to the `general` label.

For `order_support` the **Organisation** field stays optional (these are
usually private customers), and a short **order number** helps the team a
lot — surface it via the **Nachricht** placeholder for this reason (e.g.
`"Bestellnummer + kurz dein Anliegen…"`); no backend field change is
needed since it travels inside `message`.

Card / form behavior:
- A mail icon + the reason **Title** as heading; the assistant's
  `message` shown beneath it (fall back to the reason subline if
  `message` is empty).
- If `productIds` is present, hydrate them (`GET /api/products?ids=…`)
  and show an "Im Bezug:" line listing the product names — so the
  customer sees which products the request is about. Send these ids
  through as `productIds` in the submission.
- The form fields (from the old `/contact` page):
  - **Name** — required.
  - **E-Mail** — required, `type="email"`.
  - **Organisation / Studio** — label and *required-ness* depend on
    reason: for `studio_consultation` and `public_sector_quote` the label
    is `"Organisation / Studio *"` and the field is **required**;
    otherwise label `"Organisation"` and optional.
  - **Telefon** — optional, `type="tel"`.
  - **Nachricht** — required, multi-line textarea, placeholder
    `"Beschreibe kurz dein Anliegen…"`.
- Submit button label: `"Anfrage senden"`; while submitting:
  `"Wird gesendet…"` and disabled.
- On submit, POST JSON to `/api/contact` (with the auth/session headers,
  see `API_CONTRACT.md` §4) carrying `reason`, `productIds`, `name`,
  `email`, `organization`, `phone`, `message`.
- **Success** → replace the form with a confirmation: a check icon, a
  `"Vielen Dank!"` heading, and the line `"Wir haben deine Anfrage
  erhalten und melden uns innerhalb von 1-2 Werktagen."`.
- **Error** → show the error message inline (red), keep the form filled
  so the user can retry.
- Footer caption under the form: `"Wir melden uns innerhalb von 1-2
  Werktagen. Deine Daten werden nur für die Bearbeitung deiner Anfrage
  verwendet."`

### 2.6 `offer_email_summary` → email-capture form (GDPR)

Input:
`{ message: string; trigger: string; productIds?: string[] }`.

> **New behavior — no old-React equivalent.** This tool postdates the old
> UI, so unlike the other cards there is no legacy rendering to mirror.
> The normative spec is `API_CONTRACT.md` §2 ("`offer_email_summary` →
> email-capture form") + §7; `WIDGET_SPEC.md` §7 summarises the widget
> obligations. Key behavior:

- The assistant calls this at a value-triggered moment (at most twice per
  conversation, enforced server-side). Render `message` as the intro,
  then the capture form: an email input, **two separate consent
  checkboxes**, and imprint/privacy links.
- **All consent copy comes from the backend** — the tool part's `output`
  carries `consentCopy` (labels, shared footer, imprint/privacy URLs, the
  copy `version`, the returning-customer hint, and the pre-composed
  `consentTextShown` audit string). Render it verbatim; never hard-code
  these strings. A form shown without a tool call fetches the same payload
  from `GET /api/consent-copy`.
- **BOTH boxes MUST start unchecked** (consent copy v2 — the earlier
  transactional pre-check allowance is revoked). The transactional box is
  required: keep submit gated on it; the backend rejects a submit without
  it with `400 transactional_consent_required`. Render the
  `returningHint.text` near the email input only when
  `returningHint.enabled` is true.
- Submit → `POST /api/capture-email` with the two booleans, the
  backend-provided `consentTextShown` echoed **verbatim**, and the tool's
  `trigger`. Success → confirmation line (+ "bitte bestätige…" when
  marketing DOI is pending). Dismissed without submit → one
  `email_capture_declined` KPI event.
- `productIds` is advisory only (optional cart preview); the backend
  determines the real summary/cart products server-side.

---

## 3. Markdown subset in assistant text

Assistant prose is **not** full markdown. The old UI rendered exactly two
inline constructs and nothing else (no headings, lists, code blocks,
images, blockquotes):

- **Bold**: `**text**` → `<strong>`.
- **Inline link**: `[label](url)` → `<a href="url" target="_blank"
  rel="noopener noreferrer">label</a>`.

It also split each text part on `"\n"` and rendered each line as its own
paragraph, so **newlines become paragraph breaks**.

The exact regex the old UI used (single pass, both constructs in one
alternation) — mirror this:

```
/(\*\*(.+?)\*\*)|(\[([^\]]+)\]\(([^)]+)\))/g
```

Capture-group meaning for each match:
- group 1 set → bold; group 2 is the inner text.
- group 3 set → link; group 4 is the label, group 5 is the url.

Walk the string with this regex, pushing the plain text between matches
verbatim and converting each match to `<strong>` or `<a>`. Everything
else stays literal text.

**Security**: because matched URLs come from model output, treat them as
untrusted. Build the DOM with `textContent` for label/inner text (never
`innerHTML` of model text), and when setting `href`, only allow
`http:`/`https:` (and optionally `mailto:`) schemes — reject
`javascript:`/`data:` to avoid an injection via a crafted link. The old
React version got escaping for free from JSX; the vanilla widget must do
this escaping itself.

---

## 4. Welcome state

Before any message exists, the old UI showed a minimal **welcome
screen** (deliberately no suggestion chips — client direction was to let
users ask freely):

- The wordmark: "**motion**sports" with `motion` bold and `sports`
  light, in the accent color.
- Heading: **"Wie kann ich dir helfen?"**
- Subline: **"Frag mich nach Empfehlungen, vergleiche Produkte oder
  beschreib einfach deine Trainingssituation."**

Once the first message is sent, the welcome screen is replaced by the
message list.

### Other ambient UI details (for parity)

- **Input**: a single-line-growing textarea (auto-grows up to ~120px),
  placeholder `"Frag mich etwas über unser Sortiment..."`, send on
  **Enter** (Shift+Enter = newline), disabled while a response is
  streaming. A small disclaimer under it: `"KI-Fitnessberater – Antworten
  können Fehler enthalten"`.
- **Typing indicator**: while the request is submitted but the assistant
  hasn't produced visible content yet, show a three-dot bouncing
  indicator in an assistant-style bubble.
- **Auto-scroll**: scroll to the newest message as content streams in.
- **User vs assistant bubbles**: user messages are right-aligned in a
  rounded bubble; assistant text is left-aligned. Tool cards render
  left-aligned in the assistant column.

---

## 5. Theme tokens (from the old `globals.css`, for reference)

The old UI was a **dark** theme. These tokens are not mandatory for a
storefront widget (which should fit motionsports.de's look), but they
document the original palette. The accent is **brand red**.

```
--bg-primary:   #0a0a0a    --text-primary:   #f0f0f0
--bg-secondary: #141414    --text-secondary: #a0a0a0
--bg-card:      #1a1a1a    --text-muted:     #666666
--border:       #2a2a2a    --accent:         #dc2626  (brand red)
--border-hover: #3a3a3a    --accent-hover:   #b91c1c
--sale:         #ef4444    --badge-new:      #3b82f6   --badge-bestseller: #f59e0b
```

The widget may adopt this dark palette or adapt to the storefront; the
load-bearing constant is the **brand-red accent (`#dc2626`)** used for
primary buttons, links, and the wordmark.
