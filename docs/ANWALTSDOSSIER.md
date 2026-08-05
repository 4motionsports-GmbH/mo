# Rechtsdossier „Mo“ — KI-Verkaufsberater auf motionsports.de

**Zweck:** Vollständige, aktuelle Beschreibung des Systems für die externe anwaltliche Prüfung (Datenschutz, Wettbewerbs-/Lauterkeitsrecht, KI-Regulierung, Verbraucherrecht) — als Grundlage für Ihr Feedback und Ihre Handlungsempfehlungen.
**Stand:** 05.08.2026 — code-basiert erstellt aus dem tatsächlichen Stand des Backends (nicht aus älteren Konzeptpapieren).
**Ersetzt:** den „DSGVO Readiness Report“ vom 16.06.2026 ([`LEGAL_READINESS_REPORT.md`](./LEGAL_READINESS_REPORT.md)). Was seither umgesetzt wurde, steht in § 11; was neu hinzukam, ist durchgängig eingearbeitet.
**Verantwortlicher:** motion sports [genaue Firmierung, Anschrift, Geschäftsführung, ggf. DSB — vom Mandanten zu ergänzen]. Betrieben wird der Onlineshop motionsports.de (Shopify) für Sport- und Fitnessgeräte (B2C, Studios/Physiotherapie, öffentliche Auftraggeber).

**Wichtige Lesehinweise**

1. Dieses Dokument ist eine Tatsachenbeschreibung aus Sicht der Entwicklung, keine rechtliche Bewertung. Einschätzungen sind als solche gekennzeichnet.
2. Im Code sind drei frühere anwaltliche Freigaben dokumentiert (Chronologie in Anhang A). Bitte gleichen Sie diese mit Ihren Akten ab — es sind entwicklerseitig erfasste Vermerke (→ F-19).
3. „Aus dem Code nicht verifizierbar“ heißt: Verträge (AVV), Konto-/Region-Einstellungen bei Dienstleistern und Live-Umgebungsvariablen liegen außerhalb des Repositories. Diese Punkte sind gesondert markiert.
4. Datenschutzerklärung und Impressum liegen im Shopify-Shop, nicht in diesem System. Mehrere Bewertungen hängen davon ab, dass deren Text die hier beschriebenen Verarbeitungen tatsächlich abdeckt (→ F-05).

---

## 1. System im Überblick

„Mo“ ist ein KI-Verkaufsberater (Chatbot) auf motionsports.de. Das hier beschriebene System ist das **Backend**: Es beantwortet die Chat-Anfragen des im Shop eingebundenen Widgets, verwaltet E-Mail-Einwilligungen und -Versand, und stellt dem Betreiber ein internes Admin-Dashboard bereit. Das Widget selbst (Oberfläche, Cookie-/Consent-Banner des Shops) liegt im separaten Shopify-Theme.

**Technikstack (Kurzfassung):**

| Baustein | Dienst | Funktion |
|---|---|---|
| Hosting/Betrieb | Vercel (Compute-Region **Frankfurt/fra1** im Code gepinnt) | Anwendung, Cron-Jobs, Datei-Blob (nur Produktkatalog, keine personenbezogenen Daten) |
| Datenbank | Neon (Postgres) | **Primärer Speicher aller personenbezogenen Daten** |
| KI-Sprachmodelle | Anthropic (Claude) | Chat, Zusammenfassungen, Kundenprofile, E-Mail-/Brief-Entwürfe, Gesprächsanalysen |
| KI-Nebendienste | OpenAI | Produktsuche-Embeddings (jede Nutzernachricht), Sprachausgabe (Vorlesen der Mo-Antworten) |
| E-Mail (aus- und eingehend) | Resend | Zusammenfassungs-, DOI-, Marketing-, Kampagnen- und Korrespondenz-Mails; Empfang von Kundenantworten |
| Shop | Shopify (Admin API + Customer Account API) | Katalog, Bestellhistorie, Rabattcodes, Kundenkonto-Login, Kampagnen-Zielgruppe |
| Briefversand | Pingen (Schweiz) → Deutsche Post | Physische Briefe (PDF mit Empfängeradresse) |
| Rate-Limiting | Upstash (Redis) | Kurzlebige Zugriffszähler (Session-ID bzw. IP als Schlüssel, 60 s–60 min TTL) |
| Fehlerüberwachung | Sentry (optional) | Nur Fehler, ohne Standard-PII, mit serverseitigem E-Mail-Scrubber |

**Drei Identitätsstufen der Nutzer:**

- **Stufe 1 — anonym:** Nur eine vom Browser erzeugte Session-ID (pseudonym). Chats werden gespeichert, aber keiner Person zugeordnet.
- **Stufe 2 — E-Mail erfasst:** Der Nutzer hat im Chat seine E-Mail-Adresse mit Einwilligung angegeben (Beratungs-Zusammenfassung und/oder Marketing).
- **Stufe 3 — eingeloggt:** Der Nutzer hat sich über sein Shopify-Kundenkonto (OAuth/PKCE) angemeldet; nur hier gibt es Self-Service für Auskunft/Export und Löschung.

Die Datenbank ist bewusst in zwei Cluster getrennt: **Cluster A** (pseudonyme Chat-/Nutzungsdaten, berechtigtes Interesse) und **Cluster B** (identifizierte Daten mit Einwilligungs-Nachweis). E-Mail-Adressen gelangen nie in Cluster A und nie in KI-Prompts.

---

## 2. Funktionsumfang

### 2.1 Endkundenseite

