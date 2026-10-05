# E-mail designs — history notes and the default-hero prompt

Archived 2026-10-05 from docs/EMAIL_DESIGNS.md — historical, not maintained.

Current state: [`docs/EMAIL_DESIGNS.md`](../EMAIL_DESIGNS.md). The passages below are quoted in their
original German wording as they stood before the 2026-10-05 docs restructure (which also translated
EMAIL_DESIGNS.md into English).

## Model choice note (2026-09)

> **Modell:** `gpt-image-2` (OpenAI, April 2026) — führt die Text-to-Image-Arena (blinde
> Nutzer-Votes) an, natives „Thinking" vor dem Rendern, freie Auflösungen, und in der hohen
> Qualitätsstufe rund ein Drittel günstiger als `gpt-image-1` (das OpenAI am 23.10.2026 abschaltet).
> Qualität `high`.

Not verifiable against the code. `src/lib/ai-pricing.mjs` (list pricing 2026-09) puts a
1536×1024 high-quality image at ≈ $0.19 for `gpt-image-2` and ≈ $0.25 for `gpt-image-1`.

The section „Kennzeichnung „KI-generiertes Bild““ and the file table still named `gpt-image-1` as
the per-send hero model, and the gradient and storage paragraphs spoke of PNG files; since the
switch to `gpt-image-2` (fallback `gpt-image-1.5`) heroes are stored as JPEG.

## How the hero composition rule evolved

> Der Tail (`HERO_PROMPT_STYLE_TAIL`) beginnt mit der Layout-Regel: linke 45 % ruhig, die Szene in
> den rechten 55 %. Die Geschichte dahinter: Zuerst schützte er 45 % ohne jeden Verlauf (die
> Schlagzeile lag über Bild, das voll sein durfte), dann die ganze 55-%-Spalte mit höchstens zwei
> Objekten (lesbar, aber Bildfläche verschenkt). Seit der serverseitige Verlauf die Lesbarkeit
> garantiert, darf die Szene wieder so breit sein, wie es das Verkaufen braucht.

> Szenen-Anweisung und Style-Tail müssen sich decken — Unit-Tests prüfen genau das, seit die beiden
> einmal auseinanderliefen (eine Änderung landete im Schema, verfehlte aber die Szenen-Anweisung,
> die weiterhin behauptete, Markennamen sagten dem Bildmodell nichts).

> Vorher bekam das Bildmodell nur die Kategorie („Power Racks"), was zu generischen
> Fitnessstudio-Motiven führte.

The EU-label table listed „Klartext statt nur Symbol — Text ist Pflichtbestandteil“ and „Reiner
HTML-Text (Screenreader) … bei blockierten Bildern bleibt der Text sichtbar“ from an earlier label
built as an HTML text pill; the label has since been the official EU lockup as an `<img>` with
`alt`/`title` (`src/lib/email-designs/performance.ts`, `aiImageLabel`).

## Design changes

- Set card (Performance): earlier versions used dark surfaces; the card is now the light card frame
  of the product cards („keine dunklen Flächen mehr“).
- Discount code: before the coupon card (`renderDiscountCoupon`), campaign mails showed the code as
  a bold line in the small print.

## The prompt given for the default hero image

EMAIL_DESIGNS.md gave this prompt for generating the default hero once, externally, and saving it as
`public/email-hero-default.jpg` (today a 1536×1024 AI-generated JPEG; whether it was made from
exactly this prompt is not recorded):

> Photorealistic premium e-commerce hero shot in a bright modern home gym,
> WIDE LANDSCAPE 3:2 (1536×1024): a matte black steel water bottle, black
> resistance bands, a coiled black battle rope and a heavy-duty lifting strap
> arranged on a light concrete floor in front of a black power rack — all of
> it in the RIGHT HALF of the frame. The LEFT 45% of the frame must stay very
> bright, soft and almost empty (an out-of-focus near-white wall/floor area
> that fades smoothly into the scene), because dark headline text is placed
> there. Soft natural daylight, clean white and light-grey tones with subtle
> red accents, shallow depth of field, calm and motivating mood. Strictly no
> text, no lettering, no logos, no watermarks, no people.

The note that followed — „Das aktuelle Hochformat-Bild sollte damit ersetzt werden …“ — is done:
the file is the landscape image.
