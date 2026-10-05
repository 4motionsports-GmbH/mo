# Rechtsdossier „Mo“ — KI-Verkaufsberater auf motionsports.de

**Zweck:** Vollständige, aktuelle Beschreibung des Systems für die externe anwaltliche Prüfung (Datenschutz, Wettbewerbs-/Lauterkeitsrecht, KI-Regulierung, Verbraucherrecht) — als Grundlage für Ihr Feedback und Ihre Handlungsempfehlungen.
**Stand:** 05.08.2026 — code-basiert erstellt aus dem tatsächlichen Stand des Backends (nicht aus älteren Konzeptpapieren). **Nachtrag 01.10.2026:** Kundenplattform — eine Einwilligung mit Shopify, eine Löschung, alle Shop-Kunden, Briefwerbung (§ 13, Prüfbitten F-22 bis F-29). **Nachtrag 02.10.2026:** E-Mails im Eingang — KI-Antwortentwurf, Kontaktformular in der Kundenakte (§ 14, F-30). **Nachtrag 03.10.2026:** behobene Schwachstellen in der Anmelde-Zuordnung (§ 15, F-31 und F-34). **Nachtrag 03.10.2026 (2):** Bestellstatus im Chat — standardmäßig aus (§ 16, F-32); „Einplanen“ geprüfter Kampagnen-Mails (§ 17, F-33). **Nachtrag 03.10.2026 (3):** Werbebriefe als Kampagnen-Kanal (§ 18, F-35). **Nachtrag 05.10.2026:** Bestell-Zuordnung — Fenster ab der letzten Beratung; Entscheidung des Mandanten: Schalter an nach der Migration (§ 20, F-37). **Nachtrag 05.10.2026 (2):** Erkennung der Shop-Anmeldung im Chat (App Proxy); Entscheidung des Mandanten, nach seiner Angabe von Ihnen bestätigt (§ 19, F-36 beantwortet). **Nachtrag 05.10.2026 (3):** Vorteilspunkte im Einwilligungs-Popup vom Server (Copy-Version v5), Seitenkontext bei getippten Fragen auf Produktseiten — standardmäßig aus (§ 21, F-38).
**Ersetzt:** den „DSGVO Readiness Report“ vom 16.06.2026 ([`archive/LEGAL_READINESS_REPORT.md`](./archive/LEGAL_READINESS_REPORT.md)). Was seither umgesetzt wurde, steht in § 11; was neu hinzukam, ist durchgängig eingearbeitet.
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

**Kontaktformular:** Name, E-Mail, Telefon, Organisation, Nachricht + Anliegen (8 Kategorien inkl. Bestellsupport). Wird per Resend an das interne Postfach weitergeleitet und **seit 02.10.2026 zusätzlich in der Systemdatenbank gespeichert** (Korrespondenz der Person; unbekannte Absender werden als Interessent ohne Einwilligung angelegt, → § 14).

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
| D-01 | **Chat-Transkripte** | Nutzer- und Mo-Texte, Tool-Aufrufe; pseudonym (Session-ID); Personenbezug nur nach E-Mail-Erfassung/Login; bei angemeldeten Kunden ggf. Mos Auskunft zum Stand ihrer Bestellungen (§ 16) | **180 T** ab letzter Aktivität |
| D-02 | Gesprächs-Metadaten | Persona, empfohlene/gewählte Produkte, Status, Titel, KI-Analyse (Zusammenfassung, Kategorie, Qualität) | 180 T |
| D-03 | Nutzungs-Telemetrie (`kpi_events`) | Ereignisname, Session-ID, Kontextdaten; **nie** E-Mail | 180 T |
| D-04 | **Einwilligungs-Nachweis** (`email_captures`) | E-Mail, beide Consent-Flags, DOI-Status/-Token, **wortlautgetreuer Einwilligungstext + Versionsstempel**, Abmeldezeitpunkt | Aktive Einwilligung: unbefristet (Art.-7-Nachweis); nach Abmeldung: PII-Löschung nach 30 T Karenz |
| D-05 | **Sperrliste** (`suppression_list`) | E-Mail, Grund, Zeitpunkt | **Unbefristet** (damit Opt-outs dauerhaft greifen) |
| D-06 | Marketing-Sendehistorie | Entwurfstext, Betreff, Rabattcode, Klick-Zeitpunkt | Fällt mit dem Einwilligungs-Datensatz weg; keine eigene Frist (→ F-10) |
| D-07 | **Kundenakte** (`customers`) — seit Migration 0059 für **jede** Person (Chat, Shopify-Login **und** Kampagnen-Kontakt), mit Herkunft | E-Mail, Consent-Spiegel, **KI-Profil (Text + strukturierte Merkmale: Persona, Niveau, Budget-Signal, Ziele, Besitz, Interessen, nächste Schritte)**, Bestellhistorien-Cache, Shopify-Identität, ggf. Postadresse (nur kaufbasiert, nur bei aktivem Briefkanal), Admin-Notizen, Briefentwurf | Solange Einwilligung aktiv (Chat-DOI oder aktives Shopify-Newsletter-Abo); **inaktive Kunden ohne aktive Einwilligung: 1095 T (3 J.)**; Löschung auf Antrag/Self-Service |
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
| D-18 | Kontaktformular | Name, E-Mail, Telefon, Organisation, Nachricht | Seit 02.10.2026 als eingehende Mail in der Korrespondenz (D-09, **365 T**); Absender als Kundenakte ohne Einwilligung (Löschung bei Inaktivität wie jede Akte ohne Shop-Konto); Kopie im internen Postfach (organisatorische Frist nötig, → F-05) |
| D-19 | Merge-Konflikte beim Login | Shopify-/lokale E-Mail, Session-ID | **Keine Frist, kein Lösch-Lauf** (→ F-10) |
| D-20 | Bestell-Zuordnung (`mo_attribution_tokens`, `mo_orders`) | Markierung: opakes Token, Session-ID, Quelle (Widget, Zusammenfassungs-Mail, Werbe-Mail, Set-Angebot), Erstellzeit. Mo-zugeordnete Bestellung: Shopify-Bestell-ID und -Nummer, Datum, Zahlstatus, Betrag, Rabattcodes, Positionen, Zuordnungsstufe, Session-ID — **keine** Kundendaten. Nicht zuordenbare markierte Bestellungen nur als Zählereignis ohne Sitzung (D-03, § 20) | Markierung: 37 T ab Erstellung; mit Schalter (§ 20) bei Widget-Markierungen 37 T ab der letzten Produktberatung des Geräts, höchstens **180 T** ab Erstellung; bei Löschung auf Wunsch sofort. Bestellungen: **180 T** ab Bestelldatum (bei Löschung auf Wunsch ohne Session-Bezug weiter, § 3.2) |

**Kein** Einsatz von: Google Analytics, Meta-Pixel o. ä. Tracking-Diensten; keine Öffnungs-Pixel in E-Mails (nur Klick-Tracking auf vom Empfänger angeklickten Links); keine User-Agent-Speicherung; kein Geräte-Fingerprinting.

### 3.2 Durchsetzung

Ein täglicher, abgesicherter Lösch-Lauf setzt alle Fristen automatisch durch. Beim fristbedingten Lösch-Lauf einer Kundenakte werden Transkripte/Korrespondenz/Briefe **entpersonalisiert** (Verknüpfung wird getrennt, Inhalte laufen über ihre eigene Frist aus); OAuth-Tokens werden mitgelöscht; die Sperrliste bleibt.

**Vollständige Löschung auf Wunsch** (seit 09/2026, ein zentraler Löschpfad `erasePerson`): löscht in einer Transaktion Kundenakte + Profil, **alle** Gespräche (alle Geräte), Einwilligungsdatensätze, Marketing- und Kampagnen-Entwürfe/-Sendungen, Kampagnen-Kontakt, Korrespondenz, Briefe, Feedback, Telemetrie der Sessions, Login-Zwischenstände, Merge-Konflikte und den Personenabschnitt in gespeicherten Analyse-Berichten; Hero-Bilder im Blob-Speicher werden entfernt. Bestelldatensätze bleiben **ohne** Session-Bezug für Umsatzkennzahlen. Die Adresse kommt mit Grund `erasure` auf die Sperrliste (kein erneutes Anschreiben, kein Re-Import aus Shopify). Ein automatischer Test prüft, dass jede Tabelle mit Personenbezug im Löschplan steht.

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
| R-11 | Kontaktformular (inkl. Speicherung in der Kundenakte, § 14) | Art. 6 (1) b/f | → F-30 |
| R-12 | Rate-Limiting (IP), Fehlerüberwachung, Admin-Zugriffsprotokoll | Art. 6 (1) f | IP-Verarbeitung in DSE erwähnen |
| R-13 | Bestellstatus im Chat für angemeldete Kunden (§ 16; Schalter standardmäßig aus) | Art. 6 (1) b (Kundenservice zum eigenen Vertrag) | → F-32 |
| R-14 | Werbebriefe aus Kampagnen an Bestandskunden (§ 18) | Art. 6 (1) f | Auch an Kunden ohne E-Mail-Einwilligung; Adresse nur aus der letzten abgeschlossenen Bestellung; → F-35 |

---

## 5. Einwilligungen (Stand: Copy-Version v5 seit 05.10.2026 — Änderungen gegenüber v4 in § 21)

**Mechanik (alles serverseitig erzwungen, fail-closed):**

- Zwei **getrennte, nie vorangekreuzte** Checkboxen (Zusammenfassung vs. Marketing); Marketing nie Voraussetzung für die Zusammenfassung; Prompt verbietet Kopplung und Dringlichkeitsdruck.
- **Double-Opt-in** für Marketing: 256-Bit-Token, 7 Tage gültig; vor Bestätigung keine einzige Marketing-Mail.
- **Wortlautgetreuer Nachweis:** Der angezeigte Einwilligungstext wird verbatim gespeichert; ein Versionsstempel (v4, seit 05.10.2026 v5 — § 21) wird nur vergeben, wenn der zurückgemeldete Text byte-identisch mit dem Serverstand ist.
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

**Englische Fassung:** Der Shop läuft auch auf `/en`. Die englischen Consent-Texte sind im Code ausdrücklich als **nicht rechtlich geprüft** markiert (`CONSENT_COPY_EN_LEGAL_REVIEWED = false`) und werden dennoch ausgeliefert (→ F-12). *Nachtrag 05.10.2026:* Der Mandant hat die englischen Texte als getreue Übersetzung der freigegebenen deutschen Fassung freigegeben (`CONSENT_COPY_EN_LEGAL_REVIEWED = true`); Satz für Satz gegen das Deutsche geprüft (Erfassungsformular, Opt-in nach der Anmeldung, Chat-Einwilligung, DOI-Mail), kein Wortlaut geändert.

---

## 6. E-Mail- und Brief-Marketing

> **Seit 01.10.2026 überholt (§ 13):** Es gibt nur noch **eine** Werbe-Einwilligung, gemeinsam mit Shopify, und mehrere Kampagnen über alle Kunden mit Einwilligung; der 1:1-Kanal ist die Kampagne „Einzelansprache“. 6.1 und 6.2 beschreiben den Stand davor und bleiben als Historie stehen.