**Chat-Beratung:** Mo berät zu Produkten (Kraft/Cardio/Reha/Studio/öffentliche Beschaffung), stellt Produktkarten und Vergleiche dar, kann einen Direkt-zur-Kasse-Button anzeigen (nur Privatkunden, nie bei ausverkauften Artikeln), den Showroom Gröbenzell vorschlagen und ein Kontaktformular öffnen. Mo stellt sich im Systemprompt ausdrücklich als „KI-Fitnessberater“ vor. Im Hintergrund baut Mo pro Gespräch ein strukturiertes Bedarfsprofil auf (Segment, Erfahrung, Trainingsziel, Platz, Budget, Wohnsituation, Lärmempfindlichkeit) — Grundlage von Empfehlung und Tonalität.

**Verbindliche Grenzen im Systemprompt (auszugsweise):** keine erfundenen Produktdaten; **keine medizinischen Ratschläge und keine medizinischen Wirkversprechen** (Geräte sind Sportgeräte nach EN 20957, ausdrücklich **keine** Medizinprodukte i. S. d. MDR — bei Bedarf Verweis auf das Kontaktformular); keine Preisverhandlungen; **keine Rabattversprechen** (Rabattcodes vergibt ausschließlich das Team per E-Mail); keine künstliche Dringlichkeit; keine Kommentare über beobachtetes Klickverhalten.

**Sachaussagen, die Mo als Fakten mitteilt** (im Prompt hinterlegt, → F-11): Versandkosten (DE frei ab 50 €, sonst 4,90 €; AT/CH ab 9,90 €; Speditionsware frei Bordsteinkante), **14-tägiges Widerrufsrecht**, kostenlose Rücksendung innerhalb Deutschlands („Ware unbenutzt und originalverpackt“), Zahlarten (B2C: PayPal, Kreditkarte, Klarna, Sofortüberweisung, Vorkasse; B2B/öffentliche Hand: Kauf auf Rechnung, formale PDF-Angebote, Leasing), Showroom nach Terminvereinbarung.

**Sprachausgabe:** Auf Wunsch wird die Mo-Antwort per OpenAI-TTS vorgelesen (Antworttext geht an OpenAI; keine Identifikatoren).

**E-Mail-Erfassung im Chat:** Mo darf höchstens **zweimal pro Gespräch** die Zusammenfassung per E-Mail anbieten (serverseitig erzwungen), nie erneut nach Ablehnung. Zwei getrennte, nie vorangekreuzte Einwilligungen (§ 5). Zusätzlich existiert ein einmal pro Session gezeigtes „Consent-Gate“ (nur Marketing, Button-Consent, v4).

**Kundenkonto (Stufe 3):** Eigene Gespräarchivliste über alle Geräte, Transkript lesen/umbenennen/einzeln löschen, PDF-Zusammenfassung, **Daten-Export als JSON** (Art. 15/20), **vollständige Selbst-Löschung** (Art. 17), Marketing-Opt-in ohne erneute E-Mail-Eingabe (voller DOI).

**Kontaktformular:** Name, E-Mail, Telefon, Organisation, Nachricht + Anliegen (8 Kategorien inkl. Bestellsupport). Wird per Resend an das interne Postfach weitergeleitet und **nicht** in der Systemdatenbank gespeichert.

**Feedback:** Freitextfeld (optional mit E-Mail); Speicherung 365 Tage; nur lesend im Admin sichtbar.

### 2.2 Admin-Dashboard (interner Betrieb, `/admin`)

| Tab | Funktion | KI-Einsatz |
|---|---|---|
| **Kunden** | Kundenakte pro E-Mail (nur nach Einwilligungs-Erfassung): Consent-Status, verknüpfte Transkripte, Bestellhistorie (Shopify-Cache), E-Mail-Korrespondenz, Briefe, Set-Angebote | KI-**Kundenprofil** („aktuelles Verständnis“, ≤ 250 Wörter, Opus-Modell); KI-Entwürfe für Marketing-Mails und Briefe |
| **Kampagne** | Personalisierte Einzel-Mails an Shopify-Newsletter-Abonnenten (§ 6.2); jede Mail wird von einem Menschen geprüft und einzeln versendet (~200/Tag Zielgröße) | KI-Entwurf pro Kontakt aus Name + Kaufhistorie |
| **Gespräche** | Volltextsuche und Inspektion aller Chat-Transkripte; Kategorisierung/Qualitätsbewertung | KI-Analyse einzeln oder als Bulk (Haiku-Modell; ohne E-Mail/Identität im Prompt); aggregierte „Insights“ |
| **Wissen (Q&A)** | KI erkennt Wissenslücken aus realen Gesprächen, formuliert eine Kundenfrage; ein Mensch beantwortet; Veröffentlichung auf Produktseiten (Shopify-Metafeld) und in Mos Wissensbasis; automatische EN-Übersetzung; jederzeit zurückziehbar | Ja (Extraktion + Übersetzung) |
| **KPIs** | Pseudonyme Kennzahlen, Funnels (Capture, Consent-Gate, Kampagne), Mo-attribuierter Umsatz über Rabattcode-Einlösung, KI-Kosten | Nur auf Knopfdruck: „Top-Fragen“-Zusammenfassung |
| **Analyse** | „Komplettanalyse“: großer KI-Bericht über einen Zeitraum, mit Kostenvorschau; optional **personenbezogene Abschnitte mit Klarnamen** (eigene Löschfrist 365 T; bei Konto-Löschung manuelle Nacharbeit nötig, → F-10) | Ja (mehrphasig) |
| **Feedback** | Nur-Lese-Liste | Nein |

**Zugriffsprotokoll:** Jeder Admin-Zugriff auf Kundendaten (Profil, Transkript, Korrespondenz, Q&A, Analyse) wird protokolliert (`admin_access_log`: Aktion, Kunden-ID, IP, Cookie-Fingerprint; 730 Tage). Einschränkung: Es gibt nur **ein geteiltes Admin-Passwort**, daher keine namentliche Zuordnung (→ F-15).

