# E-mail templates („Vorlagen“) — mails the operator builds without a developer

Since migration `0081` the operator builds e-mail templates in the admin screen **Vorlagen** —
without code, without a deploy — and uses them in two ways:

- **Rundmail** — one content for a whole audience (Black Week, newsletter): a template starts the
  Rundmail's content ([`CAMPAIGNS.md`](./CAMPAIGNS.md) §9).
- **Design of Mo's personal mails** — a template with the block „Mos persönlicher Text“ is
  selectable as the design of the Kampagne and Marketing mails, in Einstellungen per type or per
  campaign. Mo keeps writing the text, picking the products and minting the code; the template
  decides where each piece sits and what surrounds it.

Since 2026-11-11 (format v2) a template is **not tied to a fixed outline**: sections with up to four
columns, background pictures, web fonts and per-block styling build any layout (header with
navigation, image next to text, zigzag, product tiles, coloured bands, boxed cards), and the
**KI-Gestalter** (§6) builds and changes them from everyday language, screenshots and files.

This document owns the template format (the „interface“ every Mo capability is reachable
through), the renderer, the KI-Gestalter and the picture upload. The screen is described in
[`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.12, the code-built designs (Classic, Studio,
Performance) in [`EMAIL_DESIGNS.md`](./EMAIL_DESIGNS.md).

## 1. Why a block document (and not uploaded HTML)

A template is a **block document** — JSON with a closed vocabulary of blocks — not free HTML.
Uploaded HTML (from a mail builder, MJML, a designer) would have to be trusted with everything
Mo guarantees and the operator cannot check: the legal footer with the unsubscribe link, Outlook
for Windows (the Word engine), the 102-KB Gmail limit, https-only pictures, the tracked links,
the per-recipient pieces of a personal mail. With blocks:

- every Mo capability is a **block** (live products from the catalog, a Shopify code with „Code
  einlösen“, the live countdown, the KI-Hero, Mo's text, offer and „Frag Mo“), so a template can
  use all of them and cannot forget the mandatory ones;
- the **layout is free**: sections with columns and the style fields of every block express what a
  mail builder offers, while the renderer (§4) owns the markup — tested Outlook-safe tables — so
  whatever the operator (or the AI) builds renders everywhere;
- the KI-Gestalter (§6) gets the block catalog as its interface and can only answer with blocks,
  which are normalised and checked like any other input;
- a template is a file (§5): exported, imported, versioned.

The escape hatch is the block „Eigenes HTML“ (sanitised, §2).

## 2. The document format — the interface

```json
{
  "v": 2,
  "style": { "accentColor": "#008ccb", "buttonTextColor": "#ffffff", "textColor": "#111111",
             "headingColor": "#111111", "outerBackground": "#fafafa", "cardBackground": "#ffffff",
             "fontFamily": "montserrat", "headingFont": null, "linkColor": null,
             "buttonShape": "pill", "logoUrl": null, "contentPadding": 60, "cardRadius": 0 },
  "blocks": [ { "id": "b1", "type": "logo", "align": "center", "width": 144 },
              { "id": "s1", "type": "section", "background": "#111111", "padTop": 40, "padBottom": 40,
                "columns": [ { "id": "c1", "width": 50, "blocks": [ { "id": "i1", "type": "image", … } ] },
                             { "id": "c2", "width": 50, "valign": "middle", "blocks": [ … ] } ] },
              …,
              { "id": "bf", "type": "footer", "showSocial": true } ]
}
```

The vocabulary, limits and rules live in the pure, tested
[`mail-template-doc.mjs`](../src/lib/mail-template-doc.mjs) (`MAIL_BLOCK_CATALOG`,
`normalizeMailTemplateDoc`, `validateMailTemplateDoc`, `blockCatalogForPrompt` — the catalog with
every field, range and default, the same text the KI-Gestalter reads). Every write — editor,
import, AI — goes through `normalizeMailTemplateDoc`: unknown types and fields are dropped, colours
must be `#rrggbb`, links and pictures `https://` (`mailto:`/`tel:` for links), numbers are clamped
to their ranges, texts are cut to their limits, ids are unique across the whole tree, there is
**exactly one footer and it is last**, and each Mo block occurs at most once. Optional style fields
are **omitted when unset** — a v1 document (`"v": 1`, no sections, no style fields) is a valid v2
document and renders as before, except that once normalised (as the store hands every document
out) its coupon, countdown and products take the automatic look of format 2 (below, §4).

**Style** (whole mail): accent and button text colour, text, heading and link colour, outer and
card background, font and heading font (§4 web fonts), button shape, logo, side padding of the
content (`contentPadding` 16–60 px, default 60) and card corners (`cardRadius` 0–24 px).

**Sections** (`section`, top level only, never nested) hold **1–4 columns** (widths in %, sum 100;
presets ½+½, ⅓+⅔, ⅔+⅓, 3 and 4 columns in the editor). A section has a background colour, a
background picture with `minHeight` (text on top; the colour is the fallback), spacing above,
below and at the sides (`padX` 0 = edge to edge), the gap between columns, rounded corners and a
border; `stack` (default on) puts the columns under each other on phones, `reverse` shows the last
column first there (picture right on the desktop, on top on the phone). Each column has a
vertical alignment, a background and an inner padding. Limits: 40 blocks at the top level, 80 in
total, 12 per column (`MAIL_TEMPLATE_LIMITS`).

| Block (`type`) | Label | Main fields | In columns | Rundmail | Personal |
| --- | --- | --- | --- | --- | --- |
| `section` | Abschnitt mit Spalten | `columns`, `background`, `bgImage`, `minHeight`, `padTop/Bottom/X`, `gap`, `stack`, `reverse`, `radius`, `borderColor` | – | ✓ | ✓ |
| `logo` | Logo | `align`, `width` (60–300 px) | ✓ | ✓ | ✓ |
| `heading` | Überschrift | `text` (≤ 200, merge fields), `size` s–xl, `align`, `color`, `background` | ✓ | ✓ | ✓ |
| `text` | Text | `text` (≤ 5,000, merge fields; `**fett**`, links, lists), `size`, `bullet` (✓ → – ★ 1.), `accentBar` | ✓ | ✓ | ✓ |
| `greeting` | Anrede | `text` („Hallo {{vorname}},“), `fallback` („Hallo,“), `align` | ✓ | ✓ | ✓ |
| `image` | Bild | `src` (https), `alt` (required), `href`, `width` `full` \| `content` \| px, `align`, `radius` | ✓ | ✓ | ✓ |
| `button` | Button | `label` (≤ 60), `href`, `align`, `color`, `textColor`, `fullWidth`, `size` s–l, `shape`, `outline`, `borderColor` | ✓ | ✓ | ✓ |
| `menu` | Navigation | `items` (1–8 × label + link), `separator` (\| · / none), `uppercase`, `bold`, `color`, `fontSize` | ✓ | ✓ | ✓ |
| `product` | Produkt-Highlight | `ref` (one catalog ref), `layout` stacked \| side, `showImage/Price/Description`, `buttonLabel`, `nameSize` — drawn in the template's look | ✓ | ✓ | ✓ |
| `products` | Produkte | `title`, `refs` (1–8 catalog refs `handle` or `handle~variantId` — the shop's handles, symbols included: `atx®-hantelbank-…`; `product-ref.mjs`), `layout` `rows` \| `grid`, `cardColor`, `textColor` | – | ✓ | ✓ |
| `coupon` | Gutschein-Code | `code` (exactly as in Shopify), `headline`, `terms`, `accent`, `cardColor`, `borderStyle`, `radius`, `textColor`, `codeColor`, `codeFont`, `cta` — card with „Code einlösen“ (`/discount/<code>`) | ✓ | ✓ | ✓ |
| `countdown` | Countdown | `until` (ISO), `heading`, `tileColor`, `digitColor`, `labelColor`, `padTop/Bottom`, `background` — the live countdown picture | – | ✓ | ✓ |
| `divider`, `spacer`, `social` | Trennlinie, Abstand, Social-Media | colour, thickness (1–8 px), length (%), solid/dashed/dotted, alignment / height (4–200 px) / alignment | ✓ | ✓ | ✓ |
| `html` | Eigenes HTML | `html` (≤ 20,000; sanitised by [`mail-template-html.mjs`](../src/lib/mail-template-html.mjs): no script/style/forms/media, no event handlers or script URLs — also entity-hidden —, no srcset/poster/ping or unsafe styles, https only; must be balanced, see validation) | ✓ | ✓ | ✓ |
| `hero` | Titelbild (KI-Hero) | `src` (fallback picture), `alt`, `href`, `showHeadline` — the campaign's hero (AI, Kampagnenbild) | – | – | ✓ |
| `mo_content` | Mos persönlicher Text | `showHeading` — Mo's text for this person (the AI prose, greeting included) | – | – | ✓ (required) |
| `mo_offer` | Mos Angebot | — the products Mo picked (or the set card) with the personal code and countdown | – | – | ✓ |
| `mo_promo` | Mo-Hinweis & Button | — „Frag Mo, deinen persönlichen Berater“ with the tracked chat link | – | – | ✓ |
| `footer` | Fußzeile | `showSocial`, `background`, `textColor` — company lines, unsubscribe, imprint; mandatory, last | – | ✓ | ✓ |

**„Gestaltung“ — every content block** additionally takes spacing above / below (0–120 px), a
background, and — for text-like blocks — font size (10–72 px), weight, italic, uppercase (CSS — the
text stays normally written), letter spacing, line height and its own font. Empty means the
block's default.

**The fixed blocks in the mail's look** (2026-11-12, owner: „those fixed building blocks such as
the countdown or the code should be editable … so that it matches the template“). Coupon, countdown
and products take the template's fonts and colours on their own; their „Gestaltung“ fields override
single colours. Every field is optional and omitted while unset (defaults are never stored):

- `coupon` — `cardColor` (`#rrggbb`, the card's own fill; unset = no fill), `borderStyle`
  `dashed` (default) \| `solid` \| `none`, `radius` (0–24 px, default 8), `textColor` („Dein Code“,
  headline, terms), `codeColor`, `codeFont` (a font key like `fontFamily`), `cta` `link` (default:
  „Code einlösen →“) \| `button` (a filled button in the mail's button look: `accentColor`,
  `buttonTextColor`, `buttonShape`, Outlook-safe like the button block; where the accent vanishes on
  the card's ground the frame colour fills it), plus `padTop/padBottom/background`. Unset: texts in
  the text colour, the kicker and the terms a muted shade of it, the code in the heading colour and
  the heading font — each a readable ink on the card's ground.
- `countdown` — `tileColor`, `digitColor`, `labelColor` (units, the line in the picture and the line
  under it), `padTop/padBottom` and `background` — the row's colour AND the picture's own ground,
  so the picture blends into the row. Unset (`countdownLook`): ground = the block's background,
  else the card colour; tiles a visibly different shade of it (`shadeOf`: lighter on dark grounds,
  slightly darker on light ones — `#ffffff` → the classic `#f5f5f5`); digits in the accent colour
  when it reads on the tiles (≥ 3 : 1), else the heading colour or the stronger ink; labels a muted
  ink that reads on ground and tiles (`mutedInk`, ≥ 4.5 : 1). The heading above the picture takes
  the heading font and a readable heading colour; with a background the block is one band.
- `products` — `cardColor` (a card behind each product, 12 px apart) and `textColor` (name, price
  and description). Unset: names in the heading font and colour, prices and descriptions in the
  text colour, „Zum Produkt“ in the mail's button look.

The live blocks reuse the production data: `products` draws the classic rows / grid from the
catalog data (prices, PAngV, variants — the grid's price projection; a mail-safe picture), `product`
gets the same catalog data (the grid's price line incl. sale and „ab“
prices, a mail-safe picture — a WebP first image is replaced by the product's JPG/PNG/GIF —, a
short description ≤ 220 characters) and draws it in the template's colours and fonts. A sold-out
product may be added on purpose — the editor warns and marks it „Ausverkauft“ — and is left out of
the mail while it is sold out; a block with no available product is left out. The countdown is the
signed `/api/email-countdown/<token>` picture, drawn in the block's colours (URL parameters,
[`EMAIL_DESIGNS.md`](./EMAIL_DESIGNS.md) „Offer countdown, set card and coupon“).

**Merge fields.** `{{vorname}}` → the first name or nothing; `{{vorname|Ersatz}}` → the first
name or the fallback. Allowed in headings, texts, the greeting, buttons, menu labels, the product
button, coupon terms and the Rundmail's subject — never in custom HTML, alt texts or links (inside
a text block the link targets are left unmerged, only the text around them is merged); any
other `{{…}}` is a validation error. The first name is cleaned by `normalizeFirstName` (letters
only, title-cased when typed in one case). In a personal mail the greeting comes from Mo's text;
the template's `greeting` block is for Rundmails.

**Validation per use** (`validateMailTemplateDoc(doc, use)`, German messages naming the block,
nested blocks included): `bulk` refuses Mo blocks, `personal` requires `mo_content`. Errors — a text
or heading without text, a picture without `src`, a button without label or link, a product block
without a product, a menu without links, a section without content, a coupon without a valid code
(letters, digits, `-`, `_`), a countdown without a future end, empty HTML, `{{` in HTML or alt
texts, a placeholder (`{{` or `%7B%7B`) in any address — links and pictures of every block, menu
links, the section picture, the logo, link targets in texts and in HTML —, custom HTML that closes
or leaves open table or `div` parts or holds a whole page (it would break the mail below it, footer
included), an unknown merge field — block a send and the selection as a design. Warnings — a picture
without `alt`, a WebP picture (Outlook), a background picture without a fallback colour, text
below 4.5 : 1 contrast on its background (3 : 1 for large headings and button labels) — also an
own colour of the fixed blocks: the coupon's text (4.5) and code (3) on its card colour, its
headline in the frame colour on a card colour (3), the button label on the accent with `cta:
"button"` (3), the countdown's digits on its tiles (3) and its labels on ground and tiles (4.5),
the products' text colour on their card or the card colour (4.5) —, an empty column, a fixed code
in a personal mail, custom HTML, a first block that is not logo, picture or heading — are shown in
the editor next to the block (document-level ones on top). The automatic colours always read, so
they never warn.

**Tree operations** (find, change, remove, move, duplicate, insert anywhere, change a section's
columns) are the pure, tested [`mail-template-tree.mjs`](../src/lib/mail-template-tree.mjs); the
editor's own logic (limits, row summaries, issues per row, column widths, moving between columns)
is [`block-editor-core.mjs`](../src/lib/block-editor-core.mjs).

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
  Mo's text; the footer is always rendered. Mo blocks stand at the top level only.
- **Card rows:** the classic pieces of the composer inside a template (Mo's offer rows, buttons
  and footnote) take the template's card colour and side padding (`templateSectionRow`); on a dark
  card they sit on a white panel because the classic renderers write dark text — the panel's
  padding comes out of the row's, so the 480-px pieces (countdown picture, product grid) keep their
  width in Outlook. Mo's text and avatar sit on the same panel on a dark card (Mo's links switch to
  `#008ccb` when the accent is below 3 : 1 on white), Mo's heading and the hero headline get a
  readable ink. With the default style the rows are byte-identical to the classic ones. The
  template's own `products` and `countdown` blocks are no classic rows any more (2026-11-12):
  `renderDocSlots` hands the renderer their DATA — the products in the shared price projection, the
  countdown's signed picture URLs in the block's colours (`countdownLook`) — and the renderer draws
  them in the template's look (§2, §4), in personal mails and the Rundmail alike.
- **Size:** a template design rendering above Gmail's limit (100 KB) is reported at send time
  (fail-soft); the preview returns the mail's size (`X-Mail-Bytes`) and warns near the limit.
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
normalised document to HTML and plain text: a 600-px card (content width = 600 − 2 ×
`contentPadding`), table markup with the Outlook conditionals of
[`email-outlook.mjs`](../src/lib/email-outlook.mjs), the classic shell's CSS
([`email-shell-css.mjs`](../src/lib/email-shell-css.mjs), shared byte for byte with
`email-template.ts`), the preheader and `<title>` with merge fields applied.

- **Columns** are `td` cells with px widths (Outlook for Windows sizes by the `width` attribute) and
  gap cells between them; the 480-px media query (`col-stack`, `col-gap`, `col-img`) stacks them on
  phones and hides the gaps. `reverse` reverses the cells and sets `dir` so the last column comes
  first on the phone; `stack: false` keeps whole-number percentages that add up to 100. A column's
  padding sits on an inner cell so every column keeps exactly its computed width
  (`sectionColumnWidths`).
- **Background pictures** are a CSS background plus the `background` attribute plus a VML
  rectangle for Outlook (`v:fill type="frame"`, `aspect="atleast"`, a text box that grows with its
  content, `minHeight`); the fallback colour shows while pictures are blocked. A rounded or framed
  section draws its frame around the picture (the picture cell sits inside the frame; `minHeight`
  is the picture's height).
- **Web fonts** (Oswald, Bebas Neue, Poppins, Playfair Display, Roboto, Open Sans, Lato, Inter
  besides Montserrat, `MAIL_TEMPLATE_FONTS`): one Google-Fonts `<link>` plus `@import`, hidden from
  Outlook, which gets the classic stack via `msoHeadHtml`. Apple Mail, iOS and Outlook for Mac show
  them; Gmail and Outlook for Windows the similar system font. The stylesheet link is **not** a
  tracked link (`freezeLinks`, [`CAMPAIGNS.md`](./CAMPAIGNS.md) §9.2).
- **Readability guards:** at a column edge the default top / bottom spacing collapses (explicit
  values stay); a coupon or footer on a coloured background switches to a readable ink; in narrow
  columns the coupon code and the product card shrink so they fit, and the social icons shrink
  their spacing and size and wrap into rows (`socialIconLayout`).
- **The fixed blocks in the mail's look** (format 2, §2): the coupon card (fill inside its frame,
  the frame `dashed`/`solid`/none, its corners, the `cta: "button"` through the button block's
  Outlook-safe cell pattern); the countdown (the heading row, the desktop picture sized for Word by
  its attributes, the 350-px phone picture hidden from Outlook and swapped in by a media rule the
  head carries only then — `.cd-desk` / `.cd-phone` —, the exact deadline in the label colour; the
  slot's signed URLs already carry the colours); the products as the classic rows (picture third,
  hairline between rows) or 2-up grid (inline-block tiles, the Outlook ghost table), or with a card
  colour each product on a rounded card. On a dark card the products stand on the dark ground when
  their colours read there; otherwise they keep the white panel (inks that read on white). A raw
  version-1 document (`"v": 1`, `docFormatVersion`) keeps the classic coupon and the pre-rendered
  rows byte for byte; normalising writes format 2, so every stored template and Rundmail — they are
  normalised on their way out of the store — gets the automatic look.
- **Text part** follows the reading order (sections column by column, the original order even with
  `reverse`); a menu gives „Label: URL“ lines, a product card „Name — Preis“ plus its link.

The tests run the Outlook lint over every starter (also in a dark variant), a showcase using every
feature (send and preview, under the 90-KB budget), a dark showcase of every look field of the
fixed blocks and every child block in a narrow 4-column section; the fuzz test's random documents
carry the look fields, countdowns and product lists too. v1 rendering is pinned by snapshot
fixtures (`src/lib/__fixtures__/mail-template-v1*`):
every v1 case renders byte for byte as before format v2, except two intended changes (the shell
CSS gained the three column rules; a coupon card shows its declared corner radius). After an
intended change: `MAIL_TEMPLATE_FIXTURES=update node --test src/lib/mail-template-render-v2.test.mjs`.
The footer starts with the marker `<!-- mo:footer -->` (`MAIL_FOOTER_MARKER`): the Rundmail checks
judge only what the operator wrote, not the legal notice. Images are `https` only; a picture with
blocked images still shows its `alt` text.

## 5. Storage, versions, import / export

Table **`mail_templates`** (migration `0081`): `name`, `description`, `doc` (JSONB object),
`version` (+1 on every save), `archived_at`, timestamps.
[`mail-template-store.ts`](../src/lib/mail-template-store.ts) saves with an expected version — a
second window gets a conflict („in einem anderen Fenster geändert“) instead of overwriting. Archive
hides a template from the pickers; restore brings it back; nothing is deleted (sent mails and
campaigns reference it). Format v2 needs no migration: the document is JSON and v1 documents are
valid v2 documents. Saving refuses a document over 400,000 characters (413) or above the block
limits (400 „Zu viele Bausteine — höchstens 40 untereinander und 80 insgesamt“); imports are
forgiving and cut silently.

**File format.** „Exportieren (JSON)“ writes
`{ "format": "mo-mail-template", "version": 1, "name", "description", "doc" }`
(`templateExportFile`); „Importieren“ reads the same (`parseTemplateImport`; a bare document with
`blocks` works too) and normalises it like every other input — a file from another Mo installation
or a hand-edited one is safe to import; a file from a newer format version is refused.

## 6. KI-Gestalter

The panel „KI-Gestalter“ (button „Mit KI gestalten“ in the Vorlagen and Rundmail editors,
[`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.12) is a conversation: the operator describes a mail
or a change in everyday language and may attach up to six files — **screenshots or photos of a mail
they like** (rebuilt for motion sports), banners, photos and logos to use, PDFs, HTML files and saved
mails (`.eml`). Each answer replaces the editor's document as an **unsaved change** (multi-step
„Rückgängig“); in a Rundmail it may also propose subject and preview line („Übernehmen“).

**Model and loop.** [`mail-template-assist.ts`](../src/lib/mail-template-assist.ts) runs the tier
**`designer`** with the model and effort of the team's settings (below; by default Opus 5.5 with
adaptive thinking at effort high — models, prices and limits: [`AI_MODELS.md`](./AI_MODELS.md);
`ai_usage` call site `template_assist`, summed over all steps) through the agentic loop of
[`mail-template-designer.mjs`](../src/lib/mail-template-designer.mjs) (`runDesigner`, AI SDK
`streamText` with tools, at most 8 steps):

- `search_products` — the catalog (names, live prices, availability, mail-safe pictures, links);
- `list_collections` — the shop's collections and pages for category, campaign and page links
  (Shopify; a list is cached 10 minutes, a failed or empty answer 60 s);
- `generate_image` — a picture from the picture AI (below, „Pictures from the picture AI“);
- `submit_design` — the **whole** document, notes (what it did, what is still missing) and, for a
  Rundmail, subject and preview line.

The four tools are in the list on every step of every run (also when pictures are off — the tool
then says so); the loop stays append-only (one system prompt, messages only appended), which
Claude Fable 5.2 requires.

**The prompt is the capability guide** (`designerSystemPrompt`, stable per use and house style so the
prompt cache serves it): the format, the full block catalog with every field, layout recipes (header with
navigation, image + text, zigzag, product tiles, benefit bar, coloured band, text on a picture,
boxed card) with **no fixed outline** (two differently built examples; a promo outline is only one
option when the operator sets no structure), Mo's capabilities to use **without being asked**
(merge fields, live products instead of prices in texts, the coupon with „Code einlösen“, the
countdown for a deadline, Mo blocks in personal templates, Mo's chat link „Lass dich von Mo
beraten“ (`CAMPAIGN_MO_DEEPLINK_URL` without its `utm_*`), the legal footer — and, stated
truthfully, the tracking: Rundmails count clicks per link through Mo's redirect, shop links get UTM
for the shop's analytics, revenue is credited only to Mo's personal mails via its personal codes, a
fixed coupon code is not measured — so no own UTM or tracking links), design and deliverability
rules (hierarchy, contrast,
mobile first, Outlook without rounded corners, no spam words), **a design system per mail**
(2026-11-12, owner: „everything should look cohesive and have the same look and feel“: one or two
fonts, two or three colours, one button shape, one corner radius, one spacing grid — applied to
EVERY block, the fixed ones included: the countdown's `tileColor` / `digitColor` / `labelColor` /
`background`, the coupon's `cardColor` / `borderStyle` / `radius` / `textColor` / `codeColor` /
`codeFont` / `cta`, the products' `cardColor` / `textColor`, product tiles preferably as `product`
blocks in a section; without own colours they take the mail's look; contrast checked), how to
rebuild a screenshot (layout, grid, spacing, colours, the nearest font, corner radii and button
shapes as closely as possible — effects made of pictures are generated, below — as a motion-sports
mail, never foreign texts, logos or links), when to have a picture generated, own HTML as the
exception (below) and how to change a mail (every requested change, nothing else unless the
freedom of the settings allows more; the editor's current, maybe hand-edited document is the
reference).

**Settings** (2026-11-12, owner: „high quality … and let the user make changes to the settings to
have a bit more control“). The team sets once how the KI-Gestalter works — Einstellungen →
„KI-Gestalter“ ([`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.10; one `admin_settings` row,
key `mail_designer`, migration 0078, no new one; `GET`/`POST settings/designer`, §11) — and every
run reads them (`getDesignerSettings`; the defaults without a database, a row or migration 0078).
The panel may change quality, freedom and both switches for one conversation (§3.12; the
request's `settings`, merged over the stored ones with `mergeDesignerSettings` — an invalid field is
dropped, never refused); the house style comes only from Einstellungen. Rules and texts:
[`mail-template-designer-settings.mjs`](../src/lib/mail-template-designer-settings.mjs) (tested).

- **Qualität** — which model runs and how long it thinks: Schnell, Gründlich (the default) or
  Maximal, or under „Modell und Denktiefe selbst wählen“ any of the three models with any
  **Denktiefe** (Niedrig … Maximal; the models, efforts, prices and output caps behind them:
  [`AI_MODELS.md`](./AI_MODELS.md) „The KI-Gestalter“). More Denktiefe is more careful, slower and
  dearer; the time limit stays 285 s, so at „Sehr hoch“ or „Maximal“ a run more often ends with the
  timeout message or its last checked draft — both then suggest a quality level (they think at most
  „Hoch“) or a lower Denktiefe.
- **Gestaltungsfreiheit** — a working rule (`designerRunRules`) placed as its own part of the user
  content right before the operator's instruction: **Genau nach Auftrag** changes only what the
  instruction asks (layout, order, texts, colours and blocks stay; ideas go into the notes);
  **Ausgewogen** (default) carries out the instruction with small improvements to readability,
  spacing and structure; **Frei gestalten** treats the instruction as the goal — structure, order,
  design and texts may be improved freely, blocks added or removed, bigger changes named in the
  notes.
- **Mo-Funktionen von sich aus einbauen** (default on) — the second working rule: on, the designer
  adds products, coupon, countdown, Mo's chat link and Mo blocks where they help the mail; off, only
  when the instruction asks for them or the current mail already has them (what it misses goes into
  the notes). The capability guide gives both rules precedence over everything it asks to add or
  change by itself („Arbeitsregeln des Teams“); duties always hold — „Mos persönlicher Text“ in a
  personal template, the format, the allowed sources and the checks below.
- **Bilder mit KI erzeugen** (`images`, default on; 2026-11-12) — whether the designer may hand a
  picture to the picture AI (`generate_image`, below). A third line of the working rules says it
  for the run: allowed (at most 3 pictures), switched off, or not configured (no `OPENAI_API_KEY` /
  `BLOB_READ_WRITE_TOKEN` — `designerPictureState`); the tool stays in the list either way and
  answers the same. A save without the field (a page from before the switch) keeps it on.
- **Hausstil** (≤ 2,000 characters) — the very last section of the system prompt of every run
  (`designerHouseStyleSection`, in a wrapper its text cannot close): colours, fonts, tone, words that
  never appear. It overrides the designer's own style decisions; an explicit instruction overrides
  it. Its links, codes and numbers count as named in the checks, like the operator's own words.
  Without a house style the prompt is byte for byte the one without settings (its cache stays); a
  new house style starts a new cache.
- **The run line** — every answer (and a failure once a model ran) says what the run used and cost:
  the NDJSON `run` with the model and effort that produced it, the level label („Gründlich · Claude
  Opus 5.5 · Denktiefe Hoch“), freedom, capabilities switch, the seconds of the whole request, how
  many pictures the picture AI made (`pictures`, only when there were some) and the cost of all its
  model calls in euros — the picture renders and their text checks included (`designerRunInfo`;
  unknown when the time limit cut a step or a render off — how it is priced:
  [`AI_MODELS.md`](./AI_MODELS.md)); the panel shows it under the reply („· 2 KI-Bilder · ≈ 0,74 €“).
- **Fallback** — when the chosen model is not open to this Anthropic account (Claude Fable 5.2
  requires 30-day data retention — [`AI_MODELS.md`](./AI_MODELS.md)), the request runs once more on
  Claude Opus 5.5 with the same settings inside the same 285 s, and the answer leads with „Claude
  Fable 5.2 ist für dieses Anthropic-Konto nicht verfügbar — diese Gestaltung kam von Claude Opus
  5.5. In Einstellungen → KI-Gestalter lässt sich ein anderes Modell wählen.“; the run line names
  Opus 5.5 (`fallbackFrom` the chosen model). Without time for it (under 60 s left) or when Opus 5.5
  is the choice, the failure names the model and Einstellungen → KI-Gestalter; after „Abbrechen“
  nothing runs again.

**Nothing the model writes is trusted.** Every submission is normalised and checked
(`checkDesignSubmission`): product refs must exist in the catalog; pictures may come only from the
attachments (`anhang:N`), the current mail, the catalog, Mo's own picture route, the pictures
`generate_image` started in this run (`https://bild.invalid/N` — not one that failed, never as
the logo or the hero's fallback, never a link; text in such a picture belongs in its alt text) or
addresses the operator wrote — never an address with a user name (`…@host`) or a placeholder; shop links must be
real pages (catalog, collections and pages looked up in Shopify, the shop, its search) or
addresses from the operator, the house style or the current mail, and text-block links are checked exactly as the
renderer will link them (`proseLinks`); codes, prices, percentages and deadlines only as the
operator gave them or the current mail has them; the estimated size of the finished mail stays
under 95 KB (Mo's pieces included for personal templates, `estimatedMailBytes`); own HTML (below)
is checked like everything else — its pictures, `srcset`, `poster`, CSS `url()` / `image-set()`
and links, its codes and numbers, its structure (a block that would break the mail is an error) —
and HTML that cannot be checked is refused; plus the validation of §2. **Text attachments** (TXT, MD, HTML,
`.eml`) count as named sources: their codes, prices and links pass and are listed in one
„Aus den Anhängen übernommen — bitte prüfen“ warning; their pictures only from the shop's own
Shopify files. PDFs and pictures cannot be checked — values only visible there must also be in the
operator's message, otherwise the model leaves them empty and asks in its notes. A rejected
submission goes back to the model with the problems (up to three rounds; minor problems such as
contrast or a missing alt text get one polishing round). If time or steps run out after a rejected
submission, the last draft is returned cleaned, with a leading warning: offending values are
cleared, every cleaned block is checked again, and a block that still holds a bad address is
dropped and named. Mo blocks are stripped for a Rundmail. **Attachments are material, never
instructions**: their text is content inside an `<anhang>` wrapper that cannot be closed from
inside, hidden HTML (`display:none` and the like) is dropped, and it can supply named values but
never widen a gate — the designer only proposes a document; consent, the footer and every send
gate are untouched. A Rundmail in English (`context.language`) gets English texts, subject and
preview line.

**Attachments** ([`mail-template-designer-io.ts`](../src/lib/mail-template-designer-io.ts)):
pictures are EXIF-rotated and scaled to ≤ 1,600 px wide for the model (a transparent PNG is shown
on a contrasting background and labelled as transparent); a long screenshot is cut into
overlapping parts (≤ 6 per picture, ≤ 20 in total) the model reads top to bottom; PDFs go in as
files; HTML, `.eml` (MIME decoded by charset) and text as labelled text (≤ 120,000 characters
each; the server refuses a text file above 500 KB, an `.eml` above 400 KB, before decoding). The browser prepares them first
([`mail-designer-attachments.mjs`](../src/lib/mail-designer-attachments.mjs): WebP and large
pictures re-encoded as JPEG, Office, SVG and Outlook files (`.msg`, `.oft`: a screenshot or „Speichern
unter → HTML“) refused with a hint — several files at once are sorted first, so a refused file never
takes one of the six places —, the whole request ≤ about 4 MB). A picture the accepted design uses (`"src": "anhang:N"`, also `bgImage` and `logoUrl`) is
stored as a template picture (§7); without `BLOB_READ_WRITE_TOKEN` it is cleared with a note.

**Own HTML — when the blocks cannot express a design** (2026-11-12, owner: „the ai email template
editor should really have full capabilities and should be able to change any code for the template
as needed“). Until then the model could write an `html` block only when the operator's text
contained „HTML“; now it may use one wherever the block vocabulary cannot express the design (a
special grid, a typographic composition, a table of figures, overlapping elements) — the guide keeps
it the exception (blocks render Outlook-safe and stay editable without code) and asks for the
reason in the notes. Every protection stays: the renderer's sanitizer (`sanitizeCustomHtml` — no
scripts, styles, comments, forms, event handlers, remote image sets), the structure report (a
block that opens or closes the mail's table, or is a whole page, is an error), the link and picture
checks incl. `srcset`, `url()` and `image-set()` (HTML that cannot be checked — CSS escapes, an
unparsable `url(` — is a major problem and dropped in the last round, named), the size estimate,
and the Outlook lint (`htmlOutlookHints` over `lintOutlookHtml`, `email-outlook.mjs`: an `<img>`
without a pixel width or wider than 600 px, a padded `<a>` button, padding on `<p>` / `<span>`,
`display:none`, sized coloured `<div>`s, `<div>` spacers — minor problems the model gets one round
to fix, then warnings for the operator). An html block of the current mail kept as it is stays the
operator's.

**Pictures from the picture AI** (`generate_image`, 2026-11-12, owner: „the ai automatically
delegates a task to a picture generating ai … a hero section with a nice integration of the
headline in the hero picture … a nice looking barrier tape“). Core
[`mail-designer-pictures.mjs`](../src/lib/mail-designer-pictures.mjs) (tested), I/O
[`mail-designer-pictures-io.ts`](../src/lib/mail-designer-pictures-io.ts), the swap in
`mail-template-designer.mjs`.

- **What for** — a picture the shop does not have: a hero with the headline integrated into the
  picture, a mood or background picture for a section (`bgImage`, live text over it), a decorative
  element (barrier tape, torn-paper edge, badge, sticker — transparent PNG on request), consistent
  icons for a benefit bar, a seasonal banner; in a screenshot rebuild, the effects that are made of
  pictures. Never invented product photos: products only with `productRefs`, whose catalogue
  photos go along as references (`images.edit`, as in the hero pipeline). Never prices,
  percentages, codes, dates, legal text or links in a picture (`forbiddenPictureText` refuses such
  a `textInImage`); the text in a picture also goes into the alt text, and what matters stays live
  text (blocked pictures, image-only mails and spam filters).
- **The input** — `purpose` (hero · banner · background · decoration · icon · scene), `prompt`
  (subject, style, the mail's colours as #rrggbb, composition, where live text needs room — best in
  English), `aspect` (wide 1536×1024 · banner 1536×512 · square 1024×1024 · tall 1024×1536 — sizes
  gpt-image-2 renders; the 3:2 fallback of a banner is cropped to its middle band), optional
  `textInImage` (≤ 60 characters, exactly as written), `transparent`, `productRefs` (≤ 4), `name`
  (for the operator) and `realistic` (photo-like — default for hero, banner, background, scene).
  An invalid call, unknown product refs, too little time (under 75 s before the deadline) or the
  limit (3 pictures per run; a failed one frees its place) start nothing and say why.
- **Asynchronous** — the tool answers AT ONCE with `https://bild.invalid/N` (RFC 2606, never
  resolves), width, height and the height at 600 px; the picture renders in the background (20–60 s)
  while the model goes on (`createPictureStudio`), the panel shows „Lässt ein Bild erzeugen: …“ and
  „Bild 1 von 2 fertig“. The checks accept exactly the pictures of this run; one that has already
  failed is a problem the model fixes (another description, another picture, or the block removed).
- **The render** — the hero pipeline's chain in the picture's format (`designerPictureAttempts`:
  gpt-image-2, its classic size, gpt-image-1.5; `EMAIL_HERO_IMAGE_MODEL` / `EMAIL_HERO_IMAGE_QUALITY`
  apply; a refusal of the subject ends the chain). A picture with text is read back once by a
  vision call on the analyst tier — transcribed without the expected text, compared letter for
  letter (`pictureTextVerdict`); wrong or unreadable text gets one more render with the spelling
  stressed when 70 s are left, the better one is kept, and a text still not certainly right is a
  warning (`EMAIL_HERO_QA=off` switches the check off).
- **The end of the run** — the pictures the accepted design uses are awaited until 3 s after the
  model's deadline (unused ones are aborted), stored like template pictures (§7, files
  `template-ki-…`, with the AI marking of `email-hero-marking.mjs`; an icon at most 320 px wide) and
  swapped in (`finishDesignerPictures`). A picture that failed, did not finish or could not be stored
  is removed cleanly — its image block dropped, a section's background picture cleared with its
  colour kept, an `<img>` in html removed — and a warning names it with the reason. Under a
  photo-like picture Mo puts the EU label „AI GENERATED“ (the icon of Mo's AI heroes, 73 px, right;
  EU AI Act Art. 50 — [`EMAIL_DESIGNS.md`](./EMAIL_DESIGNS.md) „Labelling“), once, and says so.
- **Costs** — every render and text check is recorded in `ai_usage` (call site `template_image`,
  with its model) and counted in the run line's cost; about 0.20 € per picture
  ([`AI_MODELS.md`](./AI_MODELS.md)). Needs `OPENAI_API_KEY` and `BLOB_READ_WRITE_TOKEN`; without
  them, or with „Bilder mit KI erzeugen“ off, the working rules say so and the tool answers that
  pictures cannot be made here.

**Preview size.** The live preview shows the mail's size from 90 KB on (`X-Mail-Bytes`), red above
100 KB.

**Route.** `POST /api/admin/vorlagen/assist` (`maxDuration` 300 s): errors before the stream are
the usual JSON envelope (400, 413, 503 without `ANTHROPIC_API_KEY`); then NDJSON lines
`progress` (with a heartbeat every 15 s) and exactly one `result` or `error` (with the run line
`run`); the model is stopped at 285 s — whatever model and effort the settings choose, a second run
included — generated pictures are awaited until 288 s and stored by about 293 s, so the answer
always arrives. Contract: [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §11.

## 7. Pictures

„Bild hochladen“ in the blocks Bild, Logo, Titelbild, the section background picture and the own
logo in „Farben & Schrift“ — and the attachment pictures the KI-Gestalter uses:
[`mail-template-image.ts`](../src/lib/mail-template-image.ts) (`POST /api/admin/vorlagen/image`,
raw bytes ≤ 4 MB, JPEG/PNG/WebP/GIF). The picture is EXIF-oriented, scaled to at most 1,200 px
wide, stripped of metadata and stored as JPEG (PNG with transparency); WebP becomes JPEG/PNG
(classic Outlook cannot show WebP). Animated GIFs are kept byte for byte when they fit (≤ 1,200 px,
≤ 2 MB). Stored in the Blob store under `email-heroes/template-…` and served by
`/api/email-hero-image/<file>`; template pictures are never deleted (sent mails reference them)
and never erased with a person ([`email-hero-blob.mjs`](../src/lib/email-hero-blob.mjs)
`isTemplateImageFile`). Needs `BLOB_READ_WRITE_TOKEN`; without it the field takes a URL only.
The pictures the KI-Gestalter has generated (§6) are stored the same way as `template-ki-…`, but
with the machine-readable AI marking written into the file (`email-hero-marking.mjs`) instead of
no metadata at all.

## 8. Files at a glance

| File | Role |
| --- | --- |
| `src/lib/mail-template-doc.mjs` (+ tests incl. `-v2`) | Format: catalog, fonts, normalise, validate, merge fields, starters, file format, prompt catalog |
| `src/lib/mail-template-tree.mjs` (+ test) | Tree operations on a document (sections and columns) |
| `src/lib/mail-template-render.mjs` (+ tests incl. `-v2`, `__fixtures__/`) | Renderer: HTML + text, columns, VML backgrounds, web fonts, Outlook-safe, footer marker |
| `src/lib/email-shell-css.mjs` | The classic shell's CSS (+ column rules), shared with `email-template.ts` |
| `src/lib/mail-template-html.mjs` (+ test) | The „Eigenes HTML“ block: quote-aware sanitizer, structure report (balance, whole page), its URLs, entity decoding |
| `src/lib/mail-template-slots.mjs` (+ test) | Live data of product blocks: product card data, text lines, empty blocks, raw block limits |
| `src/lib/mail-template-store.ts` | `mail_templates` I/O, versions, usage |
| `src/lib/mail-template-design.ts` | Template → design (`vorlage-<id>`), slots, card rows |
| `src/lib/mail-template-designer.mjs` (+ test, `-provider` test) | KI-Gestalter core: prompt, request, attachments as content, working rules, checks, tool loop, fallback rule, run line |
| `src/lib/mail-template-designer-settings.mjs` (+ test) | KI-Gestalter settings: models, Denktiefe, quality levels, freedom, capabilities switch, house style, output cap |
| `src/lib/mail-template-designer-io.ts` | KI-Gestalter I/O: catalog, collections, attachments (sharp), picture storage |
| `src/lib/mail-designer-pictures.mjs` (+ test) | KI-Gestalter picture tool core (`generate_image`): input rules, image prompt, attempt chain, text check, the studio of a run |
| `src/lib/mail-designer-pictures-io.ts` | KI-Gestalter picture tool I/O: OpenAI renders with reference photos, the text check (vision), storage with the AI marking |
| `src/lib/mail-template-assist.ts` | KI-Gestalter wiring: settings, model, caching, fallback run, usage, run line |
| `src/lib/mail-designer-client.mjs`, `mail-designer-attachments.mjs`, `admin-stream-core.mjs` (+ tests) | Panel logic: request body, turns, attachment limits, NDJSON reading |
| `src/lib/block-editor-core.mjs` (+ test) | Editor logic: limits, summaries, issues per row, column widths, moving |
| `src/lib/mail-template-image.ts` | Picture upload pipeline |
| `src/app/admin/VorlagenTab.tsx`, `src/app/admin/vorlagen/*` | The screen: list, editor (`BlockEditor`, `SectionEditor`, `BlockSettings`, `BlockStyleFields`, `DocStyleFields`), live preview, `DesignerPanel` |
| `src/app/api/admin/vorlagen/{route,preview,image,assist}` | Admin API (§11 of `ADMIN_DASHBOARD.md`) |
