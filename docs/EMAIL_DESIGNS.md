# E-mail designs — architecture and how to build a new design

This document is the working guide for a (Claude Code) session that is to build a **new e-mail
design**, and the reference for the architecture behind it.

## The model in one paragraph

A design is a **code module** in `src/lib/email-designs/` — not a database record. It defines the
**general look** (the "base" layer: theme tokens and/or renderer overrides) and, on top of it,
**tailored variants per e-mail type** (`summary`, `doi`, `marketing`, `campaign` —
`EMAIL_THEME_KINDS` in `email-theme.mjs`). The database stores only the pointer — which registered
design each type currently uses (`email_design_selections`, migration 0049). That is the "version
control": old designs stay in the registry for good and so remain selectable; a redesign is
**always a new design with a new key**, never an overwrite. A campaign can override the selection
for its own mails with `campaigns.design_key` (migration 0066, editor section „Gestaltung“;
`getEmailDesignForKey` — [`CAMPAIGNS.md`](./CAMPAIGNS.md) §4 „Design and hero per campaign“).

```
classic built-ins  ←  design.theme / design.renderers   (the general template)
                   ←  design.variants[kind]             (tailoring per type)
```

Whatever a layer does not define falls through to the layer below — a design writes only what
actually differs.

## The designs

| Key | Look | Specifics |
|---|---|---|
| `classic` | Shopify-newsletter clone (the default) | Built in, no module |
| `studio` | Editorial-minimal (example/reference) | Tokens + one renderer override (`sectionBand`) + one variant (`doi` without the social row) |
| `performance` | Image-first conversion design (`hasHero: true`) | Full shell: hero with an (AI) image, personal greeting, product cards, set card + discount coupon + offer countdown in the same light card style, „Frag Mo“ panel, smiley rating, hero pipeline (below) |

## The two styling layers

1. **Theme tokens** (`theme: Partial<EmailTheme>`, see `email-theme-context.ts` /
   `email-theme.mjs`): accent colour, band colours, page background, font-stack key, button shape,
   logo override, social icons on/off. Same layout structure, different look — the cheap way.
2. **Renderer overrides** (`renderers: EmailDesignRenderers`, see `email-design-context.ts`):
   replace whole building blocks — `sectionBand`, `sectionRow`, `ctaButton`, `productGrid`,
   `productRows`, `bundleBlock` (HTML only; the text part and the PAngV price computation stay
   central), `moPromoBlock` (the Mo hint of the campaign mail — the tracked CTA URL comes in as
   input and must stay clickable), `offerCountdown`, `discountCoupon`,
   `textStyle`/`mutedTextStyle`/`linkStyle`, up to `shell` (the complete HTML document). With these
   a design can look **fundamentally different**.

On top come the **per-send render data** (`activeEmailRenderData()`, set by the send and preview
entry points via `withEmailRenderData`): data that belongs to ONE e-mail rather than to the design —
`heroImageUrl` (the individually generated hero), `heroImageMobileUrl` (its phone crop),
`heroHeadline` (the two-line hero claim) and `recipientFirstName` (the personal greeting; the design
leaves it out when the AI prose already greets).

### Newsletter rating

Image-first designs can render the smiley row „Wie hilfreich war diese Empfehlung?“
(`email-rating.mjs` + `GET /api/newsletter-rating`). The links are deliberately **anonymous** — score
and e-mail type only, no recipient identifier — so a forwarded mail never reveals who received it.
A click lands as a normal feedback row (migration 0020; `feedback.rating` / `email_kind` since 0054)
in the admin screen „Feedback“. The Performance design draws the five faces as black line drawings on
a white disc (`public/email-rating-1.png` … `-5.png`, shown at 32 px, alt text „sehr schlecht“ …
„sehr gut“) — emoji would render in colour in every mail client.

**Performance colours and buttons (owner, 06.10.2026).** Text links and the short rule under card
headlines are blue (`#008ccb`, like the badges); every card button — „Zum Produkt“, „Zur Kasse“,
„Code einlösen“ — has the black outline look of „Beratung mit Mo starten“ (white, 1 px `#111111`
border, black bold capitals). Red remains for the filled primary call-to-action buttons (the hero
button and extra CTA rows of non-campaign mails, the `ctaButton` hook), a reduced price next to the
struck-through old one, and the countdown digits.

