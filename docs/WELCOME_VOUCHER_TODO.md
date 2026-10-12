# Welcome voucher (50 € from 500 €) — open to-dos

M's checklist for switching on the newsletter welcome voucher, as of 12.10.2026. It collects in one place
what is still open: the questions for the client and the lawyer, the Shopify steps, the prompt for the
frontend agent, the switch-on and the live test. The step-by-step history and live status stay in
[`ROLLOUT_TODO.md`](./ROLLOUT_TODO.md) (open list items 1–11, C.31); if the two ever disagree,
`ROLLOUT_TODO.md` wins and this file gets fixed.

**Where things stand**

- The lawyer approved dossier § 22 on 11.10.2026, and the client said yes to O-1…O-9: a fixed 50 € from
  500 €, a personal single-use code, 30 days, reduced items and Concept2 excluded, one code per customer.
- **Built and merged (PR #238):** the voucher hint in the chat (variants b and c), Mo stating the
  conditions when asked, and the note on the confirmation page. All of it is **switched off** until
  `CONSENT_REWARD_ENABLED=true`.
- **Already live:** Mo's neutral answer about welcome discounts. It neither promises nor denies one and
  points to the newsletter sign-up in the shop.
- **Blocking the switch-on:** who issues the codes (question 1 below). Shopify Messaging cannot send a
  personal code that is valid 30 days.

Order: **A** questions to the client → **B** OK from the lawyer → **C** Shopify preparation and **D**
theme texts (in parallel) → Claude's build for the chosen issuer → **E** switch-on → **F** live test right
after it.

---

## A. Questions for the client (send first)

- [ ] Sent · [ ] Answered — tell Claude the answers.

Ready to copy (adapt the greeting and the „Sie“ / „du“ as you usually write to him):

> **Betreff: Newsletter-Gutschein — vier kurze Entscheidungen vor dem Start**
>
> Hallo,
>
> die Anwältin hat den Willkommensgutschein freigegeben (50 € ab 500 € Bestellwert, persönlicher Code,
> einmal einlösbar, 30 Tage gültig, nicht für reduzierte Artikel und Concept2, ein Code pro Kunde). Im
> Chat ist alles fertig gebaut und noch ausgeschaltet. Vor dem Start brauche ich vier Entscheidungen:
>
> **1. Wer verschickt die Gutscheincodes?**
> Die heutige Willkommens-Mail von Shopify Messaging kann nur **einen gemeinsamen Code für alle**
> einfügen, mit festem Enddatum — keinen persönlichen Code und keine „30 Tage ab Erhalt“.
>
> - **(1) Mo verschickt die Codes — meine Empfehlung.** Bei der ersten bestätigten Newsletter-Anmeldung
>   (im Chat oder über das Formular im Shop) erstellt Mo einen Code, den nur diese Person einlösen kann,
>   30 Tage gültig, und schickt die Willkommens-Mail selbst. Die alten Shopify-Willkommens-Automationen
>   werden abgeschaltet. Ein weitergegebener Code nützt sonst niemandem; wir sehen genau, wie viele Codes
>   ausgegeben und eingelöst wurden. Aufwand: etwa 1 Entwicklungstag; die rechtlichen Fragen dazu hat die
>   Anwältin bereits beantwortet.
> - **(2) Ein gemeinsamer Code in Shopify Messaging.** Am einfachsten, aber ein 50-€-Code landet erfahrungsgemäß
>   auf Gutscheinseiten: Jede E-Mail-Adresse könnte ihn dann einmal ab 500 € einlösen. Die Bedingungen
>   ändern sich auf „einmal je Kunde“ und ein festes Enddatum.
> - **(3) Eine Zusatz-App** für persönliche Codes in Shopify-Mails: ein weiterer Anbieter
>   (Datenschutzerklärung, Vertrag) und monatliche Kosten.
>
> **2. Test mit drei Varianten?** Ein Drittel der angemeldeten Kunden sieht im Chat keinen Gutschein-Hinweis
> (Vergleichsgruppe), ein Drittel den Hinweis im Popup, ein Drittel den Hinweis erst nach einer
> Produktempfehlung. So sehen wir, was mehr Anmeldungen bringt. Empfehlung: **ja**.
>
> **3. Bestellungen und Umsatz je Variante auswerten?** Zeigt, ob sich der Gutschein rechnet (nur
> zusammengefasste Zahlen). Empfehlung: **ja**.
>
> **4. Der alte 5-%-Code:** Beim Start ein Enddatum 30 Tage später setzen, damit wer ihn gerade bekommen hat
> ihn noch nutzen kann und er danach nicht weiter kursiert. Empfehlung: **ja**.
>
> Viele Grüße

---

## B. The lawyer: one short OK on the final texts (before the switch-on)

- [ ] Sent · [ ] OK received · [ ] Written approval of 11.10. filed in the dossier (§ 22.4)

Attach the table of dossier § 22.2 (German and English texts) and the terms-page draft (section C.6).
Ready to copy:

> **Betreff: Newsletter-Gutschein — endgültige Texte, bitte kurz bestätigen**
>
> Guten Tag,
>
> vielen Dank für Ihre Freigabe. Die gebauten Texte weichen in drei Punkten von den Beispieltexten ab, die
> Ihnen vorlagen:
>
> 1. Statt der Staffel „bis zu 100 €“ nennen sie den festen Betrag **50 € ab 500 € Bestellwert**.
> 2. Sie ergänzen, dass **reduzierte Artikel und Concept2 nicht zum Bestellwert zählen** — so rechnet
>    Shopify den Mindestbestellwert bei einem auf berechtigte Artikel beschränkten Rabatt.
> 3. Der Satz nach dem Ja („Dein Gutschein kommt per E-Mail …“) **entfällt**, weil das Chat-Fenster ihn
>    auch nach einer Antwort ohne Bestätigungsmail zeigen würde; die Bedingungen nennen „nach Bestätigung
>    per E-Mail“ bereits.
>
> Anbei die Tabelle der endgültigen Texte (deutsch und englisch) und der Entwurf der Bedingungsseite.
> Können Sie diese kurz bestätigen?
>
> Mit freundlichen Grüßen

---

## C. Shopify preparation (about 30 min, independent of question 1)

1. [ ] **New collection „Willkommensgutschein – berechtigt“.** Produkte → Kollektionen → Kollektion
   erstellen. Your admin shows one of two forms (Shopify changed collections in July 2026):
   - **With „Quellen“ / „Ausschließen“:** add a source of type **Varianten** with the condition
     **Vergleichspreis · ist leer** (may read „ist nicht festgelegt“); under **Ausschließen**:
     **Anbieter · ist gleich · Concept2**.
   - **Otherwise („Automatisiert“):** „Produkte müssen **allen** Bedingungen entsprechen“;
     **Anbieter · ist nicht gleich · Concept2** and **Vergleichspreis · ist leer**. Here a product stays in
     as soon as one variant has no compare-at price — if products with a single reduced variant exist,
     tag them `kein-gutschein` and add **Produkt-Tag · ist nicht gleich · kein-gutschein**.
   - Save, scroll the list (no Concept2, nothing with a crossed-out price), send Claude the collection's
     URL and which form you had.
2. [ ] **Today's „not discounted“ collection** (the one the 5 % code uses): open it, filter the products by
   Anbieter = Concept2 → tell Claude yes / no (are Concept2 products in it?).
3. [ ] **Both welcome automations.** Apps → Shopify Messaging → Automationen → open „New Workflow“ and „Neue
   Abonnenten mit einer 5% Rabatt-E-Mail willkommen heißen“ → screenshot the whole canvas of each (the
   trigger box, every condition box, every action box and the mail it sends). Both get switched off at
   the switch-on; Claude needs to know whether „New Workflow“ does anything else.
4. [ ] **Shopify's own confirmation mail neutral.** Einstellungen → Benachrichtigungen → Kunden →
   „Bestätigung für Kundenmarketing“: no offer, no code, no „5 %“. Screenshot.
5. [ ] **Checkout box not pre-ticked.** Einstellungen → Checkout → Marketing-Optionen: „E-Mail“ on,
   „vorausgewählt“ off.
6. [ ] **Terms page.** Onlineshop → Seiten → Seite hinzufügen, title „Bedingungen
   Newsletter-Willkommensgutschein“, URL handle `newsletter-gutschein`, the text below, Sichtbarkeit
   **Ausgeblendet** until the switch-on. Then Vercel (Production) → `CONSENT_REWARD_TERMS_URL` =
   `https://www.motionsports.de/pages/newsletter-gutschein` (does nothing while the voucher is off).
   The text (for answer (1) or (3) to question 1; with (2) Claude sends a revised version — do not publish
   before the client has answered):

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
   >   anderen Rabatten (auch nicht mit automatischen Rabatten) kombinierbar und wird nicht bar ausgezahlt.
   > - **Abmeldung:** Du kannst dich jederzeit über den Abmeldelink in jeder E-Mail abmelden. Ein bereits
   >   erhaltener Gutschein bleibt bis zu seinem Ablauf gültig.
   > - **Fragen:** info@motionsports.de

→ Send Claude: the screenshots (3, 4), the collection URL (1) and the Concept2 answer (2).

---

## D. Theme texts — prompt for the frontend agent

- [ ] Prompt sent · [ ] Screenshots received · [ ] Theme copy ready (unpublished)

Copy into the frontend agent's chat:

> Please implement `docs/frontend/tasks/REWARD_SHOP_TEXTS_2026-10-11.md` from the backend repo
> `4motionsports-GmbH/mo` (branch `main`) in the theme repo `ms_shopify_clone`.
>
> - Put the welcome-voucher claim („50 € Willkommensgutschein ab 500 € Bestellwert“) and the conditions
>   line with the „Bedingungen“ link (`/pages/newsletter-gutschein`) exactly as written in that file on:
>   the footer newsletter form (`sections/footer-group.json`, block `newsletter_UfNf8U`),
>   `/pages/rabatte` (`templates/page.rabatte.json`; also change the English „Subscribe“ button to
>   „Anmelden“), the newsletter popup (`sections/overlay-group.json`, keep it disabled),
>   `/pages/newsletter-anmeldung` (replace the expired Black Week copy) and the blog newsletter block
>   (`templates/blog.json`).
> - German and English (where the theme has `/en` strings), identical wording everywhere. No „5 %“ left
>   anywhere in the theme (search for `5%`, `5 %`, `fünf Prozent`), no other amount, no countdown, nothing
>   pre-ticked; the conditions line always visible next to the claim.
> - Work on an **unpublished copy** of the live theme (or a branch). **Do not publish** — the owner
>   publishes it at the switch-on, together with the shop's new welcome mail.
> - No widget change is needed.
> - Deliver: screenshots of every changed place at 390 and 1280 px, and a MANIFEST entry with the date.

---

## E. Switch-on (after A–D and Claude's build for the chosen issuer; ~20 min, a quiet hour)

In this order:

1. [ ] Claude deploys the issuer build and commits the voucher test (variants per question 2, start = the
   switch-on day).
2. [ ] Shopify: switch on the new issuing (answer (1): nothing to do in Shopify; answer (2): the edited
   automation), then **switch off** both old automations (Apps → Shopify Messaging → Automationen → each
   → Deaktivieren).
3. [ ] The old 5 % code (question 4): **Rabatte** → open it → **Enddatum** = switch-on day + 30 days.
4. [ ] Publish the theme copy (D) and make the terms page visible (C.6).
5. [ ] Vercel (Production): `CONSENT_REWARD_ENABLED=true`, `CONSENT_VALUE_MOMENT_ENABLED=true`,
   `CONSENT_SIGNIN_VARIANTS=a,b,c` (or `a,b` per question 2) → Redeploy. Check: Einstellungen →
   Systemstatus shows „Willkommensgutschein: An · mit Link „Bedingungen““.
6. [ ] `WELCOME_CODE_MATCH`: add the new codes' prefix (Claude names it with the build), e.g.
   `OLDCODE,WILLKOMMEN-*` → Redeploy.

**Kill switch at any time:** `CONSENT_REWARD_ENABLED=false` → Redeploy (reaches every widget within about
6 minutes).

---

## F. Live test right after the switch-on (~45 min)

With fresh test addresses (e.g. `yourname+voucher1@gmail.com`), each in a fresh private window:

- [ ] **Footer sign-up** → Shopify's confirmation mail → click → exactly **one** welcome mail with a 50 €
      code.
- [ ] **Chat, signed in:** variant b shows the voucher hint in the popup after the first message; variant c
      shows no popup but a card after Mo showed a product (open a few windows until you have seen both) →
      accept → click the link in Mo's mail → the confirmation page says the voucher is on its way → exactly
      **one** welcome mail.
- [ ] **Unsubscribe and subscribe again** → no second code.
- [ ] **Ask Mo:** „Gibt es einen Newsletter-Rabatt?“ → the exact conditions; „Gilt der auch für Concept2?“ →
      no; „Was kostet das Laufband dann?“ → no computed price.
- [ ] **Try the code:** cart below 500 € → refused; a Concept2 item / a reduced item → not discounted; a
      second order with the same code → refused.
- [ ] `npm run verify:live -- --since SWITCHONTIME` → send Claude the output.
- [ ] Clean up the test customers („Meine Daten löschen“ in the chat, and delete them in the Shopify admin).

**Rollback rule:** if any case fails (a second code for one customer, a code that works below 500 € or on
Concept2 / reduced items, the hint without a matching mail) → `CONSENT_REWARD_ENABLED=false` → Redeploy,
switch the old automation back on if needed, tell Claude.

---

## G. Still open from before (independent of the voucher)

- [ ] **Delete the test customers:** the 06.10. test account and the test-8 account of 11.10.
      (Kunde #24553) — „Meine Daten löschen“ in the chat (or Kunden → „Kunde vollständig löschen“) and delete
      them in the Shopify admin.
- [ ] **Test order through „Zur Kasse“** (10 min): let Mo recommend a cheap product, click „Zur Kasse“ on
      the card, complete the order (cancel / refund it afterwards); Shopify admin → the order →
      „Zusätzliche Details“: is there an `_mo` entry? Tell Claude yes / no.
- [ ] **Neue Auswertungen prüfen** (~30 min): `ROLLOUT_TODO.md` open list item 8.
- [ ] **Privacy policy** (before the switch-on): the welcome voucher, and the actual mail provider instead
      of the old MailChimp mentions (with answer (1): Mo sends the welcome mail) — with the lawyer.
