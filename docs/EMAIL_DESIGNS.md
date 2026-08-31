# E-Mail-Designs — Architektur & Anleitung für neue Designs

Dieses Dokument ist die Arbeitsanleitung für eine (Claude-Code-)Session, die
ein **neues E-Mail-Design** entwickeln soll, und die Referenz für die
Architektur dahinter.

## Das Modell in einem Absatz

Ein Design ist ein **Code-Modul** in `src/lib/email-designs/` — kein
Datenbank-Datensatz. Es definiert das **allgemeine Erscheinungsbild** (Layer
„base": Theme-Tokens und/oder Renderer-Overrides) und darauf aufbauend
**maßgeschneiderte Varianten je E-Mail-Typ** (`summary`, `doi`, `marketing`,
`campaign`). Die Datenbank speichert nur den Zeiger, welches registrierte
Design jeder Typ aktuell verwendet (`email_design_selections`, Migration 0049)
— das ist die „Versionskontrolle": alte Designs bleiben für immer im Registry
und damit auswählbar, ein Redesign ist **immer ein neues Design mit neuem
Key**, nie ein Überschreiben.

```
classic-Built-ins  ←  design.theme / design.renderers   (allgemeines Template)
                   ←  design.variants[kind]             (Feinschliff je Typ)
```

Was eine Ebene nicht definiert, fällt auf die Ebene darunter zurück — ein
Design schreibt nur, was sich tatsächlich unterscheidet.

## Die Designs

| Key | Look | Besonderheiten |
|---|---|---|
| `classic` | Shopify-Newsletter-Klon (Standard) | Built-in, kein Modul |
| `studio` | Editorial-minimal (Beispiel/Referenz) | Tokens + ein Renderer-Override |
| `performance` | Bild-orientiertes Conversion-Design | Voll-Shell: Hero mit (KI-)Bild, persönliche Anrede, Produkt-Karten, schwarze Bundle-Karte, Frag-Mo-Panel, Smiley-Bewertung, Hero-Pipeline (s. u.) |

## Die zwei Gestaltungs-Ebenen

1. **Theme-Tokens** (`theme: Partial<EmailTheme>`, siehe `email-theme.mjs`):
   Farben, Schrift-Stack-Key, Button-Form, Logo-Override, Social-Icons an/aus.
   Gleiche Layout-Struktur, andere Optik — der billige Weg.
2. **Renderer-Overrides** (`renderers: EmailDesignRenderers`, siehe
   `email-design-context.ts`): ganze Bausteine ersetzen —
   `sectionBand`, `sectionRow`, `ctaButton`, `productGrid`, `productRows`,
   `bundleBlock` (nur HTML; Textteil + PAngV-Preisrechnung bleiben zentral),
   `moPromoBlock` (der Mo-Hinweis der Kampagnen-Mail — die getrackte CTA-URL
   kommt als Input und muss klickbar bleiben),
   `textStyle`/`mutedTextStyle`/`linkStyle` bis hin zu `shell` (das komplette
   HTML-Dokument). Damit kann ein Design **grundsätzlich anders** aussehen.

Zusätzlich gibt es **Per-Send-Renderdaten** (`activeEmailRenderData()`,
gesetzt von den Sende-/Vorschau-Einstiegen via `withEmailRenderData`): Daten,
die zu EINER E-Mail gehören statt zum Design — heute `heroImageUrl` (das
individuell generierte Hero-Bild) und `recipientFirstName` (die persönliche
Anrede; das Design lässt sie weg, wenn die KI-Prosa bereits grüßt).

### Newsletter-Bewertung

Bild-orientierte Designs können die Smiley-Zeile „Wie hilfreich war diese
Empfehlung?" rendern (`email-rating.mjs` + `GET /api/newsletter-rating`). Die
Links sind bewusst **anonym** — nur Score + E-Mail-Typ, keine Empfänger-Kennung,
damit eine weitergeleitete Mail nie verrät, wer sie bekommen hat. Ein Klick
landet als normale Feedback-Zeile (Migration 0020) im Admin-Tab „Feedback".

Die Composer (`summary-email.ts`, `consent-copy.ts` (DOI),
`marketing-email.ts`, `campaign-email.ts`) wissen nichts vom aktiven Design:
die Sende-/Vorschau-Einstiege lösen die gespeicherte Auswahl auf
(`email-design-store.ts`, TTL-Cache, fail-soft → classic) und rendern in
`withEmailDesign(...)`; jeder öffentliche Render-Helfer prüft zuerst das
Override und fällt sonst auf die classic-Implementierung zurück.

## Rezept: ein neues Design anlegen

1. **Datei anlegen**: `src/lib/email-designs/<key>.ts` — Key kurz, stabil,
   kebab-case. Orientierung: `studio.ts` (Beispiel mit Tokens + einem
   Renderer-Override + einer Variante).
2. **Definition exportieren** (`EmailDesignDefinition` aus `registry.ts`):
   `key`, `name`, deutsche `description` (ein Satz), `addedAt` (heutiges
   Datum), dann `theme` / `renderers` für das allgemeine Template und
   `variants` für die typ-spezifischen Anpassungen. `supportedKinds` nur
   setzen, wenn das Design bewusst nicht für alle vier Typen gedacht ist.
3. **Registrieren**: in `registry.ts` importieren und ans **Ende** von
   `EMAIL_DESIGNS` anhängen (die Liste liest sich wie ein Changelog).
4. **Prüfen**: `npx tsc --noEmit && npm run lint && npm test && npm run build`.
5. **Ansehen**: Admin → Einstellungen → Design-Bibliothek → Vorschau je Typ
   (rendert die echten Produktions-Composer mit Beispieldaten), oder lokal
   `renderEmailDesignPreview` aus `email-design-preview.ts` in ein HTML-File
   schreiben. Alle vier Typen prüfen, Desktop + Mobil (390 px).
6. Deployen — das Design erscheint automatisch in der Bibliothek. Die Auswahl
   je Typ trifft der Operator in den Einstellungen.

## Regeln für jedes Design (nicht verhandelbar)

- **E-Mail-Client-Robustheit** (Header von `email-template.ts`):
  Tabellen-Layout mit `role="presentation"` und `bgcolor=`, JEDER Stil inline,
  kein Flexbox/Grid/SVG/Hintergrundbild/externes CSS, Bilder nur absolute
  https-URLs, Webfonts nur als progressive enhancement mit sauberem Fallback.
- **Inhalte sind tabu**: KI-Prosa, Produktdaten, der anwaltlich geprüfte
  DOI-Text und der Abmelde-Hinweis werden nie verändert. Ein `shell`-Override
  MUSS `footer.unsubscribeHtml` rendern, wenn es gesetzt ist, und sollte den
  Firmen-/Impressum-Block behalten.
- **Escaping**: jede dynamische Zeichenkette durch `escapeHtml`/`escapeAttr`.
- **Keys sind endgültig**: nie den Key oder das Aussehen eines ausgelieferten
  Designs umbauen — neues Design, neuer Key. (Bugfixes, die das Design
  originalgetreuer machen, sind ok.)
- **Fail-soft**: Renderer dürfen nicht werfen; lieber einen Baustein weglassen
  als einen Versand brechen.

## Hero-Bilder (Design „Performance")

Das Performance-Design öffnet mit einem großen Lifestyle-Bild. Zwei Quellen:

1. **Standard-Bild** — `public/email-hero-default.jpg` (**Querformat ~1536×1024**,
   Override per `EMAIL_HERO_DEFAULT_URL`). Wird von summary/DOI immer und von
   marketing/campaign ohne individuelles Bild verwendet.

2. **Individuelles Bild + Schlagzeile je E-Mail** (nur marketing + campaign —
   die beiden Typen mit menschlichem Review): Im Kunden- bzw.
   Kampagnen-Workspace schlägt „Hero vorschlagen" in EINEM KI-Durchlauf sowohl
   einen Bild-Prompt als auch die zweizeilige **Hero-Schlagzeile** aus
   Produkten/Prosa/Persona vor (`lib/email-hero.ts`); der Operator passt beides
   an. „Bild generieren" rendert das Bild mit `gpt-image-1` (**1536×1024**),
   lädt das PNG in Vercel Blob und speichert URL + Prompt + Schlagzeile am
   Entwurf (Migrationen 0050/0051); die Schlagzeile lässt sich auch allein
   speichern (ohne neues Bild). Vorschau UND Versand lesen alles über
   `withEmailRenderData` — was geprüft wird, wird verschickt. Leere Schlagzeile
   = die Standard-Zeile des Designs je E-Mail-Typ.

**Wichtig — der Hero ist ein VOLLFLÄCHIGES Hintergrundbild:** Text und Button
liegen auf der **linken Hälfte** des Bildes. Damit die dunkle Schrift lesbar
bleibt, muss die linke ~45 % des Motivs sehr hell und ruhig sein (der Verlauf
ist im Bild selbst angelegt, nicht per CSS — E-Mail-Clients können keine
Gradienten über Bilder legen). Genau das schreibt `HERO_PROMPT_STYLE_TAIL` dem
Bildmodell vor. Technisch: `background`-Attribut + Inline-`background` für
Gmail/Apple Mail, VML-`v:rect` für Outlook, `bgcolor`-Fallback wenn Bilder
blockiert sind; auf dem Handy wird der Hintergrund abgeschaltet und das Bild
als eigene Zeile **unter** dem Text gezeigt.

**Was die KI über die Person weiß** (`email-hero-context.mjs`, getestet): das
verdichtete **Kundenverständnis** (Ziele, Platz, Lautstärke, Niveau), die
**Kaufhistorie** (was schon da ist — die neue Ausrüstung ergänzt sichtbar das
bestehende Setup), die **Produktarten** der Empfehlungen statt der Markennamen
(die sagen einem Bildmodell nichts), ein **angehängtes Set** als Gruppe,
Persona/Team-Hinweise, bei Kampagnen zusätzlich **Kundenstatus** (Erstkäufer:in
bis Stammkund:in) und Sprache — plus die **Jahreszeit** für Licht und Stimmung.
Die Schlagzeile benennt Ziel oder Situation der Person; Rabatte, Preise und
Produktnamen sind darin bewusst verboten (sie stehen deterministisch an anderer
Stelle und würden hier veralten).

Alte gespeicherte Prompts werden beim Generieren automatisch auf die aktuellen
Stil-Regeln gehoben (`ensureHeroStyleTail`) — ein vor der Querformat-Umstellung
gespeicherter Prompt kann das Layout nicht mehr sabotieren.

**Speicherung:** Der Blob-Store dieses Deployments ist PRIVAT (dort liegen auch
Katalog und Embeddings) und lehnt `access: "public"` ab. Hero-Bilder werden
deshalb ebenfalls privat geschrieben und über die eigene öffentliche Route
`GET /api/email-hero-image/<datei>` ausgeliefert (Mail-Clients laden Bilder
anonym aus dem Postfach). Die Route kann ausschließlich Dateien unter
`email-heroes/` erreichen — `parseHeroBlobFile` (getestet) weist Separatoren,
Traversal und Nicht-PNG-Namen ab; das ist die Grenze, die die privaten
Katalog-Blobs unerreichbar hält. Ausgeliefert wird mit
`Cache-Control: immutable` (Dateinamen tragen ein Zufalls-Suffix).

Benötigt: `OPENAI_API_KEY` + `BLOB_READ_WRITE_TOKEN`. Alles fail-soft: ohne
Konfiguration/Bild rendert immer das Standard-Bild, nie ein gebrochener
Versand.

**Prompt für das Standard-Bild** (einmalig extern generieren, als
`public/email-hero-default.jpg` speichern):

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

(Das aktuelle Hochformat-Bild sollte damit ersetzt werden — im Vollflächen-Hero
würde es links und rechts beschnitten und der Text stünde auf dem Motiv.)

## Dateien im Überblick

| Datei | Rolle |
|---|---|
| `src/lib/email-designs/registry.ts` | Registry + `EmailDesignDefinition` + Auflösung (classic ← base ← variant) |
| `src/lib/email-designs/studio.ts` | Beispiel-Design (Referenz zum Kopieren) |
| `src/lib/email-designs/performance.ts` | Bild-orientiertes Conversion-Design (Voll-Shell + Hero) |
| `src/lib/email-hero-blob.mjs` + `api/email-hero-image` | Privater Blob-Write & öffentliche Auslieferung der Hero-Bilder (mit Pfad-Validierung) |
| `src/lib/email-hero-context.mjs` | Was die KI über die Person erfährt (Kaufhistorie, Profil, Kategorien, Saison) — pur & getestet |
| `src/lib/email-hero.ts` / `email-hero-store.ts` | Hero-Prompt-Vorschlag, Bild-Generierung (gpt-image-1 + Blob), Speicherung am Entwurf |
| `src/app/admin/HeroImagePanel.tsx` | Hero-Panel (Bild + Schlagzeile) in Kunden-/Kampagnen-Workspace |
| `src/lib/email-rating.mjs` + `api/newsletter-rating` | Smiley-Bewertung (anonym, landet im Feedback-Tab) |
| `src/lib/email-design-context.ts` | `withEmailDesign` (AsyncLocalStorage) + `EmailDesignRenderers`-Interface |
| `src/lib/email-theme-context.ts` / `email-theme.mjs` | Token-Ebene (Farben/Schrift/Buttons) + Vokabular der E-Mail-Typen |
| `src/lib/email-design-store.ts` | Auswahl je Typ (DB, TTL-Cache, fail-soft) |
| `src/lib/email-design-preview.ts` | Beispiel-Renderings je Typ für die Admin-Vorschau |
| `src/lib/email-template.ts` | classic-Shell + öffentliche Render-Helfer (Override-Erkennung) |
| `src/lib/email-products.ts` | classic Produkt-Grid/-Zeilen (Override-Erkennung) |
| `src/app/admin/EmailSettingsWorkspace.tsx` | Design-Bibliothek + Zuordnung (Admin-Tab „Einstellungen") |
| `migrations/0049_email_design_selections.sql` | Auswahl-Tabelle |
