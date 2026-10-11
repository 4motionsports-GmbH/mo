# Theme task: one set of welcome-voucher texts across the shop (2026-10-11)

For the frontend agent that owns the theme repo `ms_shopify_clone`. Backend context:
[`OPTIN_REWARD_2026-10-08.md`](./OPTIN_REWARD_2026-10-08.md) (owner to-do 4 and 8) and dossier § 22.2
(`docs/ANWALTSDOSSIER.md`). **No widget change** — the widget of 2026-10-08 (`495fdf6`) already renders the
served voucher hint; the backend serves it once the owner switches it on.

## Why

The owner decided the newsletter welcome voucher on 2026-10-11 (O-1…O-9) and counsel approved the
conditions:

- **50 €** from **500 €** order value;
- for the **first** newsletter sign-up only, **after the e-mail confirmation** (double opt-in);
- **single use**, valid **30 days**;
- **reduced items and Concept2 are excluded and do not count towards the 500 €**;
- **cannot be combined** with other discounts.

Today the shop advertises **5 %** in the footer form, and the Concept2 exclusion is missing on
`/pages/rabatte` and in the (disabled) newsletter popup. Every place that advertises the voucher must say
**exactly** the same as the chat and the welcome mail (OLG Hamm 4 U 4/18: no unnamed exclusions;
dossier F-29, F-40 (d)). The chat's served text is the source: `src/lib/consent-variants.mjs` in `mo`.

## Timing — prepare now, publish at the switch flip

The new texts must not go live before the shop actually sends the 50 € voucher (the 5 % code is still sent
today), and the 5 % texts must not stay live after it. So:

1. Duplicate the live theme in the Shopify admin (Onlineshop → Themes → … → Duplizieren) or work on a
   branch, apply the texts below there, **do not publish**.
2. The owner publishes it at the flip (`docs/ROLLOUT_TODO.md`, open list „Switch-on“), in the same
   minutes as the welcome automation and `CONSENT_REWARD_ENABLED`.

## Texts (German; English where the theme has an `/en` string)

**Short claim** (footer heading, `/pages/rabatte`, popup, `/pages/newsletter-anmeldung`):
> 50 € Willkommensgutschein ab 500 € Bestellwert
>
> EN: €50 welcome voucher from €500 order value

**Conditions line** (directly under the claim and the form, small print, on every one of those places):
> Für deine erste Newsletter-Anmeldung, nach Bestätigung per E-Mail. 50 € ab 500 € Bestellwert; reduzierte
> Artikel und Concept2 sind ausgeschlossen und zählen nicht zum Bestellwert; einmal einlösbar, 30 Tage
> gültig; nicht mit anderen Rabatten kombinierbar. [Bedingungen](/pages/newsletter-gutschein)
>
> EN: For your first newsletter sign-up, after you confirm by e-mail. €50 from €500 order value; reduced
> items and Concept2 are excluded and do not count towards the order value; single use, valid 30 days;
> cannot be combined with other discounts. [Conditions](/pages/newsletter-gutschein)

Rules: no other amount and no percentage anywhere (the 5 % goes everywhere), no countdown or „nur heute“,
nothing pre-ticked, the conditions line always visible next to the claim (not behind a hover).

## Places to change (from the theme audit of 2026-10-08)

| Place | File | Change |
|---|---|---|
| Footer newsletter form | `sections/footer-group.json`, block `newsletter_UfNf8U` | 5 % → the claim + the conditions line (keeps the Concept2 exclusion, now in the shared wording) |
| `/pages/rabatte` | `templates/page.rabatte.json` | the claim + the conditions line (adds the missing Concept2 exclusion); the English „Subscribe“ button → „Anmelden“ |
| Newsletter popup (disabled) | `sections/overlay-group.json` | the claim + the conditions line, stays disabled unless the owner says otherwise |
| `/pages/newsletter-anmeldung` | its template | replace the expired Black Week copy with the claim + the conditions line |
| Blog newsletter block | `templates/blog.json` | replace the placeholder newsletter text with the claim + the conditions line |

The checkout marketing checkbox is **not** a theme setting (Shopify admin → Einstellungen → Checkout); it
stays unticked by default and carries no voucher text.

## The terms page `/pages/newsletter-gutschein`

A normal Shopify page (Onlineshop → Seiten → Seite hinzufügen, URL handle `newsletter-gutschein`), created
by the owner — content, not theme code. The draft below covers the case decided by the owner that each
customer gets a **personal code** (see `docs/ROLLOUT_TODO.md`, open list item 1); **let counsel see it
together with the final texts** (dossier § 22.2).

> **Bedingungen für den Newsletter-Willkommensgutschein**
>
> - **Wer ihn bekommt:** Bei deiner ersten Anmeldung zu unserem Newsletter erhältst du einen
>   Willkommensgutschein über 50 €. Er gilt einmal je Kundin bzw. Kunde — nicht erneut nach einer Ab- und
>   Wiederanmeldung. Anmeldungen über das Kästchen im Bezahlvorgang (Checkout) und von uns übernommene
>   Adressen sind ausgenommen.
> - **Wann er kommt:** erst nachdem du deine Anmeldung über den Link in unserer Bestätigungs-E-Mail
>   bestätigt hast. Den Code schicken wir dir dann per E-Mail.
> - **Wofür er gilt:** 50 € Nachlass auf eine Bestellung im Onlineshop motionsports.de ab 500 €
>   Bestellwert. Reduzierte Artikel (mit Streichpreis) und Artikel der Marke Concept2 sind ausgeschlossen
>   und zählen nicht zum Bestellwert.
> - **Einlösen:** Der Code ist persönlich, einmal einlösbar und 30 Tage ab Erhalt gültig. Er ist nicht mit
>   anderen Rabattcodes kombinierbar und wird nicht bar ausgezahlt.
> - **Abmeldung:** Du kannst dich jederzeit über den Abmeldelink in jeder E-Mail abmelden. Ein bereits
>   erhaltener Gutschein bleibt bis zu seinem Ablauf gültig.
> - **Fragen:** info@motionsports.de

If the owner instead keeps one shared code in Shopify Messaging, the backend agent sends a revised draft
(„einmal je Kunde“, a fixed end date instead of „30 Tage ab Erhalt“, no „persönlich“) — do not publish the
page before the owner confirms which one.

## Acceptance

- [ ] On the unpublished theme copy: footer, `/pages/rabatte`, `/pages/newsletter-anmeldung`, the blog
      block (and the popup, if enabled) show the claim and the conditions line verbatim, DE and EN; no
      „5 %“ anywhere (search the theme for `5%`, `5 %`, `fünf Prozent`).
- [ ] The „Bedingungen“ links point to `/pages/newsletter-gutschein`.
- [ ] Screenshots of each place at 390 and 1280 px for the owner and counsel.
- [ ] MANIFEST entry with the date; publish only when the owner says so (at the flip).