The composers (`summary-email.ts`, `consent-copy.ts` (DOI), `marketing-email.ts`,
`campaign-email.ts`) know nothing about the active design: the send and preview entry points resolve
the stored selection (`email-design-store.ts`, 5-minute cache, fail-soft → classic) and render inside
`withEmailDesign(...)`; every public render helper checks for an override first and otherwise falls
back to the classic implementation.

## Recipe: adding a new design

1. **Create the file**: `src/lib/email-designs/<key>.ts` — a short, stable, kebab-case key. Model:
   `studio.ts` (an example with tokens, one renderer override and one variant).
2. **Export the definition** (`EmailDesignDefinition` from `registry.ts`): `key`, `name`, a German
   `description` (one sentence), `addedAt` (today's date), then `theme` / `renderers` for the
   general template and `variants` for the per-type adjustments. Set `supportedKinds` only when the
   design is deliberately not meant for all four types, and `hasHero: true` when it opens with a
   hero section (the Kampagne desk shows its hero controls only then).
3. **Register**: import it in `registry.ts` and append it to the **end** of `EMAIL_DESIGNS` (the
   list reads like a changelog).
4. **Check**: `npx tsc --noEmit && npm run lint && npm test && npm run build`.
5. **Look**: Admin → Einstellungen → Design-Bibliothek → „Vorschau“ per type (renders the real
   production composers with sample data), or locally write `renderEmailDesignPreview` from
   `email-design-preview.ts` to an HTML file. Check all four types, desktop and phone (390 px).
6. Deploy — the design appears in the library automatically. The operator picks the design per type
   in Einstellungen; a campaign can pick its own (`design_key`, above).

## Rules for every design (non-negotiable)

- **E-mail-client robustness** (header of `email-template.ts`): table layout with
  `role="presentation"` and `bgcolor=`, EVERY style inline, no flexbox/grid/SVG/background
  images/external CSS, images only as absolute https URLs, web fonts only as progressive enhancement
  with a clean fallback.
- **Content is off limits**: AI prose, product data, the lawyer-reviewed DOI text and the
  unsubscribe notice are never changed. A `shell` override MUST render `footer.unsubscribeHtml` when
  it is set, and should keep the company / Impressum block.
- **Escaping**: every dynamic string goes through `escapeHtml`/`escapeAttr`.
- **Keys are final**: never rework the key or the look of a shipped design — new design, new key.
  (Bug fixes that make a design more faithful to itself are fine.)
- **Fail-soft**: renderers must not throw; better to leave a block out than to break a send.

## Offer countdown, set card and coupon

**Countdown.** Campaign and marketing mails show under the offer how long it is still valid: the
**earlier** of the two deadlines — expiry of the discount code and expiry of the set offer
(`earliestDeadline`, `offer-countdown.mjs`, tested). The counter is **live**: the mail embeds
`GET /api/email-countdown/<token>` as an image, and on every open the server renders days / hours /
minutes until the deadline at exactly that moment — after the deadline „Angebot abgelaufen“. The
token carries only the deadline and the language, signed with the unsubscribe secret
(`email-countdown-token.mjs`, tested): nothing about the recipient, no open image service. The
image is served `no-store`, so the image proxies of Gmail and Apple Mail reload it on every open;
nothing is stored or counted per request. `?w=m` renders the 350-px phone variant the mail swaps in
on small screens.

The image is an **animated GIF that keeps counting after the request**: one frame per minute for the
next hour (`COUNTDOWN_FRAMES` × `COUNTDOWN_FRAME_MS`), played once, the last frame stays. Mail
clients load an image **once per open** — Apple Mail with Mail Privacy Protection even only once at
delivery through Apple's proxy — and then show that copy; a still image therefore looked „frozen“.
With the animation the counter ticks for an hour after each request, and no frame promises more
time than is left: it stops at the last minute of the hour, so a stale copy only **understates**.
If the offer ends within the hour, the animation counts down to „Angebot abgelaufen“ and stops
there. The limit of the medium: for clients that prefetch the image at delivery (Apple Mail Privacy
Protection) the hour starts at the prefetch — which is why the exact deadline always stands as an
HTML line under the image.

No text is rasterised at request time (Vercel has no system fonts): digits and words are
**pre-rendered** (`scripts/build-countdown-sprite.mjs` → `src/lib/generated/countdown-sprite.mjs`,
Liberation Sans Bold, 2×), and the server only composes them on SVG shapes
(`email-countdown-image.mjs`, layout and frame times tested, 564×116 px at 1×; the frames are
blended into a raw buffer in plain JS, only the GIF encode needs sharp). The image is **light** —
white ground, dark heading, red digits on light-grey tiles with a fine border, grey units — so it
sits without a break in the white card of the Performance design and on the white card of the
classic design. After changing wording or colours, run the script again and commit the generated
module.

Fallbacks: the `alt` text „Dein Angebot gilt noch …“ for blocked images, the exact deadline always
as an HTML line under the image, the same line as a snapshot in the text part; without a signing
secret (only conceivable locally) the designs show render-time tiles in days and hours. Renderer
hook `offerCountdown` (`renderOfferCountdown` in `email-template.ts`): classic shows the image + a
muted line; the Performance design a white card with the `#e5e5e5` border of the product cards
(image or tiles on top, the exact deadline as a grey line below).

**Set card.** In the Performance design the same white card frame as the product cards — a **blue**
„BUNDLE DEAL“ badge (`#008ccb`, white text), the component images, a headline with the blue stroke
of the product cards, the price trio (single prices struck through in grey, **set price black and
bold**, the saving „Du sparst …“ as a blue pill) and the black outline „Zur Kasse“ button. The headline is
short: the operator's title when it is short, otherwise „Dein persönliches Set“ (`bundleHeadline`,
tested — generated titles of the form „Set: A + B + C“ or over 40 characters give way to the
default); the full product names stand in the grey line below. The button says **„Zur Kasse“**
(„To checkout“), because the link lands in the prefilled checkout.