**Automatische Hintergrund-Jobs (täglich, per Secret abgesichert):** Shopify-Kundendaten-Refresh (Bestellungen/Adressen, 25 Kunden/Lauf), Kampagnen-Zielgruppen-Sync, Katalog-Sync mit Embeddings, **Lösch-/Aufbewahrungslauf** (§ 3.2), Ablauf von Set-Angeboten.

---

## 3. Personenbezogene Daten und Speicherfristen

### 3.1 Dateninventar (Neon-Datenbank, sofern nicht anders angegeben)

| # | Kategorie | Inhalt (Kernfelder) | Frist (Standard) |
|---|---|---|---|
| D-01 | **Chat-Transkripte** | Nutzer- und Mo-Texte, Tool-Aufrufe; pseudonym (Session-ID); Personenbezug nur nach E-Mail-Erfassung/Login | **180 T** ab letzter Aktivität |
| D-02 | Gesprächs-Metadaten | Persona, empfohlene/gewählte Produkte, Status, Titel, KI-Analyse (Zusammenfassung, Kategorie, Qualität) | 180 T |
| D-03 | Nutzungs-Telemetrie (`kpi_events`) | Ereignisname, Session-ID, Kontextdaten; **nie** E-Mail | 180 T |
| D-04 | **Einwilligungs-Nachweis** (`email_captures`) | E-Mail, beide Consent-Flags, DOI-Status/-Token, **wortlautgetreuer Einwilligungstext + Versionsstempel**, Abmeldezeitpunkt | Aktive Einwilligung: unbefristet (Art.-7-Nachweis); nach Abmeldung: PII-Löschung nach 30 T Karenz |
| D-05 | **Sperrliste** (`suppression_list`) | E-Mail, Grund, Zeitpunkt | **Unbefristet** (damit Opt-outs dauerhaft greifen) |
| D-06 | Marketing-Sendehistorie | Entwurfstext, Betreff, Rabattcode, Klick-Zeitpunkt | Fällt mit dem Einwilligungs-Datensatz weg; keine eigene Frist (→ F-10) |
| D-07 | **Kundenakte** (`customers`) | E-Mail, Consent-Spiegel, **KI-Profiltext**, Bestellhistorien-Cache, Shopify-Identität, ggf. Postadresse (nur kaufbasiert, nur bei aktivem Briefkanal), Admin-Notizen, Briefentwurf | Solange Einwilligung aktiv; **inaktive Kunden ohne aktive Einwilligung: 1095 T (3 J.)**; Löschung auf Antrag/Self-Service |
| D-08 | OAuth-Tokens (Stufe 3) | Access-/Refresh-Token, **AES-256-GCM-verschlüsselt** | Mit Kundenakte; Login-Zwischenzustände ~10 min |
| D-09 | **E-Mail-Korrespondenz** | Vollständige Texte ein- und ausgehender Mails (inkl. unbekannter Absender), Anhänge nur als Metadaten | **365 T** |
| D-10 | **Physische Briefe** | Empfängeradresse (Snapshot), Briefinhalt, Pingen-Status, Kosten | **365 T** |
| D-11 | Kampagnen-Kontakte + -Versand | Shopify-Abonnenten: E-Mail, Name, Sprache, Opt-in-Level, Bestellzahl/Umsatz; versendete Mail im Wortlaut | **365 T** |
| D-12 | Feedback | Freitext, optionale E-Mail, Session/Seite | **365 T** |
| D-13 | Set-Angebote (Bundles) | Komponenten, Preise, Kundenverknüpfung (wird bei Löschung getrennt) | Angebot 7 T gültig; Datensatz ohne eigene Frist |
| D-14 | Q&A-Wissenseinträge | Aus Gesprächen abgeleitete Frage + menschliche Antwort (keine Identität) | Unbefristet (redaktioneller Inhalt), jederzeit zurückziehbar |
| D-15 | Analyse-Berichte | KI-Berichte; **mit Klarnamen**, wenn Pro-Kunde-Option gewählt | **365 T** |
| D-16 | Admin-Zugriffsprotokoll | Aktion, Kunden-ID, **IP (Klartext)**, Cookie-Fingerprint | **730 T** |
| D-17 | IP-Adressen (Endnutzer) | Nur als Rate-Limit-Schlüssel in Upstash Redis (Fallback, wenn keine Session-ID; Kontaktformular pro IP) | TTL 60 s–60 min; kein Hashing, keine Analytics |
| D-18 | Kontaktformular | Name, E-Mail, Telefon, Organisation, Nachricht | **Nicht** im System gespeichert; liegt im internen Postfach (organisatorische Frist nötig, → F-05) |
| D-19 | Merge-Konflikte beim Login | Shopify-/lokale E-Mail, Session-ID | **Keine Frist, kein Lösch-Lauf** (→ F-10) |

**Kein** Einsatz von: Google Analytics, Meta-Pixel o. ä. Tracking-Diensten; keine Öffnungs-Pixel in E-Mails (nur Klick-Tracking auf vom Empfänger angeklickten Links); keine User-Agent-Speicherung; kein Geräte-Fingerprinting.

### 3.2 Durchsetzung

Ein täglicher, abgesicherter Lösch-Lauf setzt alle Fristen automatisch durch. Bei Löschung einer Kundenakte werden Transkripte/Korrespondenz/Briefe **entpersonalisiert** (Verknüpfung wird getrennt, Inhalte laufen über ihre eigene Frist aus); OAuth-Tokens werden mitgelöscht; die Sperrliste bleibt.

---