Gemeinsame Eigenschaften beider E-Mail-Kanäle: **Jede einzelne Mail wird von einem Menschen geprüft und einzeln versendet** (kein automatischer Massenversand); Abmeldelink + Impressums-/Datenschutz-Fußzeile sind technisch nicht entfernbar (außerhalb des editierbaren Textes); Rabattcodes sind einmalig nutzbar und werden erst beim Versand erzeugt; keine künstliche Verknappung/Countdowns (Prompt- und Copy-Regel); Sperrliste wird bei Sync, Vorbereitung **und** Versand erneut geprüft.

### 6.1 Kanal A — Eigener Funnel (Double-Opt-in)

Empfänger: Chat-Nutzer mit bestätigtem DOI. Versandvoraussetzungen (alle serverseitig): DOI „confirmed“, nicht abgemeldet, nicht gesperrt, funktionierender Abmeldelink, Rabatttext-Konsistenzprüfung, atomare Doppelversand-Sperre. Rabattpräfix `MS5-`.

### 6.2 Kanal B — „Kampagne“ (Shopify-Newsletter-Bestand)

Empfänger: Shopify-Kunden mit `marketingState = SUBSCRIBED` (Einwilligung stammt aus der Shopify-Checkbox, **nicht** aus unserem DOI-Flow). Shopify liefert die Consent-Qualität mit (`CONFIRMED_OPT_IN` / `SINGLE_OPT_IN` / `UNKNOWN`).

- Zwei getrennte Freigabe-Schalter, beide fail-closed: **Master-Gate** `CAMPAIGN_SENDS_APPROVED` und **Opt-in-Level-Gate** `CAMPAIGN_ALLOW_SINGLE_OPT_IN`. Laut Code-Vermerk wurden **beide am 21.07.2026 anwaltlich freigegeben** und sind in den dokumentierten Defaults aktiv — d. h. derzeit dürfen auch Kontakte **ohne nachweisbares Double-Opt-in** angeschrieben werden (→ F-06, bitte ausdrücklich bestätigen).
- Lokale Abmeldungen überschreiben Shopify („ein lokales Opt-out kann kein Sync rückgängig machen“); Shopify-seitige Abmeldungen werden beim täglichen Sync übernommen.
- **Frequenz-Deckel** (`MARKETING_MIN_SEND_INTERVAL_DAYS`) wirkt kanalübergreifend in beide Richtungen, steht aber standardmäßig auf **0 = aus** (→ F-13).
- Inhalt pro Mail: persönliche Anrede, Bezug auf Kaufhistorie, 2–3 Empfehlungen, optional Rabatt (`MK-`) oder Set-Angebot, Mo-Werbeblock mit Deep-Link, Abmelde-Footer und — getrennt davon — ein Link „Daten löschen“ (Bestätigungsseite, dann vollständige Löschung).
- **Neu (09/2026): Kundenprofil auch für Kampagnen-Kontakte.** Jeder Kontakt erhält eine Kundenakte (D-07) und ein KI-Profil aus Käufen und Kampagnen-Historie (auch ohne je gechattet zu haben); das Profil steuert Text und Produktauswahl der Kampagnen-Mail und — kommt die Person später in den Chat — die Beratung (→ F-20).

### 6.3 Set-Angebote (Bundles)

Der Admin kann aus Empfehlungen ein echtes (unlistetes) Shopify-Set erstellen; „statt“-Preise sind echte Summen der Einzelpreise (PAngV-Gedanke im Code dokumentiert, → F-18); Angebote laufen nach 7 Tagen ab, abgelaufene Links zeigen eine klare Hinweisseite.

### 6.4 Physische Briefe

KI-gestützt entworfene, menschlich freigegebene Briefe; Versand über Pingen (Schweiz, Adressübermittlung im PDF) an die Deutsche Post. Freigabe laut Code-Vermerk am 14.06.2026 (eigener AVV + Drittland-Hinweis CH erforderlich). Adressquelle ausschließlich **Lieferadresse einer abgeschlossenen Bestellung**; Erfassung findet nur statt, wenn der Briefkanal aktiv geschaltet ist. Vollständigkeits-Check vor Versand; Brief-Historie 365 T. Seit 03.10.2026 gibt es Werbebriefe auch als Kanal einer Kampagne (§ 18); seitdem wird die Adressregel auch beim Versand eines Einzelbriefs erzwungen — eine Adresse anderer Herkunft (z. B. aus dem Shop-Kundenkonto) wird abgelehnt.

---

## 7. KI-Einsatz im Detail

### 7.1 Modelle und Datenflüsse

| Einsatz | Anbieter/Modell | Personenbezogene Daten im Prompt |
|---|---|---|
| Live-Chat | Anthropic `claude-sonnet-5-5` | Gesprächsverlauf verbatim; abgeleitetes Bedarfsprofil; bei berechtigtem „Wiedererkennen“ (s. u.): Profiltext, gekaufte Artikel (nur Titel/Menge), Vorname, Stadt/Land. **Nur bei eingeschaltetem Bestellstatus (§ 16) und Anmeldung über das Kundenkonto in derselben Chat-Sitzung, auf Frage des Kunden:** Stand der eigenen Bestellungen — Bestelldatum, Artikel (Titel/Variante/Menge), Versand- und Zahlungsstatus, Name des Versanddienstleisters, angekündigter bzw. erfolgter Zustelltag; **ohne** Bestellnummer, Beträge, Sendungsnummer/-link, Adresse, E-Mail oder interne Kennungen |
| Zusammenfassungs-Mail | dito | Transkript des Gesprächs |
| Kundenprofil (jede Nacht für Kunden mit neuer Aktivität) | Anthropic `claude-opus-5-5` | Alle verknüpften Transkripte, Kaufhistorie, Korrespondenz-Texte, Kampagnen-Historie (Abo-Status, gesendete Mails, Klicks), Name, Stadt/Land |
| Antwortentwurf auf eingehende E-Mails (Eingang, seit 02.10.2026) | Anthropic Sonnet | Name, die letzten 12 Mails der Korrespondenz (eingehend und ausgehend, ohne Zitate), die letzten 3 Bestellungen (Datum, Status, Artikel — **ohne** Bestellnummer und Beträge), Profiltext (nicht nach Widerspruch). Der Inhalt der Mails selbst kann beliebige Angaben der Person enthalten |
| Gesprächsanalyse/Q&A-Übersetzung | Anthropic `claude-haiku-4-5`; Insights-Rollup und Q&A-Entwürfe `claude-sonnet-5-5` | Einzeltranskripte bzw. deren Zusammenfassungen — **ohne** E-Mail/Identität |
| Marketing-/Kampagnen-/Brief-Entwürfe, Zusammenfassungs-Mail (wiederkehrende Kunden), Hero-Bilder, Set-Vorschläge | Anthropic Sonnet (Hero-Bild: OpenAI, nur verdichteter Kontext) | Profil, Kaufhistorie, Name (Brief), Operator-Anweisungen |
| Produktsuche | OpenAI `text-embedding-3-small` | **Jede Nutzernachricht** wird zur Suche eingebettet (keine Identifikatoren) |
| Sprachausgabe | OpenAI `gpt-4o-mini-tts` | Mo-Antworttext |