**Discount-code coupon.** Campaign mails with a code show it as a card of its own between the set
card and the countdown (`renderDiscountCoupon` in `email-template.ts`, renderer hook
`discountCoupon`; wording and link in `discount-coupon.mjs`, tested): the code large and bold on a
dashed blue „ticket“, next to it the value („5 % auf deine gesamte Bestellung“ — or „… auf die
empfohlenen Produkte aus dieser E-Mail“ / „… auf dein persönliches Set“, depending on the draft's
discount scope, `discount-scope.mjs`), the terms („Einmalig einlösbar · gültig bis …“) and the black
outline button **„Code einlösen“**. The button leads to Shopify's discount link
`https://motionsports.de/discount/<code>`, which stores the code in the shop session and applies it
at checkout — an e-mail cannot copy anything to the clipboard (no JavaScript), and a tap is easier
on a phone anyway. Classic: a centred dashed box with code, value, terms and the link. The text part
carries the same lines.

**Hero of the campaign mail.** Kicker („Mehr aus deinem Setup“ / „More from your setup“) in blue.
The campaign variant shows **no button in the hero** — its primary CTA is the Mo deep link that the
„Frag Mo“ card below carries (tracked) anyway. Instead, picture and headline link to
`https://motionsports.de` (desktop: a block link over the right half of the picture with a stretched
transparent `public/email-spacer.png`; phone: the picture itself). The summary, DOI and marketing
variants keep their hero button (`heroCta` per variant).

## Hero images (design „Performance“)

The Performance design opens with a large lifestyle picture. Two sources:

1. **Default image** — `public/email-hero-default.jpg` (**landscape 1536×1024**, override with
   `EMAIL_HERO_DEFAULT_URL`). Used by summary/DOI always and by marketing/campaign without an
   individual picture. It is AI-generated too (see the labelling below). To prepare a replacement,
   apply the legibility gradient with `npm run hero:gradient -- <input> <output.png>`
   (`scripts/hero-gradient.mjs`).

2. **Individual picture + headline per e-mail** (marketing + campaign only — the two types with a
   human review): in Kunden → Marketing ([`HeroImagePanel.tsx`](../src/app/admin/HeroImagePanel.tsx))
   and on the Kampagne desk (block „Hero“, [`kampagne/sections/HeroBlock.tsx`](../src/app/admin/kampagne/sections/HeroBlock.tsx);
   both on the hook `useEmailHero.ts` and `/api/admin/email-hero/*`) „Hero vorschlagen“ proposes in
   ONE AI pass both an image prompt and the two-line **hero headline** from products / prose /
   persona (`lib/email-hero.ts`); the operator adjusts both. On the desk „Erzeugen“ runs proposal
   and rendering in one go, „Anpassen…“ opens the single steps. „Bild generieren“ renders the
   picture (model and format below), derives the desktop file and the phone crop from it, uploads
   both as JPEG to Vercel Blob and stores URLs + prompt + headline on the draft (migrations
   0050/0051/0053); the headline can also be saved alone (without a new picture). Preview AND send
   read everything through `withEmailRenderData` — what is reviewed is what is sent. An empty
   headline = the design's default line per e-mail type. On the Kampagne desk the campaign's
   `hero_mode` decides who gets a KI-Hero ([`CAMPAIGNS.md`](./CAMPAIGNS.md) §4, „KPIs and the hero
   A/B test“).