## 4. Rechtsgrundlagen je Verarbeitungszweck (Einschätzung der Entwicklung — zur Bestätigung)

| # | Zweck | Grundlage (angenommen) | Anmerkung für Sie |
|---|---|---|---|
| R-01 | Chat-Beratung durchführen; Transkript-Speicherung 180 T | Art. 6 (1) b/f | Kein Consent-Gate vor Speicherung/KI-Aufruf; bitte Basis bestätigen (→ F-08) |
| R-02 | Pseudonyme Nutzungsanalyse (KPIs) | Art. 6 (1) f | Interessenabwägung dokumentieren |
| R-03 | Beratungs-Zusammenfassung per E-Mail | Art. 6 (1) b (angefordert per Pflicht-Checkbox) | Einordnung b vs. a festlegen (Checkbox-Optik) |
| R-04 | E-Mail-Marketing (eigener Funnel) | **Art. 6 (1) a + § 7 (2) UWG, Double-Opt-in** | Kernstück, § 5 |
| R-05 | **Kampagnen-Mails an Shopify-Abonnenten** | Einwilligung ggü. Shopify-Checkbox (+ § 7 (2) UWG) | Am 21.07.2026 freigegeben; bitte Reichweite bestätigen, insb. Single-Opt-in (→ F-06) |
| R-06 | **KI-Profilbildung/Personalisierung** (dauerhaftes Kundenprofil, Chat-Gedächtnis) | Art. 6 (1) a — technisch an bestätigtes Marketing-DOI gekoppelt | Art.-22-/DSFA-Frage weiterhin offen (→ F-04) |
| R-07 | KI-Analyse der Transkripte im Admin (Kategorien, Insights, Q&A-Extraktion, Komplettanalyse) | Art. 6 (1) f (pseudonym; Pro-Kunde-Analyse: wie R-06) | Neu seit Juni; bitte bestätigen (→ F-09) |
| R-08 | E-Mail-Korrespondenz (Antworten, 365 T inkl. unbekannter Absender) | Art. 6 (1) b/f | Frist + Unbekannten-Speicherung bestätigen |
| R-09 | Kundenkonto-Login, Token-Haltung | Art. 6 (1) b/f | — |
| R-10 | **Briefversand** (Pingen/CH) | Versandkontext + kaufbasierte Adresse (Art. 6 (1) b/f) | Erfassung inzwischen strikt gegated (§ 11); Freigabe 14.06.2026 |
| R-11 | Kontaktformular | Art. 6 (1) b/f | — |
| R-12 | Rate-Limiting (IP), Fehlerüberwachung, Admin-Zugriffsprotokoll | Art. 6 (1) f | IP-Verarbeitung in DSE erwähnen |

---

## 5. Einwilligungen (Stand: Copy-Version v4)

**Mechanik (alles serverseitig erzwungen, fail-closed):**

- Zwei **getrennte, nie vorangekreuzte** Checkboxen (Zusammenfassung vs. Marketing); Marketing nie Voraussetzung für die Zusammenfassung; Prompt verbietet Kopplung und Dringlichkeitsdruck.
- **Double-Opt-in** für Marketing: 256-Bit-Token, 7 Tage gültig; vor Bestätigung keine einzige Marketing-Mail.
- **Wortlautgetreuer Nachweis:** Der angezeigte Einwilligungstext wird verbatim gespeichert; ein Versionsstempel (v4) wird nur vergeben, wenn der zurückgemeldete Text byte-identisch mit dem Serverstand ist.
- **Widerruf:** signierter 1-Klick-Abmeldelink in jeder Marketing-/Kampagnen-Mail + `List-Unsubscribe`-Header; ohne funktionierenden Abmeldelink wird der Versand verweigert; Sperrliste dauerhaft, fail-closed.
- **Drei Einwilligungs-Oberflächen:** (1) Capture-Formular im Chat (2 Checkboxen), (2) Opt-in beim Login (Button-Consent, hinterlegte Adresse), (3) Chat-Consent-Gate (Button-Consent, getippte Adresse, nur Marketing, max. 1× pro Session).

**Verbatim-Texte (deutsch, v4 — laut Code-Vermerk anwaltlich freigegeben Juni/Juli 2026):**

| Oberfläche | Text |
|---|---|
| Zusammenfassung | „Ja, schickt mir meine Beratungs-Zusammenfassung per E-Mail (inkl. Direkt-Link zur Kasse).“ |
| Marketing | „Ja, ich möchte exklusive Angebote und Aktionen erhalten — nur für Abonnenten. Jederzeit abbestellbar.“ |
| Login-Opt-in | „Ja, schickt mir an meine hinterlegte E-Mail-Adresse exklusive Angebote und Aktionen — nur für Abonnenten. Jederzeit abbestellbar.“ |
| Chat-Gate | „Ja, schickt mir persönliche Angebote und exklusive Rabatt-Aktionen an diese E-Mail-Adresse — nur für Abonnenten. Jederzeit abbestellbar.“ |
| Fußzeile (Teil des Nachweistexts) | „Verarbeitung durch motion sports gemäß Datenschutzerklärung; Widerruf jederzeit möglich.“ |

**Englische Fassung:** Der Shop läuft auch auf `/en`. Die englischen Consent-Texte sind im Code ausdrücklich als **nicht rechtlich geprüft** markiert (`CONSENT_COPY_EN_LEGAL_REVIEWED = false`) und werden dennoch ausgeliefert (→ F-12).

---

## 6. E-Mail- und Brief-Marketing

