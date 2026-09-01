# Wiederkauf-Analyse — Datengrundlage für die Lifecycle-Segmentierung

Bevor die geplante Segmentierung der Kampagnen-Mails („Ausbauen" /
„Weiterentwickeln" / „Zurückholen" / „Ruhen lassen") gebaut wird, misst dieses
Skript, ob die Annahmen dahinter überhaupt stimmen — und ersetzt die geschätzten
Monatsgrenzen durch das tatsächliche Kaufverhalten des Shops.

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

**Nur lesend.** Es werden ausschließlich `orders`-Queries ausgeführt; nichts wird
angelegt, geändert oder gelöscht. Voraussetzung ist `read_orders` **und** die
Freigabe für *Protected Customer Data* (die Bestellung muss ihrem Kunden
zuordenbar sein). Fehlt sie, bricht das Skript mit einem klaren Hinweis ab.

**Datenschutz.** Die Kunden-ID wird ausschließlich im Arbeitsspeicher zum
Gruppieren der Bestellungen verwendet. E-Mail, Name und Adresse werden nie
abgefragt, nie ausgegeben und nie geschrieben; die `--json`-Ausgabe enthält
**nur Aggregate**, keine Zeile pro Kunde.

## Was gemessen wird — und was die Zahl entscheidet

**1 · Wiederkaufsrate je Wertstufe.** Von den Kunden, deren *erste* Bestellung
ein Kleinteil / eine Komponente / ein Großgerät war: wie viele haben je wieder
gekauft? Das ist die **Obergrenze des gesamten Features** — bessere
E-Mail-Zeitpunkte erzeugen keine Wiederkäufer, die es nicht gibt. Liegt die Rate
im niedrigen einstelligen Bereich, lohnt der Aufwand nicht.

**2 · Abstand zwischen aufeinanderfolgenden Bestellungen je Wertstufe.**
Median und p75 ersetzen die geschätzten 3/6/12-Monats-Grenzen. Die Erwartung
hinter dem Entwurf: Kleinteile-Käufer kommen deutlich schneller zurück als
Großgeräte-Käufer. Falls sich die Stufen kaum unterscheiden, ist die
Wertskalierung überflüssig und eine einzige Grenze reicht.

**3 · Zubehör-Folgekauf.** Wenn jemand zurückkommt: kauft er Zubehör
(`Product.compatibleWith`, „Ergänzende Produkte") zu etwas, das er schon besitzt?
Das ist der direkte Test der „Ausbauen"-Idee. Der heutige Empfehler
(`pickCampaignRecommendations`) bewertet **Embedding-Ähnlichkeit** zum Besitz und
schlägt damit *Ersatz* statt *Ergänzung* vor — wer ein Rack gekauft hat, bekommt
ein weiteres Rack empfohlen. Ein hoher Lift in dieser Tabelle ist der Beleg, dass
die Zubehör-Empfehlung das schlägt.

> Die Spalte **Zufall** ist die erwartete Trefferquote, wenn die Folgebestellung
> zufällig aus dem Katalog käme (`1 − (1 − a/N)^k`). Der **Lift** ist
> `beobachtet / erwartet`. Echtes Kaufverhalten ist nicht gleichverteilt, also ist
> das eine grobe Referenz — als Größenordnung lesen, nicht als Effektstärke.

**4 · Zubehör-Rate nach Abstand zum Vorkauf.** Wo die Rate abfällt, endet das
Zubehör-Fenster. Genau dieser Abfall setzt die obere Grenze des
„Ausbauen"-Segments je Wertstufe.

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
— pur, ohne I/O, unit-getestet, und **bewusst dasselbe Modul, das die spätere
Segmentierung importieren wird**, damit Analyse und Produktion nie
auseinanderlaufen können, was „Großgerät" bedeutet.
[`scripts/analyze-repurchase.mjs`](../scripts/analyze-repurchase.mjs) macht nur
I/O, Paginierung, Throttling und Formatierung.

Nur abgeschlossene Käufe zählen (`PAID`, `PARTIALLY_REFUNDED`) — dieselbe
Definition wie in `shopify-orders.ts`. Gast-Checkouts ohne Kundenzuordnung
werden verworfen und in der Datengrundlage ausgewiesen, damit sichtbar bleibt,
wie viel der Historie die Analyse nicht sehen kann.