### Model, format, variants, cost

**Model:** `gpt-image-2` (OpenAI), quality `high` (`HERO_PRIMARY_IMAGE_MODEL`; model choice
across the app: [`AI_MODELS.md`](./AI_MODELS.md)).

**Format:** the model renders the **hero format 1536×720** directly (2.13:1 = the 640×300 desktop
hero; both dimensions divisible by 16, as `gpt-image-2` requires for free sizes). It composes for
exactly the frame the reader sees — nothing is cropped away afterwards, and no tokens are paid for
rows that `background-size: cover` would discard.

**Attempt chain** (`heroImageAttempts`, `email-hero-variants.mjs`, tested): with reference photos
(below) first `gpt-image-2` editing the references in 1536×720, then in 1536×1024; then
1. `gpt-image-2` generating in 1536×720, 2. `gpt-image-2` in 1536×1024 (in case the free size is
refused), 3. `gpt-image-1.5` in 1536×1024 (in case the model is down). The first successful attempt
wins; every failed attempt goes to Sentry with model and size. A 3:2 result is cropped to the hero
format by `heroAspectCrop` (a centred band). Env overrides: `EMAIL_HERO_IMAGE_MODEL` (the primary
model), `EMAIL_HERO_IMAGE_QUALITY` (`low` | `medium` | `high`).

**Two files per render** (`buildHeroVariants`, tested): the **desktop file** with the legibility
gradient (below) as the hero's background, and the **phone crop** — the right 60 % of the same scene
without the gradient (`HERO_MOBILE_CROP_START = 0.4`). On the phone the picture stands under the
text; there the calm left half would only be empty wall. Both as JPEG (quality 88, mozjpeg): a
1536-px PNG weighs 1–2 MB, the JPEG a fraction. Heroes from before migration 0053 have no phone crop
and show the desktop file on the phone.

**Cost:** about $0.19 per picture at `high` (the 1536×1024 equivalent; the native format is
proportionally cheaper; `gpt-image-1.5` ≈ $0.20) plus the prompt proposal and the check. The prices
are in `ai-pricing.mjs`; the KPI screen shows the real amount (`ai_usage` call site `hero_image`;
for campaign heroes linked to the recipient by `campaign_contact_id`, summed per hero variant).

### Reference photos: the real product instead of a plausible one

Before rendering, `generateHeroImage` loads the **catalogue photos of the products** the scene is to
show (`email-hero-references.mjs`, tested): all recommended products of the mail first, then up to
two owned ones (purchase history: `productId` or `handle` = catalogue id), at most six
(`MAX_REFERENCE_IMAGES`), the first https picture of each, scaled to 768 px. With these references
the attempt chain calls `images.edit` first — the model takes over shape, proportions, colour and
lettering of the real device. (`input_fidelity: "high"` goes only to the gpt-image-1 family;
`gpt-image-2` refuses the parameter with a 400 — `inputFidelityFor`, tested.) The prompt gets a
numbered reference block („picture 1 = ATX® Power Rack 620 …“) with the instruction to
**photograph** the products in the scene instead of pasting in catalogue cut-outs. If no photo can
be loaded or the edit attempts fail, the generate chain runs; an unreachable picture never blocks.
`EMAIL_HERO_REFERENCES=off` switches the references off. The reference pictures add image-input
tokens to each call.

### Automatic check before the operator

Every render is checked by a vision model (the analyst tier, `claude-sonnet-5-5`;
`email-hero-qa.mjs`, tested) for what makes the hero work in the mail: a calm left half, devices on
the right, no foreign lettering, no pasted-in cut-outs, product fidelity, an overall score 1–10. The
picture is checked **before** the gradient (`variants.master`), because the scene is what counts. If
the check fails (a hard violation or a score below 6, `HERO_QA_MIN_SCORE`), it is rendered **once**
more and the better picture kept (`pickBestRender`). The operator sees „KI-Prüfung 8/10“ in the
toast, „(einmal neu gerendert)“ where it applies, and the notes. `EMAIL_HERO_QA=off` switches the
check off (without `ANTHROPIC_API_KEY` it is off anyway). The generate route allows 300 s for it.