Gemeinsame Eigenschaften beider E-Mail-Kanäle: **Jede einzelne Mail wird von einem Menschen geprüft und einzeln versendet** (kein automatischer Massenversand); Abmeldelink + Impressums-/Datenschutz-Fußzeile sind technisch nicht entfernbar (außerhalb des editierbaren Textes); Rabattcodes sind einmalig nutzbar und werden erst beim Versand erzeugt; keine künstliche Verknappung/Countdowns (Prompt- und Copy-Regel); Sperrliste wird bei Sync, Vorbereitung **und** Versand erneut geprüft.

### 6.1 Kanal A — Eigener Funnel (Double-Opt-in)

Empfänger: Chat-Nutzer mit bestätigtem DOI. Versandvoraussetzungen (alle serverseitig): DOI „confirmed“, nicht abgemeldet, nicht gesperrt, funktionierender Abmeldelink, Rabatttext-Konsistenzprüfung, atomare Doppelversand-Sperre. Rabattpräfix `MS5-`.

### 6.2 Kanal B — „Kampagne“ (Shopify-Newsletter-Bestand)

Empfänger: Shopify-Kunden mit `marketingState = SUBSCRIBED` (Einwilligung stammt aus der Shopify-Checkbox, **nicht** aus unserem DOI-Flow). Shopify liefert die Consent-Qualität mit (`CONFIRMED_OPT_IN` / `SINGLE_OPT_IN` / `UNKNOWN`).

- Zwei getrennte Freigabe-Schalter, beide fail-closed: **Master-Gate** `CAMPAIGN_SENDS_APPROVED` und **Opt-in-Level-Gate** `CAMPAIGN_ALLOW_SINGLE_OPT_IN`. Laut Code-Vermerk wurden **beide am 21.07.2026 anwaltlich freigegeben** und sind in den dokumentierten Defaults aktiv — d. h. derzeit dürfen auch Kontakte **ohne nachweisbares Double-Opt-in** angeschrieben werden (→ F-06, bitte ausdrücklich bestätigen).
- Lokale Abmeldungen überschreiben Shopify („ein lokales Opt-out kann kein Sync rückgängig machen“); Shopify-seitige Abmeldungen werden beim täglichen Sync übernommen.
- **Frequenz-Deckel** (`MARKETING_MIN_SEND_INTERVAL_DAYS`) wirkt kanalübergreifend in beide Richtungen, steht aber standardmäßig auf **0 = aus** (→ F-13).
- Inhalt pro Mail: persönliche Anrede, Bezug auf Kaufhistorie, 2–3 Empfehlungen, optional Rabatt (`MK-`) oder Set-Angebot, Mo-Werbeblock mit Deep-Link, Abmelde-Footer.

### 6.3 Set-Angebote (Bundles)

Der Admin kann aus Empfehlungen ein echtes (unlistetes) Shopify-Set erstellen; „statt“-Preise sind echte Summen der Einzelpreise (PAngV-Gedanke im Code dokumentiert, → F-18); Angebote laufen nach 7 Tagen ab, abgelaufene Links zeigen eine klare Hinweisseite.

### 6.4 Physische Briefe

KI-gestützt entworfene, menschlich freigegebene Briefe; Versand über Pingen (Schweiz, Adressübermittlung im PDF) an die Deutsche Post. Freigabe laut Code-Vermerk am 14.06.2026 (eigener AVV + Drittland-Hinweis CH erforderlich). Adressquelle ausschließlich **Lieferadresse einer abgeschlossenen Bestellung**; Erfassung findet nur statt, wenn der Briefkanal aktiv geschaltet ist. Vollständigkeits-Check vor Versand; Brief-Historie 365 T.

---

## 7. KI-Einsatz im Detail

### 7.1 Modelle und Datenflüsse

| Einsatz | Anbieter/Modell | Personenbezogene Daten im Prompt |
|---|---|---|
| Live-Chat | Anthropic `claude-sonnet-4-6` | Gesprächsverlauf verbatim; abgeleitetes Bedarfsprofil; bei berechtigtem „Wiedererkennen“ (s. u.): Profiltext, gekaufte Artikel (nur Titel/Menge), Vorname, Stadt/Land |
| Zusammenfassungs-Mail | dito | Transkript des Gesprächs |
| Kundenprofil | Anthropic `claude-opus-4-8` | Alle verknüpften Transkripte, Kaufhistorie, Korrespondenz-Texte, Name, Stadt/Land |
| Gesprächsanalyse/Insights/Q&A | Anthropic `claude-haiku-4-5` | Einzeltranskripte bzw. deren Zusammenfassungen — **ohne** E-Mail/Identität |
| Marketing-/Kampagnen-/Brief-Entwürfe | Anthropic Sonnet | Profil, Kaufhistorie, Name (Brief), Operator-Anweisungen |
| Produktsuche | OpenAI `text-embedding-3-small` | **Jede Nutzernachricht** wird zur Suche eingebettet (keine Identifikatoren) |
| Sprachausgabe | OpenAI `gpt-4o-mini-tts` | Mo-Antworttext |

**Bewusst nie an KI-Modelle übermittelt:** E-Mail-Adressen, vollständige Straßenadressen (nur Stadt/Land; beim Brief nur der Name), Bestellnummern und -summen, Roh-Transkripte früherer Sitzungen (nur der verdichtete Profiltext). Auf dem Chat-Pfad ist Anthropic-**Prompt-Caching** aktiv (kurzlebiger serverseitiger Cache bei Anthropic; bei den Vertragsprüfungen zu berücksichtigen, → F-03).

### 7.2 Personalisierungs-Gate („Wiedererkennen“)

Fail-closed, zwei Wege: Stufe 2 nur, wenn die E-Mail **in derselben Session** eingegeben wurde und der Server die Capture-Zuordnung bestätigt (Schutz geteilter Geräte); Stufe 3 nur mit gültigem Login-Token **und** bestätigtem Marketing-DOI — ohne DOI nur Begrüßung mit Namen, kein Verlauf.

