# E-mail templates („Vorlagen“) — mails the operator builds without a developer

Since migration `0081` the operator builds e-mail templates in the admin screen **Vorlagen** —
without code, without a deploy — and uses them in two ways:

- **Rundmail** — one content for a whole audience (Black Week, newsletter): a template starts the
  Rundmail's content ([`CAMPAIGNS.md`](./CAMPAIGNS.md) §9).
- **Design of Mo's personal mails** — a template with the block „Mos persönlicher Text“ is
  selectable as the design of the Kampagne and Marketing mails, in Einstellungen per type or per
  campaign. Mo keeps writing the text, picking the products and minting the code; the template
  decides where each piece sits and what surrounds it.

This document owns the template format (the „interface“ every Mo capability is reachable
through), the renderer, the AI assistant and the picture upload. The screen is described in
[`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.12, the code-built designs (Classic, Studio,
Performance) in [`EMAIL_DESIGNS.md`](./EMAIL_DESIGNS.md).

## 1. Why a block document (and not uploaded HTML)

A template is a **block document** — JSON with a closed vocabulary of blocks — not free HTML.
Uploaded HTML (from a mail builder, MJML, a designer) would have to be trusted with everything
Mo guarantees and the operator cannot check: the legal footer with the unsubscribe link, Outlook
for Windows (the Word engine), the 102-KB Gmail limit, https-only pictures, the tracked links,
the per-recipient pieces of a personal mail. With blocks:

- every Mo capability is a **block** (products from the catalog, a Shopify code with „Code
  einlösen“, the live countdown, the KI-Hero, Mo's text, offer and „Frag Mo“), so a template can
  use all of them and cannot forget the mandatory ones;
- the renderer (§4) owns the markup — tested Outlook-safe tables, the same CSS as the classic
  shell — so whatever the operator builds renders everywhere;
- the AI assistant (§6) gets the block catalog as its interface and can only answer with blocks,
  which are normalised like any other input;
- a template is a file (§5): exported, imported, versioned.

The escape hatch is the block „Eigenes HTML“ (sanitised, §2).

## 2. The document format — the interface

```json
{
  "v": 1,
  "style": { "accentColor": "#008ccb", "buttonTextColor": "#ffffff", "textColor": "#111111",
             "headingColor": "#111111", "outerBackground": "#fafafa", "fontFamily": "montserrat",
             "buttonShape": "pill", "logoUrl": null },
  "blocks": [ { "id": "b1", "type": "logo", "align": "center", "width": 144 }, …,
              { "id": "bf", "type": "footer", "showSocial": true } ]
}
```

The vocabulary, limits and rules live in the pure, tested
[`mail-template-doc.mjs`](../src/lib/mail-template-doc.mjs) (`MAIL_BLOCK_CATALOG`,
`normalizeMailTemplateDoc`, `validateMailTemplateDoc`). Every write — editor, import, AI — goes
through `normalizeMailTemplateDoc`: unknown types and fields are dropped, colours must be
`#rrggbb`, links and pictures `https://` (`mailto:`/`tel:` for links), texts are cut to their
limits, there is **exactly one footer and it is last**, and each Mo block occurs at most once.

| Block (`type`) | Label | Fields | Rundmail | Personal |
| --- | --- | --- | --- | --- |
| `logo` | Logo | `align`, `width` (60–300 px) | ✓ | ✓ |
| `heading` | Überschrift | `text` (≤ 200, merge fields), `size` s–xl, `align`, `color`, `background` | ✓ | ✓ |
| `text` | Text | `text` (≤ 5,000, merge fields; `**fett**`, links), `size`, `align`, `color`, `background` | ✓ | ✓ |
| `greeting` | Anrede | `text` („Hallo {{vorname}},“), `fallback` („Hallo,“), `align` | ✓ | ✓ |
| `image` | Bild | `src` (https), `alt` (required), `href`, `width` `full` (600 px) \| `content` (480 px) | ✓ | ✓ |
| `button` | Button | `label` (≤ 60), `href`, `align`, `color`, `textColor`, `fullWidth` | ✓ | ✓ |
| `products` | Produkte | `title`, `refs` (1–8 catalog refs `handle` or `handle~variantId`), `layout` `rows` \| `grid` | ✓ | ✓ |
| `coupon` | Gutschein-Code | `code` (exactly as in Shopify), `headline`, `terms` — card with „Code einlösen“ (`/discount/<code>`) | ✓ | ✓ |
| `countdown` | Countdown | `until` (ISO), `heading` — the live countdown picture | ✓ | ✓ |
| `divider`, `spacer`, `social` | Trennlinie, Abstand (8–80 px), Social-Media | colour / height | ✓ | ✓ |
| `html` | Eigenes HTML | `html` (≤ 20,000; sanitised: no script/style/forms/event handlers, https only) | ✓ | ✓ |
| `hero` | Titelbild (KI-Hero) | `src` (fallback picture), `alt`, `href`, `showHeadline` — the campaign's hero (AI, Kampagnenbild) | – | ✓ |
| `mo_content` | Mos persönlicher Text | `showHeading` — Mo's text for this person (the AI prose, greeting included) | – | ✓ (required) |
| `mo_offer` | Mos Angebot | — the products Mo picked (or the set card) with the personal code and countdown | – | ✓ |
| `mo_promo` | Mo-Hinweis & Button | — „Frag Mo, deinen persönlichen Berater“ with the tracked chat link | – | ✓ |
| `footer` | Fußzeile | `showSocial` — company lines, unsubscribe, imprint; mandatory, last | ✓ | ✓ |

The fixed blocks reuse the production renderers: product rows/grid and the coupon are the
classic ones (prices, PAngV, variants), the countdown is the signed `/api/email-countdown/<token>`
picture.

**Merge fields.** `{{vorname}}` → the first name or nothing; `{{vorname|Ersatz}}` → the first
name or the fallback. Allowed in headings, texts, the greeting and the Rundmail's subject; any
other `{{…}}` is a validation error. The first name is cleaned by `normalizeFirstName` (letters
only, title-cased when typed in one case). In a personal mail the greeting comes from Mo's text;
the template's `greeting` block is for Rundmails.

**Validation per use** (`validateMailTemplateDoc(doc, use)`, German messages naming the block):
`bulk` refuses Mo blocks, `personal` requires `mo_content`. Errors — a text or heading without
text, a picture without `src`, a button without label or link, a products block without a
product, a coupon without a valid code (letters, digits, `-`, `_`), a countdown without a future
end, empty HTML, an unknown merge field — block a send and the selection as a design. Warnings —
a picture without `alt`, a WebP picture (Outlook), a fixed code in a personal mail, custom HTML,
a first block that is not logo, picture or heading — are shown.

**Starters** (`MAIL_TEMPLATE_STARTERS`): „Black Week“ (dark sale design: banner, band, coupon,
countdown, product grid, large button), „Newsletter“, „Persönliche Kampagne“ (the Mo blocks in the
look of the classic design) and „Leer“.

## 3. Templates as designs of Mo's personal mails

[`mail-template-design.ts`](../src/lib/mail-template-design.ts) turns a template with
`mo_content` into a `ResolvedEmailDesign` under the design key **`vorlage-<id>`**: its theme
tokens come from the template's style, its `shell` override renders the template's blocks around
the pieces the composer hands over (Mo's text, `blocks.offerRowsHtml` / `promoRowsHtml` from the
campaign composer, the hero). The composers are untouched — they do not know which design runs.

- **Selectable** for the kinds `marketing` and `campaign` (`TEMPLATE_DESIGN_KINDS`): Einstellungen →
  Design-Bibliothek („Vorlage: …“) and the campaign editor → Gestaltung. `setEmailDesignSelection`
  refuses an archived template or one without `mo_content`.
- **Nothing is lost:** a piece without its block (no `mo_offer`, no `mo_promo`) is placed after
  Mo's text; the footer is always rendered.
- **Resolution is fail-soft:** templates are read with a 60-second cache
  (`getCachedMailTemplate`); an unreadable or archived template resolves to `null` and the caller
  falls back to the classic design.
- **Approval:** a campaign mail's approval fingerprint includes `tpl:<version>`
  (`campaign-release-core.mjs`), so saving the template after a mail was approved makes the desk
  ask for a new look before it is sent.
- A template in use (Einstellungen or a campaign) cannot lose „Mos persönlicher Text“, and one
  selected in Einstellungen cannot be archived.

## 4. Rendering

[`mail-template-render.mjs`](../src/lib/mail-template-render.mjs) (pure, tested) renders a
normalised document to HTML and plain text: a 600-px card (480-px content), table markup with the
Outlook conditionals of [`email-outlook.mjs`](../src/lib/email-outlook.mjs), the classic shell's
CSS ([`email-shell-css.mjs`](../src/lib/email-shell-css.mjs), shared byte for byte with
`email-template.ts`), the preheader, `<title>` with merge fields applied, web fonts only where the
stack needs one. The tests run the Outlook lint over every starter and keep each starter under
the size budget. The footer starts with the marker `<!-- mo:footer -->` (`MAIL_FOOTER_MARKER`):
the Rundmail checks judge only what the operator wrote, not the legal notice. Images are
`https` only; a picture with blocked images still shows its `alt` text.

## 5. Storage, versions, import / export

Table **`mail_templates`** (migration `0081`): `name`, `description`, `doc` (JSONB object),
`version` (+1 on every save), `archived_at`, timestamps.
[`mail-template-store.ts`](../src/lib/mail-template-store.ts) saves with an expected version — a
second window gets a conflict („in einem anderen Fenster geändert“) instead of overwriting. Archive
hides a template from the pickers; restore brings it back; nothing is deleted (sent mails and
campaigns reference it).

**File format.** „Exportieren (JSON)“ writes
`{ "format": "mo-mail-template", "version": 1, "name", "description", "doc" }`
(`templateExportFile`); „Importieren“ reads the same (`parseTemplateImport`; a bare document with
`blocks` works too) and normalises it like every other input — a file from another Mo installation
or a hand-edited one is safe to import; a file from a newer format version is refused.

## 6. „Mit KI gestalten“

[`mail-template-assist.ts`](../src/lib/mail-template-assist.ts) (`POST
/api/admin/vorlagen/assist`, writer tier, `ai_usage` call site `template_assist`): the operator
describes the mail („Black-Week-Mail, schwarz-gelb, großer Banner, 25 % mit BLACKWEEK25,
Countdown bis Sonntag“) or a change of the current one, optionally with a screenshot of a mail to
rebuild (≤ 3 MB). The model gets the block catalog (`blockCatalogForPrompt`) and returns a block
document plus notes. The answer is never trusted: it is normalised, kept pictures, product refs
and codes are restored from the current document, Mo blocks are stripped for a Rundmail, and the
editor shows it as an **unsaved change** to review, undo or save. The model cannot invent
pictures, products or codes that ship — it leaves them empty with a note, and the validation
blocks a send until the operator filled them. Needs `ANTHROPIC_API_KEY`.

## 7. Pictures

„Bild hochladen“ in the blocks Bild, Logo and Titelbild:
[`mail-template-image.ts`](../src/lib/mail-template-image.ts) (`POST /api/admin/vorlagen/image`,
raw bytes ≤ 4 MB, JPEG/PNG/WebP/GIF). The picture is EXIF-oriented, scaled to at most 1,200 px
wide, stripped of metadata and stored as JPEG (PNG with transparency); WebP becomes JPEG/PNG
(classic Outlook cannot show WebP). Animated GIFs are kept byte for byte when they fit (≤ 1,200 px,
≤ 2 MB). Stored in the Blob store under `email-heroes/template-…` and served by
`/api/email-hero-image/<file>`; template pictures are never deleted (sent mails reference them)
and never erased with a person ([`email-hero-blob.mjs`](../src/lib/email-hero-blob.mjs)
`isTemplateImageFile`). Needs `BLOB_READ_WRITE_TOKEN`; without it the field takes a URL only.

## 8. Files at a glance

| File | Role |
| --- | --- |
| `src/lib/mail-template-doc.mjs` (+ test) | Format: catalog, normalise, validate, merge fields, starters, file format, prompt catalog |
| `src/lib/mail-template-render.mjs` (+ test) | Renderer: HTML + text, Outlook-safe, footer marker |
| `src/lib/email-shell-css.mjs` | The classic shell's CSS, shared with `email-template.ts` |
| `src/lib/mail-template-store.ts` | `mail_templates` I/O, versions, usage |
| `src/lib/mail-template-design.ts` | Template → design (`vorlage-<id>`), product/countdown slots |
| `src/lib/mail-template-assist.ts` | „Mit KI gestalten“ |
| `src/lib/mail-template-image.ts` | Picture upload pipeline |
| `src/app/admin/VorlagenTab.tsx`, `src/app/admin/vorlagen/*` | The screen: list, editor (`BlockEditor`), live preview, AI dialog |
| `src/app/api/admin/vorlagen/{route,preview,image,assist}` | Admin API (§11 of `ADMIN_DASHBOARD.md`) |