**Comparing variants for customer conversations:** `npm run hero:compare` renders the most recently
stored hero prompts (or your own with `--prompts file.txt`) in several variants (default
`medium,high,high+refs`, set with `--variants`) through exactly this pipeline — the `+refs` variants
with the same reference photos as a real render, every variant with the check — and writes
`hero-compare/index.html` (images embedded; the files next to it; `--out` sets the folder): per
prompt all variants as desktop hero with headline and as phone view, first blind as A/B/C with a
favourite pick, on click with variant, model, reference count, real cost, render time and check
result. None of it touches drafts or the Blob store. `--dry-run` checks only the layout, without API
calls.

### Legibility: the gradient and the prompt zone

**The hero is a FULL-BLEED background picture:** text and button lie on the **left part** of the
picture. The text column is 55 % wide, but the text itself reaches less far — measured on the
rendered desktop hero (a long two-line headline at 40 px): headline to ~50 %, subline to ~47 %,
button to ~35 % (`HERO_TEXT_REACH_FRACTION`). So the **text** is protected, not the column — every
percent of protection beyond the text is picture area the products cannot use. The gradient must be
in the picture itself, not in CSS, because e-mail clients cannot lay gradients over images. Two
complementary ways:

1. **Deterministic (guaranteed):** right after generation `applyHeroGradient`
   (`email-hero-gradient.mjs`, with `sharp`) lays a light gradient (`#f6f6f6`, 93 % opacity) over
   the left part of the picture, before the files are encoded and stored: fully covered up to 36 % of
   the width, then a soft smoothstep fall-off to 64 % — under the subline (~47 %) still ≥ 60 %
   opacity, under the last glyphs of the headline (~50 %) ≥ 45 % (bold 40-px type stays far above the
   contrast threshold even over a black device), at the column edge (55 %) only ~23 %. The curve is
   tested. So the headline's legibility does not depend on what the image model delivers.
2. **By prompt (likely):** `HERO_PROMPT_STYLE_TAIL` asks for the left **45 %** calm and bright and
   gives the scene the right 55 %. The last 5 % under the headline are covered by the gradient —
   exactly that lets the prompt give the products more room. A unit test interlocks both numbers
   (prompt zone ≤ text reach, gradient at the text reach ≥ 45 %), so neither can drift alone. The
   prompt rule stays necessary, because the gradient can only bleach devices, not move them.

Technically: the `background` attribute + inline `background` for Gmail/Apple Mail, VML `v:rect` for
Outlook, a `bgcolor` fallback when images are blocked; on the phone the background is switched off
and the picture shown as a row of its own **under** the text.

### What the AI knows about the person

`email-hero-context.mjs` (tested): the condensed **customer understanding** (goals, space, noise,
level), the **purchase history** (what is already there — the new equipment visibly completes the
existing setup), the **recommended products with brand, product name, type and colour** (below), an
**attached set** as a group, persona/team hints, for campaigns also the **customer status** (first
buyer to regular) and the language — plus the **season** for light and mood. The headline names the
person's goal or situation; discounts, prices and product names are deliberately banned from it
(they stand deterministically elsewhere and would go stale here).

**Brand and product fidelity.** The prompt names the most important recommended product
**literally with brand and designation**, plus type and colour — for example
`ATX® Hardcore Power Rack & Pull Station FCR-780 (Power Racks, black / grey)`
(`productHeroDescriptors`). The brand pins the design language of what the shop actually sells
(ATX® is more than half of the catalogue); the type is what an image model can render reliably —
both together, neither alone. The colour comes from the catalogue specification where one exists
and is translated to English for the prompt, without its RAL code: `schwarz-150; grau-17` →
`black / grey`.

**Brand lettering on the device is allowed** — decided on purpose, because logo-free pictures
looked generic. The tail asks for the small lettering as it sits on real devices (discreetly on the
frame or end caps). It is also **the only text allowed**: no headline, no caption, no posters or
signs on the wall, no watermark. The difference matters — text *in the picture* would collide with
the headline the design itself lays over the left half.