### 7.3 Regulatorische Einordnung (zur Prüfung)

- **Profiling/Art. 22 DSGVO:** Das System erstellt dauerhafte KI-Profile und personalisiert Beratung und Werbung; es trifft keine automatisierte Entscheidung mit Rechtswirkung (Einschätzung). **Eine dokumentierte DSFA existiert weiterhin nicht** (→ F-04).
- **EU AI Act:** Die Transparenzpflichten des Art. 50 (Chatbot-Kennzeichnung) gelten seit 02.08.2026. Mo bezeichnet sich im Gespräch selbst als KI; ob die Widget-Oberfläche (Theme-Repo) eine ausreichende Kennzeichnung trägt, kann dieses Backend nicht sicherstellen (→ F-07).
- **HWG/MDR:** Medizinische Wirkaussagen sind promptseitig verboten; Geräte werden aktiv als Nicht-Medizinprodukte klargestellt.
- **Q&A-Veröffentlichung:** Aus realen Gesprächen abgeleitete Fragen werden vor Veröffentlichung menschlich beantwortet/geprüft und enthalten keine Identität; Einträge überleben die Löschung des Ursprungsgesprächs (redaktioneller Inhalt — Einschätzung).

---

## 8. Betroffenenrechte — Ist-Stand

| Recht | Stufe 1 (anonym) | Stufe 2 (E-Mail) | Stufe 3 (eingeloggt) |
|---|---|---|---|
| Auskunft/Export | kein Personenbezug herstellbar | **manuell** (Abfrage per E-Mail) | **Self-Service:** JSON-Export (Profil, Consents, Transkripte, Korrespondenz, Briefe, Sends, Feedback, Sperrstatus) |
| Löschung | über Session-ID, falls beibringbar | manuell (dokumentierter Prozess) | **Self-Service:** vollständige Löschung inkl. Profil, Tokens, Consent-Purge + Sperrlisteneintrag |
| Einzelgespräch löschen | — | — | Self-Service; bereits abgeleiteter Profiltext bleibt bis Regeneration/Volllöschung (bewusstes Design, im Juni-Bericht als zu bestätigen markiert) |
| Widerspruch Werbung | — | 1-Klick-Abmeldung, dauerhaft | dito |

**Bekannte Lücken (→ F-10):** Der Export enthält nicht: Telemetrie (`kpi_events`), Kampagnen-Tabellen, Login-Verknüpfungen, Admin-Zugriffsprotokoll, Analyse-Berichte. Die Selbst-Löschung erfasst nicht: bereits erzeugte Analyse-Berichte mit Klarnamen (laut Migrations-Kommentar manuell zu löschen), Merge-Konflikt-Tabelle (keine Frist), Kampagnen-Zeilen (laufen über die 365-T-Frist aus). Für Stufe 1/2 gibt es keinen Self-Service.

---

## 9. Auftragsverarbeiter und Drittlandtransfers

| Dienst | Rolle | Daten | Drittland | Aus dem Code nicht verifizierbar |
|---|---|---|---|---|
| Anthropic | LLM | Transkripte, Profile, Namen (kontextabhängig) | USA (Standard-Endpunkt) | AVV; No-Training-/Zero-Retention-Bedingungen; DPF/SCC |
| OpenAI | Embeddings + TTS | Nutzernachrichten (Suche), Antworttexte | USA | dito |
| Neon | Datenbank — **alle persistenten PII** | alles aus § 3 | vom Konto abhängig | AVV; **Region** (wichtigster Einzelpunkt) |
| Vercel | Hosting/Cron/Blob | Verarbeitung im RAM; Blob ohne PII | Compute in **fra1 (Frankfurt) gepinnt**; Log-/Konto-Ebene offen | AVV |
| Resend | E-Mail aus-/eingehend | Adressen + vollständige Inhalte | USA (keine EU-Region im Code) | AVV; **EU-Residenz insb. für eingehende Mails** |
| Shopify | Shop, Kundenkonto-API | E-Mail als Suchbegriff, Bestellungen, Adressen | US-Konzern | AVV; „Protected Customer Data“-Freigabe |
| Upstash | Rate-Limits | IP/Session-ID/E-Mail als kurzlebige Schlüssel | vom Konto abhängig | AVV; Region |
| Pingen | Briefdruck/-versand | Name + volle Adresse + Briefinhalt (im PDF) | **Schweiz** (Angemessenheitsbeschluss) | AVV (laut Code-Vermerk gefordert und Teil der Freigabe 14.06.) |
| Sentry | Fehler (optional) | grundsätzlich keine PII (Scrubber, s. § 10) | USA, sofern kein EU-DSN | AVV; EU-DSN |

**Kernbefund unverändert seit Juni:** Im Repository ist **kein AVV-Register** und (außer Vercel-Compute) **keine Regionspinnung** nachweisbar. Das ist Konto-/Vertragsebene und der wichtigste offene Block (→ F-01/F-02/F-03).

---

## 10. Technische und organisatorische Maßnahmen (Auswahl)

**Stark:** Origin-Allowlist + Shared-Secret auf allen Widget-Endpunkten; konstante-Zeit-Vergleiche aller Secrets; signierte, fail-closed Webhooks (Resend/Svix, Pingen, Shopify); OAuth mit PKCE + Nonce, Tokens nie im Browser, AES-256-GCM at rest; Ownership-Scoping ohne Enumerationsleck; täglicher Lösch-Lauf; Sperrliste fail-closed; Sentry ohne Standard-PII **mit serverseitigem E-Mail-Scrubber** (seit Juni neu); zentrale E-Mail-Versandstelle, die Empfänger/Betreff nicht in Logs schreibt; Klick- statt Öffnungs-Tracking; Admin-CSRF-Schutz; Admin-Zugriffsprotokoll (730 T).

