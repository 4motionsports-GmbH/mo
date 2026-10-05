# Wiederkauf-Analyse — Datengrundlage für die Lifecycle-Segmentierung

Dieses Skript misst das Kaufverhalten des Shops, auf dem die
Lifecycle-Segmentierung der Kampagnen-Mails beruht (Segmente, Zeitgrenzen,
Empfehlungs-Strategie je Segment). Die Segmentierung ist gebaut (Migration
`0052`, `src/lib/campaign-segments.mjs`; je Kunde nächtlich in
`customer_facts.lifecycle_segment` seit `0063`); die gemessenen Zahlen und die
daraus abgeleiteten Grenzen stehen in [`CAMPAIGNS.md`](./CAMPAIGNS.md)
„Lifecycle-Segmentierung“. Die Grenzen stehen im Code und ändern sich nur durch
ein Release — ein neuer Lauf dient dazu, sie zu überprüfen; das Ergebnis
schlägt vor, ein Mensch entscheidet.

```bash
npm run analyze:repurchase
npm run analyze:repurchase -- --since 2023-01-01 --json analyse.json
```

| Flag | Wirkung |
| --- | --- |
| `--since YYYY-MM-DD` | nur Bestellungen ab diesem Datum (Standard: alle) |
| `--max-orders <n>` | nach ca. n Bestellungen abbrechen (Seitengrenze) — Schnelltest |
| `--page-size <n>` | Bestellungen je GraphQL-Seite (Standard 15) |
| `--json <pfad>` | Aggregate zusätzlich als JSON schreiben |
| `--occasion-gap <tage>` | Bestellabstand, unter dem zwei Bestellungen als **eine** Kaufgelegenheit gelten (Standard 7; `0` schaltet ab) |

**Nur lesend.** Es werden ausschließlich `orders`-Queries ausgeführt; nichts wird
angelegt, geändert oder gelöscht. Voraussetzung ist `read_orders` **und** die
Freigabe für *Protected Customer Data* (die Bestellung muss ihrem Kunden
zuordenbar sein). Fehlt sie, bricht das Skript mit einem klaren Hinweis ab.

**Datenschutz.** Die Kunden-ID wird ausschließlich im Arbeitsspeicher zum
Gruppieren der Bestellungen verwendet. E-Mail, Name und Adresse werden nie
abgefragt, nie ausgegeben und nie geschrieben; die `--json`-Ausgabe enthält
**nur Aggregate**, keine Zeile pro Kunde.

## Kaufgelegenheiten statt Bestellungen

**Ein Checkout landet in Shopify regelmäßig als mehrere Bestell-Datensätze** —
gesplittete Checkouts, nachträglich bearbeitete oder neu angelegte Bestellungen,
oder schlicht ein Kunde, der zwanzig Minuten später nochmal bestellt, weil er
etwas vergessen hat. Zählt man die als Wiederkauf, bricht die ganze Analyse: im
ersten Lauf gegen den echten Shop lag der *Median*-Abstand zwischen
„aufeinanderfolgenden Bestellungen" bei **0,0 Tagen** — über die Hälfte aller
gemessenen Abstände lag unter einer Stunde.

Deshalb werden Bestellungen desselben Kunden, die enger als `--occasion-gap`
(Standard **7 Tage**) beieinander liegen, vorab zu **einer Kaufgelegenheit**
zusammengefasst: früheste Bestellung gibt das Datum, die Positionen werden
vereinigt, und der Ankerwert ist der teuerste Einzelposten der ganzen Episode.
Sieben Tage, weil die Analyse die Frage beantworten soll „wann hätte eine
Lifecycle-Mail etwas bewirkt" — was innerhalb einer Woche nach der letzten
Bestellung gekauft wird, hat keine Mail von uns ausgelöst.

Der Abstand wird dabei ab dem **Beginn** der Gelegenheit gemessen, nicht ab der
vorherigen Bestellung. Eine Gelegenheit kann so nie länger als `gapDays` dauern;
andernfalls würde ein Kunde, der ein Jahr lang alle fünf Tage bestellt, zu einer
einzigen Gelegenheit verschmelzen und jeder Wiederkauf verschwinden.