> **Residual risk:** image models render lettering unreliably. A botched inscription is possible;
> that is why it stays small and on the device. Whoever gets a picture with crooked lettering
> renders again or deletes the brand sentence from the prompt field.

### The composition carries the scene

The tail (`HERO_PROMPT_STYLE_TAIL`) starts with the layout rule: the left 45 % calm, the scene in
the right 55 %. Since the server-side gradient guarantees legibility, the scene may be as wide as
selling needs.

The tail alone does not decide it, though: the image model reads the **scene first** and weighs it
most. So the scene instruction (`HERO_SCENE_INSTRUCTION`) prescribes what is in it and how it
stands: **all recommended products** (brand and name literally, in front as the eye-catcher — that
is the merchandise the mail is to sell), plus **one or two familiar owned devices** behind them (so
it looks like the person's own setup, not a catalogue picture), and the scene names the arrangement
itself: one connected setup on the RIGHT of the picture, large devices at the back, small ones in
front, to the left of it a calm, light wall and floor area. The scene budget is sized for that
(≤ 90 words, `MAX_HERO_SCENE_CHARS` 1400, up to six product descriptors). Scene instruction and
style tail must agree — unit tests check exactly that.

Old stored prompts are lifted to the current style rules on generation (`ensureHeroStyleTail`) — a
prompt stored before a tail change gets the current tail while the operator's own scene text is
kept. The marker is always the newest rule, so a tail update replaces every older stored prompt
automatically.

### Labelling „KI-generiertes Bild“ (EU AI Act)

The heroes are photorealistic scenes showing real products in plausible rooms — under Art. 50(4)
of the AI Act a "deepfake" (an AI image that resembles existing objects and appears authentic) —
and the shop as sender is the **deployer** the disclosure duty falls on (applicable since
2 August 2026; the chatbot side of Art. 50 is dossier F-07, [`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md)).
The Commission published official icons for it and a (voluntary) code of practice that serves as
the yardstick. As built:

| Requirement | Implementation |
|---|---|
| Visible, clear label at first contact | The **official EU label „AI GENERATED“** (`public/eu-ai-icon-email.png` — the Commission's icon, trimmed and downsized for mail, 2× at 146×28 px) bottom right in the picture area on desktop, on the phone as a row of its own directly under the picture — in the first view, not hidden by overlays. `EMAIL_AI_LABEL_ICON_URL` swaps in another hosted PNG (height 28 px, width from the file). |
| Text, not just a symbol | The artwork reads „AI GENERATED“; the label is an `<img>` with `alt`/`title` „KI-generiertes Bild“ / „AI-generated image“ — deliberately no separate text pill (`aiImageLabel` in `performance.ts`) |
| Recipient's language | `alt`/`title` DE/EN by the recipient's language |
| Accessible | Screen readers and clients with blocked images get the statement from the `alt` text; the `alt` text of the phone picture names it too |
| Machine-readable marking | Every stored file (desktop, phone, master) carries XMP `Iptc4xmpExt:DigitalSourceType = trainedAlgorithmicMedia`, `dc:description`, `xmp:CreatorTool` (the model) and EXIF `ImageDescription`/`Software` (`email-hero-marking.mjs`, tested) — the image model's provenance data does not survive re-encoding, so the industry-standard IPTC marking is written here |
| Which heroes | **Every** hero of the Performance design: the AI-generated per-send heroes (`gpt-image-2`, fallback `gpt-image-1.5`) always, the default image through the constant `DEFAULT_HERO_IS_AI_GENERATED` in `performance.ts` (`true`, since the default image is AI-generated too; set it to `false` only if it is ever replaced by a real photograph). The operator does nothing; the label cannot be switched off in the workspace. |

Open is only what code cannot do: the review by the shop or its legal counsel of whether other AI
pictures outside the hero pipeline (e.g. inserted by hand) are labelled as well.

### Storage and configuration

The Blob store of this deployment is PRIVATE (catalogue and embeddings live there too) and refuses
`access: "public"`. Hero pictures are therefore written privately as well and delivered through the
app's own public route `GET /api/email-hero-image/<file>` (mail clients load pictures anonymously
from the mailbox). The route can reach only files under `email-heroes/` — `parseHeroBlobFile`
(tested) refuses separators, traversal and names that are not `.png`, `.jpg` or `.jpeg`; that is the
boundary that keeps the private catalogue blobs unreachable. It is served with
`Cache-Control: public, max-age=31536000, immutable` (file names carry a random suffix).

Needs `OPENAI_API_KEY` + `BLOB_READ_WRITE_TOKEN`. Everything is fail-soft: without configuration or
a picture the default image always renders, never a broken send. All `EMAIL_HERO_*` variables are
documented in `.env.example`. The prompt once given for the default image is in
[`archive/EMAIL_DESIGNS_HISTORY_2026-10.md`](./archive/EMAIL_DESIGNS_HISTORY_2026-10.md).

## Files at a glance

| File | Role |
|---|---|
| `src/lib/email-designs/registry.ts` | Registry + `EmailDesignDefinition` + resolution (classic ← base ← variant) |
| `src/lib/email-designs/studio.ts` | Example design (the reference to copy) |
| `src/lib/email-designs/performance.ts` | Image-first conversion design (full shell + hero, EU label) |
| `src/lib/email-hero-gradient.mjs` | Deterministic legibility gradient over the left part of the picture (sharp), tested |
| `src/lib/email-hero-variants.mjs` | Model attempt chain, hero format, desktop and phone variant (sharp, JPEG), tested |
| `src/lib/email-hero-references.mjs` | Product reference photos: selection, prompt block, load/scale, tested |
| `src/lib/email-hero-qa.mjs` | Automatic picture check (vision model), verdict and re-render choice, tested |
| `src/lib/email-hero-marking.mjs` | Machine-readable AI marking (IPTC/XMP + EXIF) in every hero file, tested |
| `src/lib/email-countdown-image.mjs` + `api/email-countdown` | Live countdown GIF (ticks every minute for an hour) from pre-rendered glyphs, signed token (`email-countdown-token.mjs`), tested |
| `src/lib/offer-countdown.mjs` | The earlier deadline and the countdown line, tested |
| `src/lib/discount-coupon.mjs` | Coupon wording and the `/discount/<code>` link, tested |
| `src/lib/email-hero-blob.mjs` + `api/email-hero-image` | Private Blob write and public delivery of the hero pictures (with path validation) |
| `src/lib/email-hero-context.mjs` | What the AI learns about the person (purchase history, profile, products, season), the scene instruction and style tail — pure, tested |
| `src/lib/email-hero.ts` / `email-hero-store.ts` | Hero prompt proposal, picture generation (`gpt-image-2` chain + Blob), storage on the draft |
| `src/app/api/admin/email-hero/` | Routes: state, `suggest`, `generate`, `headline`, `remove` |
| `src/app/admin/useEmailHero.ts` | Shared client hook for the hero state and actions |
| `src/app/admin/HeroImagePanel.tsx` | Hero panel (picture + headline) in Kunden → Marketing |
| `src/app/admin/kampagne/sections/HeroBlock.tsx` | Hero block of the Kampagne desk's review column |
| `src/lib/email-rating.mjs` + `api/newsletter-rating` | Smiley rating (anonymous, lands in „Feedback“) |
| `src/lib/email-design-context.ts` | `withEmailDesign` / `withEmailRenderData` (AsyncLocalStorage) + the `EmailDesignRenderers` interface |
| `src/lib/email-theme-context.ts` / `email-theme.mjs` | Token layer (colours/font/buttons) + the vocabulary of the e-mail types |
| `src/lib/email-design-store.ts` | Selection per type (DB, 5-minute cache, fail-soft) and `getEmailDesignForKey` (a campaign's own design) |
| `src/lib/email-design-preview.ts` | Sample renderings per type for the admin preview |
| `src/lib/email-template.ts` | Classic shell + public render helpers (override detection), `renderOfferCountdown`, `renderDiscountCoupon` |
| `src/lib/email-products.ts` | Classic product grid/rows (override detection) |
| `src/app/admin/einstellungen/EmailSettingsWorkspace.tsx` | Design library + assignment (admin screen „Einstellungen“, `DesignPreviewDialog.tsx` for the preview) |
| `scripts/build-countdown-sprite.mjs`, `scripts/hero-gradient.mjs`, `scripts/hero-quality-compare.mjs` | Countdown glyphs (run manually, commit the output), `npm run hero:gradient`, `npm run hero:compare` |
| `migrations/0049_email_design_selections.sql` | Selection table |
