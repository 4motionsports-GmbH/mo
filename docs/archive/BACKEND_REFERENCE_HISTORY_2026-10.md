Archived 2026-10-05 from docs/DATA_RETENTION.md, docs/DISCOUNTS.md, docs/BUNDLES.md and docs/REPURCHASE_ANALYSIS.md — historical, not maintained

# Backend reference docs — retired notes (2026-10)

Past-state passages taken out of the living backend reference docs during the
2026-10-05 docs consolidation. Each section names the living doc that now holds
the current facts. Nothing here describes the current system.

---

## 1. Campaign audience before the customer platform (from DATA_RETENTION.md „Campaigns“)

*Superseded by:* `docs/DATA_RETENTION.md` „Cluster B (cont.) — Campaigns“ and
`docs/CAMPAIGNS.md` §1 / §2.3.

> *(Retired: until the customer platform the audience was the shop's SUBSCRIBED
> newsletter list, synced daily into `campaign_contacts` by
> `/api/cron/sync-campaign-audience`. Replaced by the Kundenstamm mirror and the
> nightly audience refresh `/api/cron/campaign-audiences`.)*

Correspondence window note as it stood before 2026-10-05 (from
DATA_RETENTION.md „Korrespondenz“): *"(Window + the lawfulness of feeding
correspondence body into the KB passes are pending Legal/DPO sign-off — see the
spike §3.)"* — the spike is `docs/archive/EMAIL_SUBSYSTEM_SPIKE.md`; the open
legal point is now tracked as `ANWALTSDOSSIER.md` R-08.

---

## 2. Welcome codes (from DISCOUNTS.md „Welcome codes“)

*Superseded by:* `docs/DISCOUNTS.md` „Welcome codes“ (current state: columns
read-only, chat memory reader only, no admin view) and `docs/CUSTOMERS.md`
„Welcome discount“.

> The automatic one-time **welcome discount** (minted on a customer's first DOI
> confirmation, `WELCOME-` prefix) was **retired pre-launch** — client decision:
> too exploitable via alias emails; codes are issued manually via the dashboard
> instead. The issuance code and the `WELCOME_DISCOUNT_*` env flags have been
> removed. Any `WELCOME-…` codes already minted in Shopify remain valid until
> their own expiry, and the historical issued/redeemed data stays visible on the
> admin **Kunden** tab (read-only).

Correction recorded on archiving: no admin view reads the `0009` welcome
columns (none did at `bb8866a`); the claim "stays visible on the admin Kunden
tab" was already stale.

---

## 3. Bundle offers — spike lineage and the pre-redesign admin UI (from BUNDLES.md)

*Superseded by:* `docs/BUNDLES.md` („Required Shopify scopes“, „Admin workflow
(S11)“, „Lifecycle“). Spike itself: `docs/archive/BUNDLES_SPIKE.md`.

- *"This is the S10 build of the feasibility spike in archive/BUNDLES_SPIKE.md.
  The spike's 'Probe results (S9b, 2026-06-13)' section is the source of
  truth."*
- Scopes: *"The bundle path needs **17** scopes — the **2** publication scopes
  below in **addition** to the 15 the rest of the backend already holds."* and
  *"The spike body (§1, §6, follow-up #3) claimed `write_products` alone was
  enough. The probe disproved that."* The counts were not verifiable from code;
  the authoritative list is now `REQUIRED_SCOPES` in
  `scripts/register-shopify-webhooks.mjs`.
- Lifecycle: ended sets are deleted from Shopify since the maintainer decision
  of 2026-10, *"replacing the spike's §5 'archive, never delete'"*.
- Admin workflow as first built: *"A bundle block sits above the free-text
  'special additions' field in the personalized-email flow
  (`CustomerProfileCard`)"* on *"the marketing dashboard's 'Kunden' tab"*, with
  the buttons „Bundle vorschlagen“ / „Bundle erstellen“. Today sets are made on
  the Kampagne card (every campaign, incl. the 1:1 campaign „Einzelansprache“);
  the composer (`src/app/admin/kunden/BundleComposer.tsx`, buttons „Set
  vorschlagen“ / „Set erstellen“, plus „Löschen“ for drafts via
  `POST /api/admin/bundles/delete`) only appears inside Kunden → „Marketing“ →
  „Persönliche E-Mail (bisheriger Weg) — offener Entwurf“.
- Verification step 1 said a missing scope *"503s with a scope message"*; the
  create route returns 502 `create_failed` for it.

---

## 4. Repurchase analysis as a pre-study (from REPURCHASE_ANALYSIS.md)

*Superseded by:* `docs/REPURCHASE_ANALYSIS.md` (method, re-run) and
`docs/CAMPAIGNS.md` „Lifecycle-Segmentierung“ (results, segments, strategies).

Original intro:

> Bevor die geplante Segmentierung der Kampagnen-Mails („Ausbauen" /
> „Weiterentwickeln" / „Zurückholen" / „Ruhen lassen") gebaut wird, misst dieses
> Skript, ob die Annahmen dahinter überhaupt stimmen — und ersetzt die geschätzten
> Monatsgrenzen durch das tatsächliche Kaufverhalten des Shops.

Pre-study decision rules and hypotheses:

> Liegt die Rate im niedrigen einstelligen Bereich, lohnt der Aufwand nicht.

> Median und p75 ersetzen die geschätzten 3/6/12-Monats-Grenzen. Die Erwartung
> hinter dem Entwurf: Kleinteile-Käufer kommen deutlich schneller zurück als
> Großgeräte-Käufer. Falls sich die Stufen kaum unterscheiden, ist die
> Wertskalierung überflüssig und eine einzige Grenze reicht.

(The run found no value scaling of the timing — one time line for all, see
CAMPAIGNS.md „Die drei Befunde“.)

The recommender as it was before the strategies were built:

> Der heutige Empfehler (`pickCampaignRecommendations`) bewertet
> **Embedding-Ähnlichkeit** zum Besitz und schlägt damit *Ersatz* statt
> *Ergänzung* vor — wer ein Rack gekauft hat, bekommt ein weiteres Rack
> empfohlen. Ein hoher Lift in dieser Tabelle ist der Beleg, dass die
> Zubehör-Empfehlung das schlägt.

(Since migration `0052` the recommender has the strategies `complement`,
`similarity` and `winback`.)

> … bewusst dasselbe Modul, das die spätere Segmentierung importieren wird …

(It is imported today by `campaign-segments.mjs`, `customer-facts-core.mjs` and
`campaign-recommendations.ts`.)