**Bekannte Schwächen:** Admin-Login = **ein geteiltes Passwort**, 12-h-Cookie ohne serverseitige Widerrufsmöglichkeit, kein 2FA, keine namentlichen Konten (Protokoll kann Personen nicht unterscheiden) (→ F-15). Telemetrie-Endpunkt `/api/kpi` ist nur origin-geschützt (kein Secret) (→ F-16). Rate-Limit-Schlüssel ist client-wählbar (Session-ID), abgesichert nur bei den missbrauchskritischen Endpunkten (E-Mail-Empfänger-Cap, Kontaktformular-IP-Cap).

---

## 11. Seit dem Juni-Bericht umgesetzt (Delta)

| Juni-Befund | Status heute |
|---|---|
| OQ-01 Adress-Auto-Erfassung ohne Gate | **Behoben:** Erfassung nur bei aktivem Briefkanal **und** nur kaufbasierte Lieferadressen; Shopify-Standardadresse wird nicht mehr automatisch übernommen |
| OQ-04 Sentry ohne Scrubber | **Behoben:** `beforeSend`-Scrubber (E-Mail-Muster, Shopify-Query-Filter), `sendDefaultPii=false` |
| OQ-06 § 7 (3) UWG „Bestandskunden“ | **Feature vollständig entfernt** (Mandanten-Entscheidung 16.06.2026) |
| OQ-09 keine Inaktivitäts-Löschung | **Behoben:** 1095 T für inaktive Kunden ohne aktive Einwilligung |
| OQ-10 Feedback ohne Frist | **Behoben:** 365 T |
| OQ-11 kein vollständiger Export | **Teilweise behoben:** JSON-Vollexport für Stufe 3 (Rest-Lücken → F-10) |
| OQ-15 kein Admin-Audit-Log | **Teilweise behoben:** Zugriffsprotokoll existiert (730 T); weiterhin nur Shared-Passwort |
| OQ-16 kein Frequenz-Deckel | **Gebaut,** aber Default 0 = aus (→ F-13) |
| Vercel-Region | Compute jetzt **fra1** gepinnt |
| **Neu hinzugekommen** | Kampagnen-Kanal (freigegeben 21.07.), Consent v4 + Chat-Consent-Gate (freigegeben Juli), Gesprächs-/Komplettanalyse, Q&A-Wissen, Klick-Tracking, Umsatz-Attribution, EN-Sprachversion, TTS, Prompt-Caching |

**Unverändert offen:** AVV-Register, Datenresidenz, KI-Anbieter-Bedingungen, DSFA, Abgleich Datenschutzerklärung.

---

## 12. Prüfbitten an Sie (priorisiert)

### Priorität 1 — vor bzw. für den laufenden Betrieb

- **F-01 — AVV-Register:** Bitte bestätigen/beschaffen Sie einen AVV mit jedem Prozessor aus § 9 (9 Dienste). Im Code ist keiner nachweisbar.
- **F-02 — Datenresidenz:** EU-Region für **Neon** (alle PII), **Resend** (inkl. eingehender Mails — teamintern als „legal-blocking“ markiert), Upstash, Sentry-DSN prüfen/festlegen; Vercel-Compute ist bereits Frankfurt.
- **F-03 — KI-Anbieter-Bedingungen:** Anthropic/OpenAI: No-Training + Zero-/Short-Retention + Transferabsicherung (DPF/SCC) bestätigen; bitte auch das aktivierte **Prompt-Caching** (kurzlebige Speicherung bei Anthropic) einbeziehen.
- **F-04 — DSFA:** Für die KI-Profilbildung/Personalisierung liegt weiterhin keine dokumentierte DSFA vor. Bitte Erforderlichkeit feststellen und ggf. erstellen; Art.-22-Einordnung (keine automatisierte Entscheidung mit Rechtswirkung) bestätigen.
- **F-05 — Datenschutzerklärung/Impressum:** Abgleich der Shop-Texte mit dem Ist-Stand dieses Dossiers, insbesondere: KI-Profilbildung aus früheren Chats + Käufen, alle Prozessoren + Drittlandtransfers, Speicherfristen (§ 3), Klick-Tracking, Kampagnen-Kanal, Sprachausgabe, Korrespondenz-Speicherung, Briefversand. Zudem organisatorische Regelung für das Kontaktformular-Postfach (Frist/Zugriff).
- **F-06 — Kampagnen-Kanal / Single-Opt-in:** Bitte bestätigen Sie schriftlich Umfang und Fortbestand der Freigabe vom 21.07.2026 — insbesondere, dass auch Kontakte mit `SINGLE_OPT_IN`/`UNKNOWN` (kein nachweisbares Double-Opt-in) angeschrieben werden dürfen, angesichts der deutschen DOI-Rechtsprechung. Falls nicht: Gate abschalten; als Alternative ist ein DOI-Refresh über die bestehende Bestätigungs-Infrastruktur konzipiert (nicht gebaut).
- **F-07 — KI-Kennzeichnung (AI Act Art. 50, anwendbar seit 02.08.2026):** Mo identifiziert sich im Gespräch als KI. Bitte prüfen, ob zusätzlich eine Kennzeichnung in der Widget-Oberfläche (Theme) erforderlich ist, und Vorgabe formulieren.

### Priorität 2 — zeitnah