Die Datengrundlage weist aus, wie viele Bestellungen zusammengefasst wurden —
ist der Anteil hoch, war genau das der Grund für unplausible Rohzahlen.

## Was gemessen wird — und was die Zahl entscheidet

**1 · Wiederkaufsrate je Wertstufe.** Von den Kunden, deren *erste* Bestellung
ein Kleinteil / eine Komponente / ein Großgerät war: wie viele haben je wieder
gekauft? Das ist die **Obergrenze der Lifecycle-Mails** — bessere
E-Mail-Zeitpunkte erzeugen keine Wiederkäufer, die es nicht gibt.

**2 · Abstand zwischen aufeinanderfolgenden Bestellungen je Wertstufe.**
Median und p75 setzen die Zeitgrenzen der Segmente. Unterscheiden sich die
Stufen kaum, braucht es keine Wertskalierung, sondern eine Zeitschiene für alle
(so der Befund des Laufs, auf dem die heutigen Segmente beruhen — CAMPAIGNS.md).

**3 · Zubehör-Folgekauf.** Wenn jemand zurückkommt: kauft er Zubehör
(`Product.compatibleWith`, „Ergänzende Produkte") zu etwas, das er schon besitzt?
Das ist der direkte Test der „Ausbauen"-Segmente: ein hoher Lift in dieser
Tabelle belegt, dass Zubehör zum Besitz (Strategie `complement`) die reine
Embedding-Ähnlichkeit (`similarity`) schlägt — die Strategien je Segment stehen
in CAMPAIGNS.md „Empfehlungs-Strategien“.

> Die Spalte **Zufall** ist die erwartete Trefferquote, wenn die Folgebestellung
> zufällig aus dem Katalog käme (`1 − (1 − a/N)^k`). Der **Lift** ist
> `beobachtet / erwartet`. Echtes Kaufverhalten ist nicht gleichverteilt, also ist
> das eine grobe Referenz — als Größenordnung lesen, nicht als Effektstärke.

**4 · Zubehör-Rate nach Abstand zum Vorkauf.** Wo die Rate abfällt, endet das
Zubehör-Fenster. Genau dieser Abfall setzt die obere Grenze des
„Ausbauen"-Segments. Tabelle **4b** schlüsselt dieselbe Rate nach Wertstufe auf
— nur daraus lässt sich das Fenster je Stufe getrennt setzen. Zellen mit kleinem
`n` (unter ~100) sind Rauschen und dürfen nicht überinterpretiert werden.

## Wertstufen

Aus der Preisverteilung des Katalogs (p25 ≈ 54 €, Median ≈ 249 €, p75 ≈ 1.099 €):

| Stufe | Grenze | Anteil Katalog |
| --- | --- | --- |
| Kleinteile | < 150 € | ~42 % |
| Komponenten | 150 – 1.500 € | ~38 % |
| Großgeräte | ≥ 1.500 € | ~20 % |

Die Stufe einer Bestellung ergibt sich aus ihrem **höchsten Einzelposten**, nicht
aus der Bestellsumme: zehn Scheiben à 50 € und eine Bank für 500 € ergeben
denselben Warenkorbwert, sind aber völlig verschiedene Kunden. Der größte
Einzelartikel ist das bessere Maß für die Verbindlichkeit des Kaufs.

## Aufbau

Die Statistik liegt in [`src/lib/repurchase-analysis.mjs`](../src/lib/repurchase-analysis.mjs)
— pur, ohne I/O, unit-getestet, und **bewusst dasselbe Modul, das die
Produktion importiert** (`campaign-segments.mjs`, `customer-facts-core.mjs`,
`campaign-recommendations.ts`), damit Analyse und Produktion nie
auseinanderlaufen können, was „Großgerät" bedeutet.
[`scripts/analyze-repurchase.mjs`](../scripts/analyze-repurchase.mjs) macht nur
I/O, Paginierung, Throttling und Formatierung.

Nur abgeschlossene Käufe zählen (`PAID`, `PARTIALLY_REFUNDED`) — dieselbe
Definition wie in `shopify-orders.ts`. Gast-Checkouts ohne Kundenzuordnung
werden verworfen und in der Datengrundlage ausgewiesen, damit sichtbar bleibt,
wie viel der Historie die Analyse nicht sehen kann.