**Bewusst nie an KI-Modelle übermittelt:** E-Mail-Adressen, vollständige Straßenadressen (nur Stadt/Land; beim Brief nur der Name), Bestellnummern und -summen (auch nicht beim Bestellstatus, § 16 — technisch durch eine feste Feldliste und einen automatischen Test abgesichert), Roh-Transkripte früherer Sitzungen (nur der verdichtete Profiltext). Nennt der Kunde selbst eine Bestellnummer im Chat, steht sie — wie jede eigene Angabe — im Gesprächsverlauf. **Korrektur 03.10.2026:** Bis zu diesem Tag enthielten die Kaufzeilen der Kampagnen-Mail-Entwürfe je Bestellung die Bestellbezeichnung des Shops (z. B. „#1042“) — entgegen dieser Aussage. Das ist behoben (seit 03.10.2026 nur Datum und Artikel); Beträge waren nie enthalten. Auf dem Chat-Pfad ist Anthropic-**Prompt-Caching** aktiv (kurzlebiger serverseitiger Cache bei Anthropic; bei den Vertragsprüfungen zu berücksichtigen, → F-03).

### 7.2 Personalisierungs-Gate („Wiedererkennen“)

Fail-closed, zwei Wege: Stufe 2 nur, wenn die E-Mail **in derselben Session** eingegeben wurde und der Server die Capture-Zuordnung bestätigt (Schutz geteilter Geräte); Stufe 3 nur mit gültigem Login-Token **und** entweder bestätigtem Marketing-DOI **oder** aktivem Shopify-Newsletter-Abo des verknüpften Kampagnen-Kontakts (neu 09/2026, → F-20) — ohne eines von beiden nur Begrüßung mit Namen, kein Verlauf.

### 7.3 Regulatorische Einordnung (zur Prüfung)

- **Profiling/Art. 22 DSGVO:** Das System erstellt dauerhafte KI-Profile (seit 09/2026 automatisch nachts und auch für Newsletter-Kontakte ohne Chat) und personalisiert Beratung und Werbung; es trifft keine automatisierte Entscheidung mit Rechtswirkung (Einschätzung). **Eine dokumentierte DSFA existiert weiterhin nicht** (→ F-04).
- **EU AI Act:** Die Transparenzpflichten des Art. 50 (Chatbot-Kennzeichnung) gelten seit 02.08.2026. Mo bezeichnet sich im Gespräch selbst als KI; ob die Widget-Oberfläche (Theme-Repo) eine ausreichende Kennzeichnung trägt, kann dieses Backend nicht sicherstellen (→ F-07).
- **HWG/MDR:** Medizinische Wirkaussagen sind promptseitig verboten; Geräte werden aktiv als Nicht-Medizinprodukte klargestellt.
- **Q&A-Veröffentlichung:** Aus realen Gesprächen abgeleitete Fragen werden vor Veröffentlichung menschlich beantwortet/geprüft und enthalten keine Identität; Einträge überleben die Löschung des Ursprungsgesprächs (redaktioneller Inhalt — Einschätzung).

---

## 8. Betroffenenrechte — Ist-Stand

| Recht | Stufe 1 (anonym) | Stufe 2 (E-Mail) | Stufe 3 (eingeloggt) |
|---|---|---|---|
| Auskunft/Export | kein Personenbezug herstellbar | **manuell** (Abfrage per E-Mail) | **Self-Service:** JSON-Export (Profil, Consents, Transkripte, Korrespondenz, Briefe, Sends, Kampagnen-Kontakt + -Sendungen, Feedback, Sperrstatus) |
| Löschung | über Session-ID, falls beibringbar | **Self-Service** über den Link „Daten löschen“ in jeder Marketing-/Kampagnen-Mail; sonst Admin-Button „Löschen“ (auf Anfrage) — jeweils vollständige Löschung (§ 3.2) | **Self-Service:** Widget-Button, vollständige Löschung (§ 3.2) |
| Einzelgespräch löschen | — | — | Self-Service; bereits abgeleiteter Profiltext bleibt bis Regeneration/Volllöschung (bewusstes Design, im Juni-Bericht als zu bestätigen markiert) |
| Widerspruch Werbung | — | 1-Klick-Abmeldung, dauerhaft; telefonisch/schriftlich: Admin „Abmelden“ (protokolliert) | dito |

**Bekannte Lücken (→ F-10):** Der Export enthält nicht: Telemetrie (`kpi_events`), Login-Verknüpfungen, Admin-Zugriffsprotokoll, Analyse-Berichte. Die Löschung erfasst seit 09/2026 auch Analyse-Berichte, Merge-Konflikte und Kampagnen-Zeilen; bewusst erhalten bleiben nur Sperrlisteneintrag und Admin-Zugriffsprotokoll (nur numerische ID).

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
| OQ-11/F-10 Löschung unvollständig | **Behoben (09/2026):** ein zentraler, vollständiger Löschpfad für Widget-Button, Mail-Link „Daten löschen“ und Admin; Export um Kampagnen-Daten ergänzt |
| **Neu hinzugekommen** | Kundenprofil für alle Kunden inkl. Kampagnen-Kontakte, nächtlich aktualisiert (→ F-20), Kampagnen-Kanal (freigegeben 21.07.), Consent v4 + Chat-Consent-Gate (freigegeben Juli), Gesprächs-/Komplettanalyse, Q&A-Wissen, Klick-Tracking, Umsatz-Attribution, EN-Sprachversion, TTS, Prompt-Caching |

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
- **F-10 — Restlücken Betroffenenrechte/Fristen:** (a) Export ohne Telemetrie-Daten; (b) `marketing_sends` und Merge-Konflikt-Tabelle ohne eigene Frist (werden aber bei Löschung auf Wunsch vollständig entfernt); (c) Auskunft für Stufe 2 weiterhin manuell. Bitte bewerten, was davon nachzurüsten ist.
- **F-21 — Manuelles Aufheben einer Abmeldung (neu 10/2026):** Der Admin kann eine Abmeldung (nur Abmeldelink oder manuell, nie Bounce/Spam-Beschwerde/Löschung) aufheben, z. B. nach einem versehentlichen Klick oder auf ausdrücklichen Wunsch der Person; die Aktion ist bestätigungspflichtig, protokolliert und verschickt keine E-Mail. Bitte bestätigen, dass dies nur bei dokumentiertem Versehen bzw. erneuter Einwilligung zulässig ist. Anlass: Admin-Vorschauen enthielten echte Abmeldelinks (behoben — Vorschau-Links sind jetzt wirkungslos).
- **F-20 — Profilbildung für Newsletter-Kontakte (neu 09/2026; erweitert durch F-23):** Für Shopify-Newsletter-Abonnenten wird ohne Chat-Kontakt ein KI-Profil aus Käufen und Kampagnen-Historie gebildet und zur Personalisierung der Kampagnen-Mails genutzt; ein aktives Shopify-Abo genügt zudem als Personalisierungs-Voraussetzung für eingeloggte Kunden im Chat. Grundlage ist die Shopify-Newsletter-Einwilligung. Bitte prüfen, ob diese Einwilligung und die Datenschutzerklärung Profilbildung aus Kaufhistorie für personalisierte Werbung abdecken (ggf. Ergänzung der Datenschutzerklärung). Jede Person kann über den Link „Daten löschen“ in jeder Mail alles löschen.
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

## 13. Nachtrag 01.10.2026 — Kundenplattform: eine Einwilligung, eine Löschung, alle Shop-Kunden

Grundlage: `docs/CUSTOMER_PLATFORM_PLAN.md` (Entscheidungen D-1 bis D-12). Alle Shopify-Schalter stehen im Code standardmäßig auf **aus**; eingeschaltet werden sie erst nach Ihrer Freigabe.

### 13.1 Was sich geändert hat (Tatsachen)

1. **Kundenstamm (D-6).** Alle Shopify-Kunden werden gespiegelt (Name, E-Mail, Sprache, Land, Tags, Kontostatus, Einwilligungsstatus — **keine** Adressen, **keine** Telefonnummern) und erhalten eine Kundenakte. Zusätzlich wird eine **lokale Kopie aller Bestellungen** geführt (Bestellnummer, Datum, Zahl-/Versandstatus, Beträge, Rabattcodes, Positionen mit Artikel, Menge, Preis — ohne Liefer- und Rechnungsadresse). Daraus werden nächtlich Kennzahlen berechnet: Kaufrhythmus, Lebenszyklus-Segment, Wertstufe, Abwanderungsrisiko, gekaufte Kategorien, erwarteter nächster Kauf. Quelle: einmaliger Import, Shopify-Webhooks, nächtlicher Abgleich. Schalter `SHOPIFY_CUSTOMER_SYNC_ENABLED`. Die Aussage in `ORDER_ATTRIBUTION.md`, nicht markierte Bestellungen würden nie gespeichert, gilt damit **nicht mehr**.
2. **Eine Einwilligung (D-2, D-3, D-4).** Die Newsletter-Einwilligung im Shop und das Double-Opt-in in Mo sind jetzt **ein** Zustand pro Person (angemeldet / Bestätigung offen / abgemeldet / nicht angemeldet; Sperren wie Bounce oder Spam-Beschwerde bleiben getrennt). Jede Änderung wird mit Quelle, Zeitpunkt und — bei Shopify-Einwilligungen — der dort gültigen Textversion (`SHOPIFY_CONSENT_TEXT_VERSION`) protokolliert (Einwilligungsverlauf). Eine Mo-Anmeldung zählt erst nach Klick auf den Bestätigungslink und wird dann an Shopify übertragen; wer in Mo bestätigt hat, aber kein Shopify-Konto besitzt, wird in Shopify als Kunde mit dieser Einwilligung angelegt (bei neuen Anmeldungen automatisch, für den Altbestand erst nach ausdrücklicher Bestätigung im Admin, „Erstabgleich“). Abmeldungen wirken in beide Richtungen (Mo → Shopify über eine Warteschlange, Shopify → Mo per Webhook und nächtlichem Abgleich; die jeweils neuere Erklärung gewinnt). Wer bereits angemeldet ist, bekommt keine zweite Bestätigungsmail. Schalter `SHOPIFY_CONSENT_WRITEBACK`. Die Art.-7-Belege für Mo-Einwilligungen (wörtlicher Text, Version, DOI-Zeitpunkte) bleiben unverändert; für im Shop erteilte Einwilligungen liegen nur Status, Zeitpunkt, Opt-in-Stufe und Textversion vor.
3. **Eine Löschung (D-5).** Eine Löschung in Mo (Widget, Link in jeder Mail, Admin) schaltet die Einwilligung in Shopify sofort ab und beantragt dann die Löschung des Shop-Kundenkontos (`customerRequestDataErasure`, Schalter `SHOPIFY_ERASURE_SYNC`). Umgekehrt löst eine Löschung in Shopify (`customers/redact`, `customers/delete`) dieselbe Löschung in Mo aus; `shop/redact` (Deinstallation der App) führt bewusst keine automatische Massenlöschung aus, sondern erzeugt eine Warnung und eine Aufgabe im Eingang zur manuellen Prüfung. Ein Löschmerker verhindert, dass Import oder Abgleich die Person wieder anlegen. Bestellungen bleiben in Shopify so lange, wie das Gesetz es verlangt; die lokale Bestellkopie in Mo wird mit der Person gelöscht. Eine Datenauskunft aus Shopify (`customers/data_request`) erzeugt eine Aufgabe im Eingang mit 30-Tage-Frist. Der Bestätigungstext der Löschung nennt das Shop-Kundenkonto, sobald der Schalter an ist. Der JSON-Export enthält zusätzlich Einwilligungsverlauf, Bestellkopie, Kennzahlen und Kampagnen.
4. **KI-Profile (D-1).** Zwei Tiefen: *Vollprofil* (aus Gesprächen, Korrespondenz und Käufen) und *Kaufprofil* (nur aus Käufen, günstigeres Modell). Der Umfang wird über `CUSTOMER_AI_PROFILE_SCOPE` gesteuert (`consented` = nur mit Werbe-Einwilligung, Standard im Code; `all` = alle Kunden). **Entscheidung des Mandanten: `all`** — Profile entstehen auch ohne Werbe-Einwilligung, sind in der Oberfläche als „ohne Einwilligung“ gekennzeichnet, und alle Werbeaktionen per E-Mail sind für diese Personen gesperrt. Ein Widerspruch (Art. 21) wird im Admin erfasst, löscht das Profil sofort und verhindert jeden Neuaufbau.
5. **Kampagnen.** Mehrere Kampagnen gleichzeitig (z. B. Black Friday); Zielgruppen werden über alle Kunden definiert, erreichen per E-Mail aber ausschließlich Personen mit Einwilligung, die nicht gesperrt sind. Jede Mail wird weiterhin einzeln von einem Menschen geprüft und versendet. Die 1:1-Mail ist die Kampagne „Einzelansprache“.
6. **Eingang (neu).** Feste, nachvollziehbare Regeln markieren täglich, welcher Kunde Aufmerksamkeit braucht (offene Antwort, Kaufabsicht ohne Kauf, Wiederkauf fällig, Abwanderungsgefahr, Unzufriedenheit, Zustellproblem, Datenauskunft …). Für die wichtigsten Einträge schlägt ein KI-Modell (Anthropic) den nächsten Schritt vor — auf Basis von Kennzahlen, Profil und Anlass. Der Vorschlag wird vor dem Speichern gegen Einwilligung und Widersprüche geprüft (z. B. nie eine Werbe-Mail ohne Einwilligung, nie ein Brief nach Widerspruch); **nichts wird automatisch versendet**. Nach 14 Tagen wird festgehalten, ob die Person gekauft oder geantwortet hat (Wirkungsmessung).
7. **Briefwerbung (D-7).** Werbebriefe sind der einzige Kanal für Bestandskunden **ohne** E-Mail-Einwilligung. Pro Kunde kann ein Widerspruch gegen Briefwerbung erfasst werden (`postal_objection_at`); er sperrt jeden weiteren Brief serverseitig. **Jeder Brief trägt in der Fußzeile, abgesetzt von den übrigen Angaben, den Hinweis:** „Widerspruch gegen Werbung per Post jederzeit möglich (Art. 21 DSGVO): info@motionsports.de oder an die Anschrift unten.“ sowie den Link zur Datenschutzerklärung. Adressquelle unverändert nur die Lieferadresse einer abgeschlossenen Bestellung; Versand weiterhin hinter `PHYSICAL_MAIL_SENDS_APPROVED`.
8. **Weitere Auswertungen (intern).** „Frag Mo“: Das Team kann eine Frage zu einer Person stellen; ein KI-Modell (Anthropic) beantwortet sie nur aus deren Akte und nennt die Belege (protokolliert im Admin-Zugriffslog). „Ähnliche Kunden“: regelbasiert (gleiche Wertstufe, gemeinsame Kaufkategorien), ohne KI. „Mo-Effekt“: aggregierte Kennzahl (Mo-Kontakte gegenüber vergleichbaren Kunden ohne Chat). „Chat-Start“: Öffnet ein Kampagnen-Link den Chat, wird nur gezählt, dass zu dieser Mail ein Chat begann — das (pseudonyme) Gespräch selbst wird nicht mit der Person verknüpft.
9. **Merkmale als Shopify-Tags (D-11, Schalter `SHOPIFY_WRITEBACK_ENABLED`, standardmäßig aus).** Ist er an, schreibt Mo nachts abgeleitete Merkmale als Tags an den Shopify-Kunden: Lebenszyklus-Segment, Wertstufe, „hat mit Mo gesprochen“, hohes Abwanderungsrisiko (`mo-…`). Sie sind dann in Shopify (Segmente, Flow, Shopify Email) nutzbar.
10. **Speicherfristen.** Shopify-Kunden sind von der Löschung wegen Inaktivität ausgenommen (die Kundenbeziehung besteht im Shop fort; ihre Mo-Daten werden mit der Person gelöscht). Neu: Synchronisations-Protokolle 90 Tage (`SHOPIFY_SYNC_LOG_RETENTION_DAYS`); entschiedene Eingang-Einträge werden nach 180 Tagen (`INBOX_RETENTION_DAYS`) auf einen Merker ohne Inhalt reduziert und nach zwei Jahren gelöscht; Löschmerker 30 Tage nach Bestätigung durch Shopify (`ERASURE_TOMBSTONE_RETENTION_DAYS`); eine nicht bestätigte Anmeldung verfällt nach Ablauf des Bestätigungslinks.

### 13.2 Neue Prüfbitten

- **F-22 — Kundenspiegel, Bestellkopie, Kennzahlen für alle (D-6):** Bitte Rechtsgrundlage bestätigen (Einschätzung: Art. 6 (1) b/f, Verwaltung der eigenen Kundenbeziehung), Speicherdauer (an die Kundenbeziehung gekoppelt, Löschung mit der Person) und die nötige Ergänzung der Datenschutzerklärung. **Blockiert das Einschalten von `SHOPIFY_CUSTOMER_SYNC_ENABLED`.**
- **F-23 — KI-Profile ohne Werbe-Einwilligung (D-1, erweitert F-20):** Der Mandant möchte `CUSTOMER_AI_PROFILE_SCOPE=all`. Bitte Interessenabwägung nach Art. 6 (1) f für Profiling (Art. 4 Nr. 4) bestätigen, Transparenz in der Datenschutzerklärung, das Widerspruchsverfahren (Art. 21; im Admin umgesetzt) und die DSFA-Frage (F-04). Einschätzung: keine automatisierte Entscheidung im Sinne von Art. 22 — jede Aktion ist menschlich.
- **F-24 — Anlage von Shop-Kunden für Mo-Abonnenten (D-3):** Bitte bestätigen, dass eine in Mo per Double-Opt-in erteilte Einwilligung an Shopify übertragen und dafür ein Shop-Kundendatensatz angelegt werden darf (eine gemeinsame Abonnentenliste).
- **F-25 — Eine Einwilligung, Opt-in-Stufe (D-4, ergänzt F-06):** Einwilligungen aus dem Shop ohne nachweisbares Double-Opt-in (`SINGLE_OPT_IN`/`UNKNOWN`) gelten jetzt für **jede** Werbe-Mail, gesteuert über den einen Schalter `CAMPAIGN_ALLOW_SINGLE_OPT_IN`. Empfehlung der Entwicklung: in Shopify die Double-Opt-in-Einstellung aktivieren. Bitte auch die Nachweisqualität für im Shop erteilte Einwilligungen (keine Textkopie, nur Textversion) bewerten.
- **F-26 — Wechselseitige Löschung (D-5):** Bitte den neuen Wortlaut der Löschbestätigung (Seite, Widget, Admin; „…und dein Kundenkonto im Shop … Deine Bestellungen bleiben im Shop so lange gespeichert, wie das Gesetz es verlangt“) freigeben, ebenso das Vorgehen bei `customers/data_request` (Aufgabe im Eingang, 30 Tage). **Blockiert das Einschalten von `SHOPIFY_ERASURE_SYNC`.**
- **F-27 — Briefwerbung an Bestandskunden ohne E-Mail-Einwilligung (D-7):** Einschätzung der Entwicklung: zulässig auf Grundlage von Art. 6 (1) f i. V. m. Erwägungsgrund 47 (Direktwerbung als berechtigtes Interesse), wettbewerbsrechtlich § 7 Abs. 1 UWG (Briefwerbung ohne Einwilligung zulässig, solange die Person nicht erkennbar widersprochen hat). Voraussetzungen: Hinweis in der Datenschutzerklärung, Widerspruchshinweis in jedem Brief (Art. 21 (4) — Wortlaut oben, bitte prüfen), sofortige Beachtung jedes Widerspruchs (umgesetzt). Bitte bestätigen und angeben, ob ein Abgleich mit der Robinsonliste für Bestandskunden erforderlich ist.
- **F-28 — Datenschutzerklärung (ergänzt F-05):** Ergänzungen für Kundenspiegel und Bestellkopie, Kennzahlen und Segmente, KI-Profile (Umfang nach F-23), die gemeinsame Einwilligung und Löschung mit Shopify, Briefwerbung mit Widerspruchsrecht, KI-Vorschläge im Eingang, neue Speicherfristen — und, falls eingeschaltet, die Übertragung abgeleiteter Merkmale als Tags an Shopify (D-11; bitte vor dem Einschalten bestätigen).
- **F-29 — Einwilligungstext im Shop:** Der Text der Newsletter-Checkbox im Shop (Checkout, Konto, Footer) und der Mo-Text sollten inhaltlich übereinstimmen (gleicher Zweck: personalisierte Angebote per E-Mail, Auswertung von Käufen und Gesprächen). Bitte einen gemeinsamen Wortlaut vorgeben; dessen Version wird als `SHOPIFY_CONSENT_TEXT_VERSION` mitprotokolliert.

---

## 14. Nachtrag 02.10.2026 — E-Mails im Eingang

### 14.1 Was sich geändert hat (Tatsachen)

1. **Jede eingehende Mail wird zur Aufgabe.** Schreibt eine bekannte Person an Mo (Antwort auf eine Mail, neue Mail an die Empfangsadresse), öffnet sich sofort im Eingang die Aufgabe „E-Mail beantworten“. Weitere Mails derselben Person hängen sich an; eine Antwort des Teams schließt die Aufgabe. Das betrifft Korrespondenz, die schon bisher gespeichert wurde (D-09); neu ist nur die Aufgabe.
2. **KI-Zusammenfassung und Antwortentwurf.** Für die Aufgabe schreibt ein KI-Modell (Anthropic) eine kurze Zusammenfassung und einen Antwortentwurf. Eingabe: siehe § 7.1. Der Entwurf ist eine Service-Antwort — der Prompt verbietet Werbung, Produktempfehlungen ohne Nachfrage, Rabatte und erfundene Zusagen; fehlende Angaben bleiben als Platzhalter stehen. **Nichts wird automatisch versendet**: ein Mensch prüft, ändert und sendet. Weil es keine Werbung ist, hängt die Antwort nicht an der Werbe-Einwilligung (wie bisher die Korrespondenz, R-08).
3. **Kontaktformular in der Kundenakte.** Eine Anfrage über das Kontaktformular des Shops wird zusätzlich zur Team-Mail als eingehende Mail gespeichert (Name, E-Mail, Telefon, Organisation, Anliegen, Produkte, Nachricht). Ist die Absenderadresse unbekannt, wird eine Kundenakte als **Interessent ohne Einwilligung** angelegt. Dasselbe kann das Team für eine nicht zugeordnete Mail mit „Als Interessent anlegen“ tun. Speicherdauer: Mail 365 Tage (D-09); die Akte wird wie jede Akte ohne Shop-Konto bei Inaktivität gelöscht.

### 14.2 Neue Prüfbitte

- **F-30 — Kontaktanfragen und eingehende Mails in Mo:** Bitte bestätigen, dass die Speicherung der Kontaktanfrage in der Kundenakte (einschließlich Anlage eines Interessenten ohne Einwilligung) und die KI-gestützte Zusammenfassung mit Antwortentwurf auf Art. 6 (1) b (Anfrage/Vertragsanbahnung) bzw. f (effiziente Bearbeitung) gestützt werden können, und welche Ergänzung der Datenschutzerklärung (Kontaktformular, KI-Unterstützung bei der Beantwortung, Anthropic als Auftragsverarbeiter) nötig ist. Einschätzung der Entwicklung: keine automatisierte Entscheidung im Sinne von Art. 22 — jede Antwort sendet ein Mensch.

---

## 15. Nachtrag 03.10.2026 — Schwachstelle in der Anmelde-Zuordnung (behoben)

### 15.1 Tatsachen

- **Was möglich war.** Eine Chat-Sitzung, in der jemand lediglich die E-Mail-Adresse einer anderen Person **eingetippt** hatte (Formular „Zusammenfassung per E-Mail“ / Newsletter-Anmeldung im Chat, ohne Nachweis, dass ihm das Postfach gehört), wurde als **angemeldete** Sitzung dieser Person behandelt.
  - Voraussetzung: Die Person hatte sich irgendwann über „Anmelden“ (Shopify-Kundenkonto) im Chat angemeldet und sich nicht abgemeldet, ihr Anmelde-Token war also noch gültig.
  - Dann standen der fremden Sitzung die Kontofunktionen offen: Gesprächsliste und -inhalte, **Datenexport (JSON)**, **Selbst-Löschung**, außerdem das Chat-Gedächtnis.
  - Ursache: Die Prüfung fragte nur, ob die verknüpfte Kundenakte ein Shopify-Konto und ein gültiges Token hat, nicht, ob **diese** Sitzung angemeldet wurde. Seit dem Kundenspiegel (§ 13) haben alle Shop-Kunden eine Shopify-Kennung.
- **Behebung (03.10.2026).** Jede Sitzungsverknüpfung speichert jetzt ihren Nachweis (Migration 0071): eingetippte E-Mail, Anmeldung über das Kundenkonto oder über den Shop (App Proxy). Nur eine Anmeldung **in derselben Sitzung** zählt. Bestehende Anmeldungen wurden ungültig; die Betroffenen melden sich einmal neu an.
- **Prüfung auf Ausnutzung (Produktivdatenbank, 03.10.2026).** Ausgewertet wurden die pseudonymen KPI-Ereignisse zu Anmeldung, Export und Löschung, die Anmelde-Token und die Sitzungsverknüpfungen.
  - Seit Einführung der Anmeldung im Chat gab es **22 Anmeldungen** (31.07.–03.10.2026); **21 Kundenkonten** haben ein Anmelde-Token. Das ist der Kreis möglicher Betroffener.
  - Für die Lücke nötig war eine Chat-Sitzung, die über eine **eingetippte** E-Mail-Adresse mit einer Person verknüpft wurde, **nachdem** sich diese Person angemeldet hatte. **Eine solche Sitzung gibt es nicht** — weder bei den 21 Personen mit Token noch bei allen anderen, die sich je angemeldet haben (auch bei denen, die sich inzwischen abgemeldet haben). Die Lücke war im Betrieb damit **nie ausnutzbar**; folglich konnte auch kein lesender Zugriff (Gesprächsliste, Chat-Gedächtnis — beides wird nicht protokolliert) über sie stattfinden.
  - Datenexporte: **keiner** seit Einführung der Funktion. Selbst-Löschungen: **eine** (04.09.2026, als zwei Ereignisse im Abstand von 91 ms erfasst) — ein Test des Mandanten mit seinem eigenen Konto.
  - Verknüpfungen werden nicht durch Fristen gelöscht, nur durch die vollständige Löschung einer Person; gelöscht wurde nur das Testkonto.

### 15.2 Prüfbitte

- **F-31 — Meldepflicht (Art. 33/34 DSGVO):** Bitte bewerten Sie anhand des Prüfergebnisses, ob eine Verletzung des Schutzes personenbezogener Daten vorliegt, die der Aufsichtsbehörde binnen 72 Stunden zu melden bzw. den Betroffenen mitzuteilen ist, und wie der Vorgang zu dokumentieren ist (Art. 33 (5)).

### 15.3 Zweite Schwachstelle derselben Art (behoben am selben Tag)

- **Was möglich war.** Bei der Prüfung des Bestellstatus im Chat (§ 16) fiel eine zweite Lücke in der Anmelde-Zuordnung auf. Die Anmeldung über „Anmelden“ im Chat übernahm die Kennung der Chat-Sitzung **aus dem Link**, mit dem die Anmeldung startete. Diese Kennung kann jeder in einen Link schreiben.
  - Ablauf eines Angriffs: Jemand schickt einer im Shop angemeldeten Kundin einen vorbereiteten Link mit **seiner eigenen** Sitzungskennung. Öffnet sie ihn, meldet Shopify sie ohne sichtbaren Schritt an („stille Anmeldung“), und die Anmeldung wird der Sitzung des Angreifers zugeordnet.
  - Folge: Der Angreifer hätte in seiner Chat-Sitzung die Kontofunktionen der Kundin gehabt: Gesprächsliste und -inhalte, Datenexport, Selbst-Löschung, Chat-Gedächtnis.
  - Dasselbe galt für die Erkennung über den Shop (App Proxy). Diese ist im Shop aber nicht eingerichtet (Stand 02.10.2026).
- **Behebung (03.10.2026, Migration 0073).**
  - Eine Anmeldung erzeugt nur noch einen **Einmal-Code**. Er ist 10 Minuten gültig, nur einmal verwendbar und als Prüfsumme gespeichert. Er gelangt nur in den Browser, in dem die Anmeldung stattfand.
  - Erst wenn das Chat-Fenster **dieses Browsers** den Code mit seiner eigenen Sitzungskennung einlöst, wird die Sitzung als angemeldet verknüpft, und nur, wenn es dieselbe Sitzung ist, für die die Anmeldung gestartet wurde.
  - Bestehende Anmeldungen wurden ungültig.
  - Abmelden beendet jetzt alle Chat-Anmeldungen der Person, nicht nur die Tokens. Vorher blieb auf einem gemeinsam genutzten Rechner eine abgemeldete Sitzung verknüpft und wurde mit der nächsten Anmeldung der Person auf einem anderen Gerät wieder gültig.
- **Folge für den Betrieb.** „Anmelden“ im Chat wirkt erst wieder, wenn das Chat-Fenster (Frontend) den Code einlöst. Bis dahin bleiben Anmelde-Funktionen aus. Es wird nichts falsch zugeordnet.
- **Prüfung auf Ausnutzung (Produktivdatenbank, 03.10.2026).**
  - **Alle 22 Anmeldungen waren sichtbare Anmeldungen**, keine einzige „stille“. Die verdeckte Form des Angriffs (präparierter Link, stille Anmeldung) hat damit **nie stattgefunden**.
  - Die sichtbare Form hätte vorausgesetzt, dass eine Kundin einen fremden Link öffnet und sich dort selbst bei Shopify anmeldet. Auf keine Anmeldung folgte ein Export; die einzige Löschung war der Test des Mandanten (15.1).
  - Nicht protokolliert werden das Abrufen der Gesprächsliste und das Chat-Gedächtnis. Ein lesender Zugriff über eine solche sichtbare Anmeldung lässt sich deshalb nicht vollständig ausschließen; Hinweise darauf gibt es keine.

### 15.4 Prüfbitte

- **F-34 — Meldepflicht für die zweite Lücke (Art. 33/34 DSGVO):** Bitte bewerten Sie diese Lücke wie F-31. Hier war für eine Ausnutzung eine gezielte Täuschung nötig: Die Betroffene musste einen präparierten Link öffnen und im Shop angemeldet sein. Bitte bewerten Sie auch, ob beide Vorgänge gemeinsam zu dokumentieren sind (Art. 33 (5)).

---

## 16. Nachtrag 03.10.2026 — Bestellstatus im Chat

### 16.1 Tatsachen

- **Was neu ist.** Ein Kunde kann Mo nach dem Stand seiner eigenen Bestellungen fragen („Wo ist meine Bestellung?“, „Wann kommt mein Paket?“, „Ist meine Erstattung durch?“). Mo antwortet aus echten Daten statt nur auf das Kontaktformular zu verweisen. Mo **handelt nicht**: Rücksendungen, Stornierungen und Reklamationen laufen weiterhin über das Kontaktformular an das Team.
- **Wer.** Nur Kunden, die sich **in derselben Chat-Sitzung** über „Anmelden“ mit ihrem Shop-Kundenkonto angemeldet haben (Customer-Account-Anmeldung) und deren Anmeldung noch gültig ist (gültiges Anmelde-Token, sonst „bitte anmelden“). Eine eingetippte E-Mail-Adresse, eine Bestellnummer, ein Name oder die Erkennung über den Shop (App Proxy) genügen **nicht**; Mo fragt auch nicht danach. Dass die Anmeldung wirklich zu dieser Chat-Sitzung gehört, sichert seit der Behebung in § 15.3 der Einmal-Code: Eine fremde Sitzung kann sich die Anmeldung einer anderen Person nicht mehr zuordnen lassen. Eine Werbe-Einwilligung ist nicht erforderlich.
- **Woher.**
  - Aus Mos Bestellkopie (§ 13.1 Nr. 1). Gelesen werden nur Bestellungen, die Shopify genau diesem Shop-Kundenkonto zuordnet.
  - Für höchstens drei nicht stornierte Bestellungen zusätzlich aus einer kurzen Live-Abfrage bei Shopify: Versandfortschritt, Name des Versanddienstleisters, Zustelltage. Höchstens 4 Sekunden, sonst ohne.
  - Gehört eine Bestellung laut Shopify nicht (mehr) dieser Person, wird sie **gar nicht** genannt.
  - „Keine Bestellung gefunden“ sagt Mo nur, wenn eine Live-Abfrage der neuesten Bestellungen bestätigt, dass Mos Kopie vollständig ist. Sonst heißt es „gerade nicht abrufbar“, mit Verweis auf „Meine Bestellungen“.
- **Was das KI-Modell (Anthropic) erhält.** Je Bestellung: Kennbuchstabe (A, B, …), Bestelldatum, bis zu sechs Artikel (Titel, Variante, Menge), Versandstatus, Zahlungsstatus (bezahlt / offen / teilweise oder ganz erstattet / storniert), gegebenenfalls Name des Versanddienstleisters und angekündigter bzw. erfolgter Zustelltag, dazu ein allgemeiner Link auf „Meine Bestellungen“ im Shop. Höchstens fünf Bestellungen, bei genannter Bestellnummer nur die passende.
- **Was das KI-Modell nie erhält** (feste Feldliste, automatischer Test): Bestellnummer, Beträge und Währung, Rabattcodes, Sendungsnummer und Sendungslink, Liefer- und Rechnungsadresse, E-Mail-Adresse, interne Shopify-Kennungen. Die Bestellnummer wird nur verwendet, um eine vom Kunden genannte Nummer **unter seinen eigenen Bestellungen** wiederzufinden.
- **Verhaltensregeln für Mo.** Nur Fakten aus der Abfrage nennen, keine Liefertermine schätzen, **keine Rückgabe- oder Widerrufsfristen berechnen** (offen wegen F-11), keine Beträge; bei Zustellproblemen, angehaltenen Bestellungen und jedem Änderungswunsch das Kontaktformular anbieten.
- **Wiederholung im Verlauf.** Das Widget sendet den Gesprächsverlauf bei jeder Nachricht mit. Ein älteres Abfrageergebnis wird dabei vor dem KI-Aufruf durch „veraltet“ ersetzt; Mo fragt bei Bedarf neu ab. Im Browser des Kunden (lokal gespeicherter Verlauf) steht das Ergebnis weiterhin; dem Widget-Team wird empfohlen, den gespeicherten Verlauf beim Abmelden zu löschen (geteilte Geräte).
- **Speicherung.** Mos Antworttext, also der genannte Bestellstatus, wird wie jedes Transkript gespeichert (D-01, **180 Tage**).
  - Er fließt wie jedes Transkript in die Gesprächsanalyse und gegebenenfalls in die Zusammenfassungs-Mail ein.
  - Er fließt auch in das nächtliche **KI-Kundenprofil** ein (§ 13, Profilbildung mit Widerspruchsrecht), das auch Werbe-Mails personalisiert. Hier stellt sich die Frage der Zweckbindung, siehe F-32 (e). Das Abfrageergebnis selbst wird nicht gespeichert; gezählt wird nur ein pseudonymes Ereignis (Ergebnis, Thema, Anzahl — ohne Bestellnummer oder Beträge, D-03).
- **Schalter.** `CHAT_ORDER_STATUS_ENABLED`, im Code standardmäßig **aus**; ausgeschaltet ist Mos Verhalten unverändert (Bestellfragen → Kontaktformular). Eingeschaltet wird er erst nach Ihrer Antwort auf F-32.

### 16.2 Prüfbitte

- **F-32 — Bestellstatus im Chat:** Bitte bestätigen Sie (a) die Rechtsgrundlage Art. 6 (1) b (Auskunft an den angemeldeten Kunden zu seinem eigenen Vertrag; hilfsweise f) für die Abfrage und die Übermittlung der genannten Angaben an Anthropic als Auftragsverarbeiter; (b) den nötigen Zusatz in der Datenschutzerklärung (KI-Chat beantwortet Fragen zu eigenen Bestellungen angemeldeter Kunden; Datenkategorien wie oben; keine Bestellnummern, Beträge, Adressen); (c) dass Transkripte mit Bestellstatus unter die bestehende Frist von 180 Tagen (D-01) fallen dürfen oder eine kürzere Frist nötig ist; (d) im Zusammenhang mit F-11, dass Mo Rückgabe- und Widerrufsfristen bewusst nicht berechnet und für Retouren auf das Kontaktformular verweist — oder ob und wie Mo Fristen nennen darf; (e) ob Gesprächsteile mit Bestellstatus (Kundendienst, Art. 6 (1) b) in das KI-Kundenprofil für Werbezwecke einfließen dürfen (Zweckbindung, Art. 5 (1) b / Art. 6 (4)) oder dafür ausgeblendet werden müssen.

---

## 17. Nachtrag 03.10.2026 — „Einplanen“: geprüfte Kampagnen-Mails später versenden

### 17.1 Tatsachen

- **Was neu ist.** Eine Kampagnen-Mail kann nach der Prüfung am Pult **eingeplant** statt sofort gesendet werden („jetzt freigeben, später senden“, z. B. „morgen 09:00“).
- **Prüfung bleibt einzeln und menschlich.** Jede Mail wird weiterhin von einem Menschen einzeln geprüft und einzeln freigegeben. Ein Sammel-Freigeben gibt es nicht.
- **Versand durch einen Job.** Ein Versand-Job verschickt die fälligen Mails alle 10 Minuten nacheinander.
- **Alle Prüfungen laufen beim Versand erneut**, im selben und einzigen Versandweg: Einwilligung, Opt-in-Stufe, Sperrliste, Versandabstand, Freigabeschalter.
- **Zurück zur Prüfung statt Versand.** Eine Mail kommt mit dem Grund zurück in die Prüfung, wenn sich nach der Freigabe der Text oder die Kampagnen-Gestaltung geändert hat, ein Set-Angebot abgelaufen ist oder eine Prüfung ablehnt. Nichts wird automatisch wiederholt.
- **Schalter** `CAMPAIGN_RELEASE_ENABLED`, standardmäßig aus.
- **Formulierungen in diesem Dossier:** „einzeln versendet“ (§ 2.2 Kampagne, § 6, § 13.1 Nr. 5) ist ab Einschalten so zu lesen: einzeln geprüft und einzeln freigegeben, zeitversetzt versendet.

### 17.2 Prüfbitte

- **F-33 — Zeitversetzter Versand freigegebener Werbe-Mails:** Bitte bestätigen Sie, dass die Freigabe einer einzeln geprüften Mail mit späterem, automatischem Versand der bisherigen Freigabe (Kampagnen-Kanal, 21.07.2026) entspricht. Beim Versand werden Einwilligung und Widerspruch erneut geprüft.

---

## 18. Nachtrag 03.10.2026 — Werbebriefe als Kampagnen-Kanal

### 18.1 Tatsachen

- **Was neu ist.** Eine Kampagne kann ihre Zielgruppe zusätzlich per **Werbebrief** erreichen. Druck und Versand laufen über Pingen, auf demselben Weg wie die Einzelbriefe aus der Kundenakte (§ 6.4). Je Kampagne wählt das Team „Keine Briefe“ (Standard), „An alle ohne E-Mail-Einwilligung“ oder „An alle (auch mit Einwilligung)“, dazu optional ein Porto-Budget.
- **Wer einen Brief bekommt.**
  - Personen aus der Zielgruppe der Kampagne mit mindestens einer Bestellung, ohne Widerspruch gegen Briefwerbung und ohne Sperre (Bounce, Spam-Beschwerde, Löschung). Die reinen E-Mail-Filter der Zielgruppe (Opt-in-Stufe, „keine Werbe-Mail in den letzten n Tagen“) gelten für Briefe nicht.
  - Modus „ohne E-Mail-Einwilligung“: nur Personen **ohne** E-Mail-Werbeeinwilligung. Wer sie hat, bekommt die E-Mail, nicht den Brief. Wer sie nach der Auswahl erteilt, bekommt keinen Brief mehr.
  - Modus „auch mit Einwilligung“: auch Personen mit Einwilligung. Sie können dann E-Mail und Brief derselben Kampagne erhalten.
  - Je Kampagne höchstens ein Brief pro Person; auch eine laufende Kampagne schreibt eine Person nur einmal an.
  - Eine Abmeldung von E-Mail-Werbung gilt nicht als Widerspruch gegen Briefwerbung: Wer abgemeldet ist, erhält im Modus „ohne E-Mail-Einwilligung“ einen Brief, solange kein Widerspruch gegen Briefwerbung erfasst ist (→ F-35 (i)).
- **Adresse.**
  - Einzige Quelle ist die **Lieferadresse der letzten abgeschlossenen Bestellung** (bezahlt oder teilweise erstattet, nicht storniert). Sie wird nur für Personen abgerufen, die einen Brief bekommen sollen, einzeln aus Shopify, und mit Herkunft und Bestellbezug in der Kundenakte gespeichert. Gibt es eine neuere abgeschlossene Bestellung, wird sie neu abgerufen (Umzug).
  - Abruf per Klick im Prüftisch oder nachts (standardmäßig bis 200 Personen je Nacht). Solange der Briefkanal (`PHYSICAL_MAIL_SENDS_APPROVED`) aus ist, wird nichts abgerufen.
  - Andere gespeicherte Adressen, etwa die im Shop-Kundenkonto hinterlegte (`consented_capture`), bleiben gespeichert, werden aber für keinen Werbebrief verwendet. **Das gilt jetzt auch für Einzelbriefe aus der Kundenakte**; vorher genügte dort jede vollständige gespeicherte Adresse.
  - Weicht der Name der Lieferadresse vom Namen der Kundin ab (Geschenkbestellung), zeigt der Prüftisch nur einen Hinweis; der Brief wird nicht gesperrt (→ F-35 (b)).
  - Meldet Pingen einen Brief als unzustellbar, geht an diese Adresse kein Brief mehr (Kampagne und Einzelbrief), bis eine neuere Bestellung eine andere Adresse liefert.
- **Text.**
  - Ein KI-Modell (Anthropic) schreibt je Brief einen deutschen Entwurf in der Du-Form.
  - Eingabe: Vorname der Person; Name, Art, Briefing und Enddatum der Kampagne; ggf. eine Notiz des Teams; Kaufhistorie (je Bestellung Datum, Artikel und Menge — derselbe Baustein wie bei den Kampagnen-Mails; **ohne** Bestellnummer und Beträge); Lebenszyklus-Segment; bis zu drei Produktnamen; das KI-Kundenprofil (nicht nach Widerspruch gegen Profilbildung).
  - **Nicht** übermittelt: Adresse, E-Mail-Adresse, Beträge.
  - Der Brief enthält keine Links, keinen Rabattcode, keine Prozentangaben und keine erfundene Dringlichkeit.
  - Englischsprachige Kund:innen erhalten den deutschen Brief (→ F-35 (f)).
- **Fußzeile.** Jede Seite trägt fest, außerhalb des editierbaren Textes, den Widerspruchshinweis aus § 13.1 Nr. 7, den Absender und den Link zur Datenschutzerklärung.
- **Prüfung und Freigabe.** Jeder Brief wird im Prüftisch von einem Menschen gelesen, bei Bedarf geändert und **einzeln freigegeben**. Eine Sammel-Freigabe gibt es nicht. Jede Freigabe und jeder Versandschritt steht im Admin-Zugriffsprotokoll.
- **Versand.**
  - Erst ein weiterer Klick („Freigegebene senden“) verschickt die freigegebenen Briefe, in Schritten zu fünf.
  - Vor jedem einzelnen Brief wird erneut geprüft: Briefkanal freigeschaltet, Pingen eingerichtet, Kampagne läuft, kein Widerspruch, im Modus „ohne E-Mail-Einwilligung“ keine inzwischen erteilte Einwilligung, Adresse vollständig, aus einer abgeschlossenen Bestellung und nicht unzustellbar, Text vorhanden, **mindestens 60 Tage** seit dem letzten Werbebrief an die Person (jeder Brief zählt, auch ein Einzelbrief; einstellbar über `LETTER_MIN_INTERVAL_DAYS`), Porto-Budget der Kampagne.
  - Ein Widerspruch oder eine neue Einwilligung nimmt den Brief endgültig aus der Kampagne; jede andere Ablehnung schickt ihn mit Grund zurück in die Prüfung.
  - **Nichts wird automatisch versendet.**
- **Speicherung.**
  - Der Kampagnen-Brief (Betreff, Text, Status, Verknüpfung zum gedruckten Brief; keine Adresse) wird mit den Kampagnen-Daten nach **365 Tagen** gelöscht (`CAMPAIGN_CONTACT_RETENTION_DAYS`), bei vollständiger Löschung der Person sofort.
  - Der gedruckte Brief (D-10) bleibt unverändert 365 Tage.
  - Ein Widerspruch gegen Briefwerbung löscht die gespeicherte Adresse nicht, er sperrt jeden weiteren Brief (→ F-35 (h)).
- **Schalter.** Unverändert. Der Kanal läuft nur, wenn `PHYSICAL_MAIL_SENDS_APPROVED` an ist **und** eine Kampagne einen Brief-Modus hat (Standard „Keine Briefe“). Jeder Brief wird von einem Menschen einzeln freigegeben; es wird nichts automatisch versendet.
- **Entscheidungen der Entwicklung (Standardwerte, zur Bestätigung):** Freigabe je Brief; Brief-Modus standardmäßig aus; Abstand 60 Tage; Adressen aus dem Shop-Kundenkonto bleiben gespeichert, aber ungenutzt; keine Adresslöschung beim Widerspruch; nur deutsche Briefe; kein Rabattcode auf Papier (erste Ausbaustufe); laufende Kampagnen schreiben eine Person einmal an.

### 18.2 Prüfbitte

- **F-35 — Werbebriefe aus Kampagnen:** Bitte bestätigen bzw. beraten Sie:
  - (a) Die Rechtsgrundlage Art. 6 (1) f i. V. m. § 7 UWG für Werbebriefe in größerer Zahl an Bestandskunden **ohne** E-Mail-Einwilligung. Ebenso den Modus „auch mit Einwilligung“, in dem Personen mit Einwilligung zusätzlich zur E-Mail einen Brief erhalten (zwei Kanäle).
  - (b) Den Abruf der Lieferadresse der letzten abgeschlossenen Bestellung aus Shopify für diesen Zweck (Zweckbindung der Bestelldaten, Art. 6 (4)). Geschenkbestellungen (Name der Lieferadresse ≠ Kundin) erzeugen derzeit nur einen Hinweis — sollen solche Briefe gesperrt werden?
  - (c) Die KI-Entwürfe nutzen KI-Kundenprofil und Kaufhistorie für einen Papierbrief (ein Widerspruch gegen Profilbildung wird beachtet). Braucht die Datenschutzerklärung einen Satz zu Briefwerbung und Pingen?
  - (d) Ist ein Abgleich mit der Robinsonliste bzw. der DDV-Briefsperrliste nötig? Nicht umgesetzt.
  - (e) Ist ein Abstand von 60 Tagen zwischen zwei Werbebriefen an dieselbe Person angemessen?
  - (f) Englischsprachige Kund:innen erhalten einen deutschen Brief, auch der Widerspruchshinweis ist nur deutsch. Ist das in Ordnung?
  - (g) Adressen mit Herkunft `consented_capture` (hinterlegte Adresse aus dem Shop-Kundenkonto): löschen oder behalten? Derzeit behalten und für Briefe nicht verwendet.
  - (h) Nach einem Widerspruch bleibt die Adresse gespeichert. Wird sie für die Sperre gebraucht, oder ist sie zu löschen?
  - (i) Wer sich von E-Mail-Werbung abgemeldet hat (`unsubscribed`), erhält im Modus „ohne E-Mail-Einwilligung“ weiter Briefe, solange kein Widerspruch gegen Briefwerbung vorliegt. Ist eine E-Mail-Abmeldung auch als Widerspruch gegen Briefwerbung zu behandeln?

---

## 19. Nachtrag 05.10.2026 — Erkennung der Shop-Anmeldung im Chat (App Proxy)

Grundlage: `docs/CUSTOMER_ACCOUNT.md` § 2 („Already-signed-in detection“), `docs/archive/plans-2026-10-04/P0.3.md`. § 15.3 bleibt als Chronik unverändert; sein Stand „nicht eingerichtet (02.10.2026)“ wird hier fortgeschrieben.

### 19.1 Tatsachen

- **Was neu ist (stille Erkennung).** Öffnet eine im Shop angemeldete Person den Chat, fragt das Chat-Fenster einmal je Tab über einen Pfad des Shops (Shopify App Proxy, `/apps/chat/whoami`), ob jemand angemeldet ist — ohne Klick im Chat. Shopify leitet die Anfrage mit der Kundennummer der laufenden Shop-Anmeldung und einer Signatur an Mo weiter. Es zählt nur diese von Shopify signierte Kennung, nie ein Wert aus dem Browser.
- **Verknüpfung und frühere Gespräche.** Darf die Sitzung angemeldet werden (siehe Schalter), erhält der Browser einen Einmal-Code, den sein Chat-Fenster einlöst (Verfahren wie § 15.3). Danach ist die Chat-Sitzung mit dem Kundenkonto verknüpft, und die **früheren anonymen Gespräche dieses Browsers** (derselben Chat-Sitzung) werden dem Kundenkonto zugeordnet: Sie erscheinen in Gesprächsliste und Export.
- **Keine Übernahme fremder Gespräche.** Zugeordnet werden nur Gespräche, die noch keiner Person oder bereits derselben Person gehören. Gespräche einer anderen Person wandern auf einem geteilten Browser nie in ein fremdes Konto. Das gilt seit demselben Tag auch für „Anmelden“ im Chat.
- **Personenwechsel im selben Browser.** Ist die Chat-Sitzung als eine **andere** Shop-Person angemeldet, endet diese Anmeldung (nur in dieser Sitzung; die anderen Geräte der vorigen Person bleiben angemeldet), und es wird kein Code ausgegeben. Das Chat-Fenster löscht daraufhin seinen lokalen Verlauf und beginnt eine neue Sitzung; der nächste Tab meldet die neue Person an. Die Daten der vorigen Person bleiben bei ihr.
- **Frische der Signatur.** Shopifys signierter Zeitstempel darf höchstens 5 Minuten abweichen. Ein mitgeschnittener oder weitergegebener Link wirkt danach nicht mehr. Fehlerhafte und veraltete Signaturen werden gedrosselt gemeldet (ohne URL und ohne Kundendaten) und beenden oder erzeugen nie eine Anmeldung. Restrisiko: eine Wiederverwendung innerhalb von 5 Minuten durch jemanden mit Zugriff auf die Server-Protokolle.
- **Abmelden.** Eine Abmeldung im Shop beendet die Shop-Anmeldung der Sitzung, sobald der Chat in einem neuen Tab geöffnet wird; ein bereits offener Tab bemerkt sie nicht — gilt die Anmeldung dort allein über den Shop-Nachweis, endet sie spätestens mit der Höchstdauer (s. Schalter). Die serverseitige Abmeldung (Abmelde-Rücksprung von Shopify oder ein widerrufenes Anmelde-Token) beendet jetzt alle Chat-Anmeldungen der Person auf allen Geräten, auch die über den Shop.
- **Schalter.**
  - `APP_PROXY_SIGNIN_ENABLED`, standardmäßig **aus**: Notschalter. Aus heißt: Die Erkennung wird nur gezählt, es wird kein Code ausgegeben, niemand wird angemeldet. Das Ausschalten wirkt mit einem Neu-Deploy, ohne Zugang zu Shopify.
  - `APP_PROXY_SIGNIN_MAX_AGE_HOURS`, standardmäßig **0**: So viele Stunden nach dem letzten Einlösen gilt eine Shop-Anmeldung **ohne** Anmelde-Token des Chats als angemeldet; jeder neue Tab erneuert sie; höchstens 720. Bei 0 werden nur Personen erkannt, die sich früher schon im Chat über „Anmelden“ angemeldet haben und ein gültiges Token haben. Bei ausgeschaltetem Notschalter gilt immer 0.
  - Empfohlene Werte für den Betrieb: `true` und `24`. Der Mandant setzt sie, sobald die App Proxy in Shopify eingerichtet ist; bis dahin ist der Pfad im Shop nicht erreichbar.
- **Umfang der Shop-Anmeldung (D-AP1).** Bei einer Höchstdauer über 0 gilt die frische Shop-Anmeldung als Anmeldung für: Namensanzeige, Gesprächsliste und -inhalte, **Datenexport**, **Selbst-Löschung**, die **Werbe-Einwilligung nach der Anmeldung** (Double-Opt-in an die Adresse des Kundenkontos, unverändert) und das Chat-Gedächtnis (Begrüßung mit Namen; Personalisierung weiterhin nur mit Werbe-Einwilligung, § 7.2).
- **Bestellstatus ausgenommen.** Der Bestellstatus im Chat (§ 16.1) bleibt der Anmeldung über das Kundenkonto in derselben Sitzung vorbehalten. Bei einer reinen Shop-Anmeldung sagt Mo, dass die Person erkannt ist, der Bestellstatus im Chat aber einmal „Anmelden“ im Chat braucht, und verweist auf „Meine Bestellungen“ im Shop.
- **Nicht wiederholt fragen.** Das Einwilligungs-Popup nach der Anmeldung wird einer Person nicht mehr angeboten, wenn sie es in einer ihrer Sitzungen in den letzten 30 Tagen abgelehnt oder es in 3 Sitzungen innerhalb von 30 Tagen gesehen hat — geräteübergreifend und auch nach „Anmelden“ im Chat. Grundlage sind die pseudonymen Popup-Ereignisse ihrer angemeldeten Sitzungen.
- **Nachweis in der Einwilligung.** Jede Werbe-Einwilligung nach der Anmeldung vermerkt im Einwilligungsprotokoll, welche Anmeldung dahinterstand: „Anmeldenachweis: Kundenkonto-Anmeldung im Chat“ oder „Anmeldenachweis: Shop-Login (App Proxy)“ (Art. 7 (1)).
- **Messung.** Je Erkennung zählt der Server ein pseudonymes Ereignis der Sitzung (Art des Nachweises, Token vorhanden, schon angemeldet, Code ausgegeben bzw. Grund ohne Code) — nie Kundennummer, Name, E-Mail, Code oder URL (D-03).

### 19.2 Entscheidung des Mandanten (05.10.2026)

Der Mandant hat D-AP1 am 05.10.2026 entschieden: Eine frische Shop-Anmeldung zählt im Chat als Anmeldung, im Umfang von 19.1 einschließlich Export, Löschung und Werbe-Einwilligung, mit einer Höchstdauer von 24 Stunden. **Nach Angabe des Mandanten haben Sie dies bestätigt** (F-36). Eingeschaltet wird mit `APP_PROXY_SIGNIN_ENABLED=true` und `APP_PROXY_SIGNIN_MAX_AGE_HOURS=24`, sobald die App Proxy eingerichtet ist. Zugleich entschieden: Die englischen Einwilligungstexte gelten als freigegebene Übersetzung (§ 5), `/en` wird nicht gesondert gesperrt; die Vorteilspunkte im Einwilligungs-Popup wählt die Entwicklung (KI-Assistent Claude), künftig liefert sie das Backend aus statt des Widgets.

### 19.3 Prüfbitte

- **F-36 — Erkennung der Shop-Anmeldung im Chat: beantwortet (05.10.2026, laut Mandant: ja).** Gefragt war nach der stillen Erkennung beim Öffnen des Chats (§ 25 TDDDG, neben F-14), der Zuordnung früherer Gespräche des Browsers, dem Umfang D-AP1 einschließlich Export, Löschung und Werbe-Einwilligung auf Grundlage der Shop-Anmeldung (24 Stunden), dem Personenwechsel auf geteilten Browsern und der Regel „nicht wiederholt fragen“. **Offen bleibt die Datenschutzerklärung** (mit F-05 / F-28): ein Absatz, dass der Chat beim Öffnen die Shop-Anmeldung abfragt, die Chat-Sitzung und frühere Gespräche dieses Browsers mit dem Kundenkonto verknüpft und Kontofunktionen (Verlauf, Export, Löschung, Werbe-Einwilligung) dann ohne eigene Anmeldung im Chat bereitstehen.

---

## 20. Nachtrag 05.10.2026 — Bestell-Zuordnung: Fenster ab der letzten Beratung

Grundlage: `docs/ORDER_ATTRIBUTION.md`, `docs/archive/plans-2026-10-04/ATTR-TOKEN-LIFETIME.md`. Die Bestell-Zuordnung (D-20) misst, ob eine Bestellung auf eine Mo-Beratung zurückgeht: Das Widget setzt mit Analyse-Einwilligung eine opake Markierung (`_mo`) an den Shopify-Warenkorb; Mo-Links in Mails und Set-Angeboten tragen sie im Link. Bisher wird eine Bestellung mit Markierung pseudonym gespeichert, wenn sie innerhalb von 30 Tagen (`MO_ATTRIBUTION_WINDOW_DAYS`) nach Erstellung der Markierung eingeht oder einen Mo-Rabattcode trägt.

### 20.1 Tatsachen

- **Was neu ist.** Bei Widget-Markierungen zählen die 30 Tage ab der **letzten Produktberatung auf demselben Gerät** vor der Bestellung, nicht mehr ab der Erstellung der Markierung. Mo-Links (Zusammenfassungs-Mail, Werbe-Mail, Set-Angebot) zählen unverändert ab ihrer Erstellung.
  - Als Beratung zählen nur Produktkarte, Produktvergleich, Warenkorb-Karte und Showroom-Hinweis; ein reiner Versand- oder Service-Chat verlängert nichts.
  - Eine Beratung **nach** der Bestellung zählt nie.
- **Pro Gerät.** Gezählt werden nur Beratungen, die die Sitzung der Markierung selbst geschrieben hat. Dafür trägt jede Zeile eines Produkt-Werkzeugs jetzt die schreibende Session-ID (`messages.session_id`, Migration 0076). Das ist dieselbe pseudonyme Kennung, die schon am Gespräch steht; keine neue Datenkategorie, keine Verknüpfung über Geräte oder Kundenkonten. Sie wird mit dem Gespräch gelöscht (D-01, 180 T) und bei Löschung auf Wunsch.
- **Übergang (37 Tage nach der Migration).** Ältere Zeilen ohne diese Kennung zählen für die ursprüngliche Sitzung ihres Gesprächs. Hat ein angemeldeter Kunde ein Gespräch auf einem anderen Gerät fortgesetzt, zählen in dieser Zeit auch die Beratungen des anderen Geräts. Danach haben diese Zeilen keine Wirkung mehr; die Ausnahme wird entfernt.
- **Speicherfrist der Markierung.** Bisher 37 Tage ab Erstellung. Jetzt bei Widget-Markierungen höchstens 37 Tage nach der letzten Produktberatung des eigenen Geräts und **nie mehr als 180 Tage** (`KPI_RETENTION_DAYS`) nach Erstellung; die Obergrenze gilt auch, wenn die Kennzahlen-Frist abgeschaltet ist. Bei Löschung auf Wunsch sofort (`erasePerson`). Mo-Link-Markierungen unverändert 37 Tage ab Erstellung.
- **Verlängerung unabhängig von der Einwilligung.** Das Backend sieht die Analyse-Einwilligung beim Chat nicht. Eine Produktberatung auf demselben Gerät **nach** dem Widerruf der Einwilligung verlängert daher das Fenster einer Markierung, die unter Einwilligung erstellt wurde.
- **Markierung bleibt am Warenkorb.** Die `_mo`-Markierung am Shopify-Warenkorb wird bei Abmelden, Sitzungswechsel oder Widerruf nicht entfernt. Auf einem geteilten Browser kann eine spätere Bestellung dadurch länger als bisher (30 Tage ab Erstellung) dieser Sitzung zugeordnet werden — und über deren Gespräche der Akte eines angemeldeten Kunden. Abhilfe: Eine Widget-Aufgabe leert die Markierung beim Abmelden, Löschen und Widerruf; sie ist noch nicht live.
- **Zähler ohne Bestellbezug.** Eine markierte Bestellung, die keiner Beratung zugeordnet werden kann (Markierung unbekannt oder gelöscht, Beratung außerhalb des Fensters), wird weder einer Sitzung zugeordnet noch in der Mo-Zuordnung gespeichert. Gezählt wird nur ein Ereignis ohne Sitzung mit Grund und ggf. Quelle der Markierung (D-03) — **nie** Bestellnummer, Markierung, Betrag oder Kundendaten.
- **Klarstellung.** „Nicht markierte Bestellungen werden nicht gespeichert“ gilt nur für die Mo-Zuordnung (`mo_orders`). Die Bestellkopie (§ 13.1 Nr. 1) speichert bei eingeschaltetem Kundenabgleich (`SHOPIFY_CUSTOMER_SYNC_ENABLED`) jede Bestellung. Der Text im Dashboard ist entsprechend korrigiert.
- **Schalter.** `MO_ATTRIBUTION_SESSION_ANCHOR`, im Code standardmäßig **aus**. Ausgeschaltet gilt die bisherige Regel für Fenster und Speicherfrist, ohne Code-Änderung. Eingeschaltet wird er erst nach der Migration.
- **Umfang live (05.10.2026).** Widget-Markierungen werden seit 24.08.2026 erstellt (derzeit 208). Eine Bestellung ist zugeordnet. Die älteste Markierung stammt vom 29.08.2026; nach der bisherigen Regel würde sie ab 05.10.2026 gelöscht. Zwei bestehende Markierungen werden mit der neuen Regel sofort wieder wirksam.

### 20.2 Entscheidung des Mandanten (05.10.2026)

Der Mandant hat die Wahl an die Entwicklung (KI-Assistent Claude) übertragen. Entschieden ist: Das Fenster zählt bei Widget-Markierungen ab der letzten Produktberatung auf dem Gerät; der Schalter wird nach der Migration eingeschaltet. Er wird damit **vor** Ihrer Antwort auf F-37 eingeschaltet (anders als bei F-32). Die Prüfbitte F-37 bringt der Mandant mit der regulären Aktualisierung dieses Dossiers ein. Lehnen Sie ab, wird der Schalter ausgeschaltet.

### 20.3 Prüfbitte

- **F-37 — Bestell-Zuordnung ab der letzten Beratung:** Bitte bestätigen bzw. beraten Sie:
  - (a) Die längere Lebensdauer der Widget-Markierung (bis 37 Tage nach der letzten Produktberatung, höchstens 180 Tage) auf Grundlage von Art. 6 (1) f und im Hinblick auf die Speicherbegrenzung (Art. 5 (1) e).
  - (b) Ob die Verlängerung unabhängig von der Einwilligung (Beratung nach Widerruf) und die am Warenkorb verbleibende Markierung auf geteilten Browsern hinnehmbar sind — oder ob zuerst die Widget-Aufgabe „Markierung beim Abmelden, Löschen und Widerruf leeren“ live sein muss bzw. das Fenster nur über eine einwilligungsgebundene Erneuerung durch das Widget verlängert werden darf.
  - (c) Die Übergangsregel: 37 Tage lang zählen ältere Gesprächszeilen für die ursprüngliche Sitzung, bei fortgesetzten Gesprächen also geräteübergreifend.
  - (d) Den Hinweis auf den Zweck „Zuordnung von Käufen zur Beratung“ in der Datenschutzerklärung — zusammen mit F-28 und dem offenen Punkt aus `ORDER_ATTRIBUTION.md` (Datenschutzerklärung; Freigabe „Protected Customer Data“ für die Bestell-Webhooks bei Shopify).

---

## 21. Nachtrag 05.10.2026 — Vorteile im Einwilligungs-Popup, Seitenkontext

Grundlage: `docs/CONSENT_FLOW.md` („At-sign-in marketing opt-in“, v5), `docs/frontend/API_CONTRACT.md` § 2 und § 5, `docs/archive/plans-2026-10-04/OI3.md`, `A3.md`.

### 21.1 Tatsachen

- **Vorteilspunkte vom Server.** Das Einwilligungs-Popup nach der Anmeldung zeigt unter der (freigegebenen) Überschrift drei Vorteilspunkte, die jetzt das Backend ausliefert statt das Widget: „Angebote, die zu deiner Beratung passen“, „Exklusive Rabatt-Aktionen nur für Abonnenten“, „Jederzeit mit einem Klick abbestellbar“ (englisch als Übersetzung). Wie die Überschrift sind sie Rahmung, **nicht** Teil des gespeicherten Einwilligungstexts; Einwilligungstext, Fußzeile, Mechanik und Double-Opt-in sind unverändert. Versionsstempel **v5**. Bis zum nächsten Widget-Upload zeigt das Live-Widget noch seine eigenen zwei Punkte.
- **Entscheidung.** Den Wortlaut hat der Mandant am 05.10.2026 entschieden (die Wahl an die Entwicklung übertragen, § 19.2): ansprechend, wahr, ohne Dringlichkeit und ohne Rabattbeträge. Eine anwaltliche Freigabe der Punkte ist nicht vermerkt.
- **Varianten.** Technisch können später weitere Rahmungs-Varianten im Wechsel gezeigt werden (A/B-Test, Zuteilung über die pseudonyme Session-ID). Standard ist eine einzige Variante; eine weitere wird erst nach eigener Freigabe eingeschaltet. Gezeigte Variante und Platzierung landen nur in den pseudonymen Kennzahlen-Ereignissen, nicht im Einwilligungsnachweis.
- **Seitenkontext.** Tippt oder spricht jemand auf einer Produktseite eine Frage, schickt das Widget nach dem nächsten Upload Handle und Titel des Produkts der Seite mit (bei Kategorieseiten die Kategorie) — dieselbe Datenkategorie, die der Produkt-Button schon heute sendet, ohne Verlauf der angesehenen Seiten. Mo nutzt sie nur bei eingeschaltetem Schalter `CHAT_PAGE_CONTEXT_ENABLED` (standardmäßig **aus**). Gemessen wird mit zwei pseudonymen Server-Ereignissen je Sitzung (verwendet ja/nein, Produkt erkannt, Anzahl Produktkarten) — **ohne** Produktkennung, Text oder Kundendaten.
- **Kontrollgruppe.** Optional erhält ein Anteil der Sitzungen (`CHAT_PAGE_CONTEXT_HOLDOUT_PCT`, standardmäßig 0, höchstens 50 %) absichtlich das bisherige Verhalten, um die Wirkung ehrlich zu messen. Das wird erst eingeschaltet, nachdem Messgröße und Zielgröße vorab festgelegt sind, und endet bei Erreichen der Zielgröße (höchstens etwa 6 Wochen).

### 21.2 Prüfbitte

- **F-38 — Rahmung und Vergleichsgruppen:** Bitte bestätigen bzw. beraten Sie (a) die drei Vorteilspunkte als Rahmung außerhalb des Einwilligungstexts; (b) vor einer zweiten Variante: die Zuteilung über die Session-ID (§ 25 TDDDG, neben F-14) und ob die gezeigte Variante im Einwilligungsnachweis stehen muss; (c) vor der Kontrollgruppe: die Datenschutzerklärung (mit F-05 / F-28) — Seitenangaben werden mit Chat-Nachrichten gesendet, Qualitätsvergleiche mit einer Kontrollgruppe auf Grundlage der Session-ID (Art. 6 (1) f).

---


## Anhang A — Chronologie der im Code dokumentierten anwaltlichen Freigaben

| Datum | Gegenstand | Code-Vermerk |
|---|---|---|
| Juni 2026 | Deutsche Consent-Texte v3 (Capture-Formular, DOI-/Abmelde-Texte) | `CONSENT_COPY_LAWYER_APPROVED = true` |
| 14.06.2026 | Physischer Briefversand über Pingen (inkl. AVV-/CH-Drittland-Auflage) | `PHYSICAL_MAIL_SENDS_APPROVED=true` |
| 16.06.2026 | Entscheidung des Mandanten: § 7 (3)-UWG-Feature ersatzlos entfernt | Addendum im Juni-Bericht |
| 21.07.2026 | Kampagnen-Kanal (Shopify-Abonnenten) **inkl.** Single-Opt-in-Kontakten | `CAMPAIGN_SENDS_APPROVED=true`, `CAMPAIGN_ALLOW_SINGLE_OPT_IN=true` |
| Juli 2026 | Consent-Texte v4 (Chat-Consent-Gate, Benefit-Headlines) | Kommentar in `consent-copy-core.mjs` |
| 05.10.2026 | Erkennung der Shop-Anmeldung im Chat, Umfang D-AP1, 24 Stunden (§ 19, F-36; Bestätigung laut Mandant) | `.env.example`: `APP_PROXY_SIGNIN_ENABLED`, `APP_PROXY_SIGNIN_MAX_AGE_HOURS` |

## Anhang B — Glossar

- **DOI:** Double-Opt-in — Bestätigung der Marketing-Einwilligung per Klick auf einen Mail-Link.
- **Capture:** Erfassung der E-Mail-Adresse im Chat mit Einwilligungs-Nachweis.
- **Cluster A/B:** Datenbank-Trennung pseudonymer Nutzungsdaten (A) von identifizierten, einwilligungsbasierten Daten (B).
- **Stufe 1/2/3:** Identitätsstufen anonym / E-Mail erfasst / eingeloggt (Shopify-Konto).
- **Kanal A/B:** eigener DOI-Marketing-Funnel (Rabattpräfix `MS5-`) / Kampagnen-Mails an Shopify-Abonnenten (`MK-`).
- **Fail-closed:** Im Fehler- oder Zweifelsfall wird blockiert (z. B. gilt eine Adresse bei DB-Fehler als gesperrt).
- **Prompt:** Die an das KI-Modell übermittelte Eingabe (Systemanweisungen + Gesprächsverlauf).

*Erstellt am 05.08.2026 aus dem Quellcode des Backends. Fundstellen (Dateipfade) zu jeder Einzelaussage können auf Wunsch nachgeliefert werden; die technischen Detailinventare liegen der Entwicklung vor.*