- **F-08 — Chat-Datenfluss ohne Einwilligung:** Transkript-Speicherung (180 T) und Übermittlung an Anthropic (Chat) und OpenAI (Suche/Embedding jeder Nachricht) erfolgen auf Basis von Art. 6 (1) b/f ohne vorgeschaltetes Consent-Gate. Bitte Basis und Transparenzanforderungen bestätigen.
- **F-09 — KI-Auswertung im Admin:** Rechtsgrundlage (Art. 6 (1) f) für Gesprächsanalyse, Insights und Q&A-Extraktion bestätigen; für die identitätsbehaftete „Komplettanalyse“ (Klarnamen, 365 T, manuelle Löschung bei Konto-Löschung) Vorgaben machen.
- **F-10 — Restlücken Betroffenenrechte/Fristen:** (a) Export ohne Kampagnen-/Telemetrie-Daten; (b) Selbst-Löschung erfasst Analyse-Berichte nicht automatisch; (c) `marketing_sends` und Merge-Konflikt-Tabelle ohne eigene Frist; (d) kein Self-Service für Stufe 1/2 (manueller Prozess dokumentiert). Bitte bewerten, was davon nachzurüsten ist.
- **F-11 — Verbraucherrechtliche Aussagen im Prompt:** Mo teilt „14 Tage Widerruf, kostenlose Rücksendung (DE), Ware unbenutzt und originalverpackt“ als Fakt mit. Bitte prüfen, ob die Formulierung „unbenutzt und originalverpackt“ als unzulässige Bedingung des Widerrufsrechts missverstanden werden kann, und eine rechtssichere Kurzformulierung vorgeben (ebenso Versand-/Zahlarten-Aussagen).
- **F-12 — Englische Rechtstexte:** Die EN-Consent-Texte sind unprüft im Einsatz (`/en`-Storefront). Bitte freigeben oder EN-Erfassung bis dahin sperren.
- **F-13 — Frequenz-Deckel:** `MARKETING_MIN_SEND_INTERVAL_DAYS` steht auf 0 (aus). Bitte Wert vorgeben (z. B. 14 Tage), gilt kanalübergreifend.
- **F-14 — TDDDG § 25 / Widget-Speicher:** Die Session-ID liegt im localStorage des Browsers (gesetzt vom Theme, nicht von diesem Backend). Bitte Einordnung (unbedingt erforderlich?) und Abstimmung mit dem Consent-Banner des Shops.

### Priorität 3 — Ordnungspunkte

- **F-15 — Admin-Zugang:** Geteiltes Passwort ohne 2FA/namentliche Konten; Zugriffsprotokoll kann Personen nicht unterscheiden. Empfehlung aussprechen (für Einzelbetreiber akzeptabel?).
- **F-16 — Telemetrie-Endpunkt:** `/api/kpi` nur origin-geschützt. Risiko-/Erforderlichkeitsbewertung.
- **F-17 — „nur für Abonnenten“:** Exklusivitätsclaim in den Consent-Labels — UWG-Irreführungsrisiko, falls faktisch vergleichbare Angebote auch außerhalb gewährt werden. Bitte Leitplanke bestätigen.
- **F-18 — PAngV bei Set-Angeboten:** „statt“-Preise sind echte Einzelpreissummen (im Code so umgesetzt). Kurze Bestätigung der Darstellungsanforderungen.
- **F-19 — Abgleich der Freigabe-Vermerke:** Bitte bestätigen Sie, dass die im Code dokumentierten Freigaben (Anhang A) mit Ihren Unterlagen übereinstimmen — Vermerke stammen aus der Entwicklung.

---

## Anhang A — Chronologie der im Code dokumentierten anwaltlichen Freigaben

| Datum | Gegenstand | Code-Vermerk |
|---|---|---|
| Juni 2026 | Deutsche Consent-Texte v3 (Capture-Formular, DOI-/Abmelde-Texte) | `CONSENT_COPY_LAWYER_APPROVED = true` |
| 14.06.2026 | Physischer Briefversand über Pingen (inkl. AVV-/CH-Drittland-Auflage) | `PHYSICAL_MAIL_SENDS_APPROVED=true` |
| 16.06.2026 | Entscheidung des Mandanten: § 7 (3)-UWG-Feature ersatzlos entfernt | Addendum im Juni-Bericht |
| 21.07.2026 | Kampagnen-Kanal (Shopify-Abonnenten) **inkl.** Single-Opt-in-Kontakten | `CAMPAIGN_SENDS_APPROVED=true`, `CAMPAIGN_ALLOW_SINGLE_OPT_IN=true` |
| Juli 2026 | Consent-Texte v4 (Chat-Consent-Gate, Benefit-Headlines) | Kommentar in `consent-copy-core.mjs` |

## Anhang B — Glossar

- **DOI:** Double-Opt-in — Bestätigung der Marketing-Einwilligung per Klick auf einen Mail-Link.
- **Capture:** Erfassung der E-Mail-Adresse im Chat mit Einwilligungs-Nachweis.
- **Cluster A/B:** Datenbank-Trennung pseudonymer Nutzungsdaten (A) von identifizierten, einwilligungsbasierten Daten (B).
- **Stufe 1/2/3:** Identitätsstufen anonym / E-Mail erfasst / eingeloggt (Shopify-Konto).
- **Kanal A/B:** eigener DOI-Marketing-Funnel (Rabattpräfix `MS5-`) / Kampagnen-Mails an Shopify-Abonnenten (`MK-`).
- **Fail-closed:** Im Fehler- oder Zweifelsfall wird blockiert (z. B. gilt eine Adresse bei DB-Fehler als gesperrt).
- **Prompt:** Die an das KI-Modell übermittelte Eingabe (Systemanweisungen + Gesprächsverlauf).

*Erstellt am 05.08.2026 aus dem Quellcode des Backends. Fundstellen (Dateipfade) zu jeder Einzelaussage können auf Wunsch nachgeliefert werden; die technischen Detailinventare liegen der Entwicklung vor.*
