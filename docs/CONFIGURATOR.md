# Home-Gym-Konfigurator — Mo leads the home-gym consultation

The landing page of the Men's Health / Women's Health cooperation: the visitor picks a few basic
answers on the left (the training focus — one of Mo's personas —, place and space, training and
level), hands them to Mo, and Mo — docked on the right of the same page — asks for the rest (budget,
wishes), then goes through the product types one by one — base unit, accessories for it, bench,
weights, flooring — with two to three options each, from which the visitor picks into the plan on the
page; the visitor can extend the plan with own products from the whole shop and weight steps, and puts
it into the cart with one click. Before the consultation the visitor may leave Mo a note („Deine
Hinweise“: ceiling height, equipment already owned, complaints …). Product rules — plates and single
dumbbells in pairs, floor protection for the whole room — are checked by the tools, not left to the
prompt (§4a), and Mo suggests the showroom only for products on display there (§4b). Optionally —
switched off by default — a „Konfigurator-Rabatt“ offers the visitor a Shopify discount code in a
pop-up. This document owns the feature; the wire shapes are in
[`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md) §2 (`context.type: "configurator"`, the tools
`suggest_replies` / `offer_plan_options` / `show_gym_plan`, `suggest_showroom`), §3 (product rules and
showroom of `GET /api/products`), §3a / §3b (assortment and search), §3c (the discount offer) and §5 (KPI
events). Live status: [`ROLLOUT_TODO.md`](./ROLLOUT_TODO.md).

## 1. The flow

```mermaid
sequenceDiagram
  participant V as Visitor
  participant P as Configurator page (theme section)
  participant W as Mo widget (docked)
  participant B as Mo backend (/api/chat)
  P->>B: GET /api/configurator/offer (once on load, offer null while the discount is off)
  V->>P: picks the training focus (persona), place + space, training + level
  V->>P: „Weiter“ — with an answer missing: the card outlined red, scrolled to (§7)
  P->>V: step 04 „Deine Hinweise“ (optional free text, ≤ 500 characters)
  V->>P: „Weiter – Mo berät mich“ (with the note, if any) or „Überspringen“
  P->>W: MS_CHAT.configurator.start(answers + note, {partner, note: written | skipped})
  W->>B: messages: [] + context {type: "configurator", configurator: {...}}
  B-->>W: greeting + first open question + suggest_replies (budget)
  V->>W: taps a chip („1.000–2.500 €“) → sent as the user message (+ the same context)
  B-->>W: wishes question + suggest_replies (multiSelect)
  V->>W: picks wishes, „Übernehmen“
  B-->>W: step „Basisgerät“: offer_plan_options (2–3 options with pros / cons, Mo's pick first)
  V->>W: „Auswählen“ → the option's lines into the plan + „Ich nehme: …“ (or „Überspringen“ / „Andere Vorschläge“)
  W->>P: the picked lines in the editable plan in [data-ms-chat-plan]
  P->>V: with an offer: the pop-up „Dein Konfigurator-Vorteil“ (trigger start: ~1 s after the handover · plan: the first product in the plan), then a slim note above the plan
  B-->>W: next step: accessories for the chosen base (multiSelect), bench, weights, flooring … summary
  V->>P: adjusts quantities / variants, „+ Gewichtsstufe“, „+ Produkt hinzufügen“, „Alles in den Warenkorb“
  P->>P: POST /cart/add.js, cart drawer opens (_mo marker stamped first, consent-gated)
```

The guide follows the order the team defined (Lucas), revised with Anna's feedback of 22.10.2026:
**1 Typ / Trainingsfokus → 2 Trainingsort & Platz → 3 Trainingsart & Niveau** on the page (the former
fourth card „Ich will …“ is gone — the training focus covers it), **4 Budget → 5 Individuelle Wünsche**
(assembly, delivery date, noise, floor protection, no drilling, showroom) asked by Mo with answer
chips, at most 1–2 detail questions more (ceiling height, frequency, equipment already owned), never
more than four questions before the first plan. „Zeig mir einfach was“ gets the plan right away.

**Step by step** (third round of 23.10.2026, Lucas): instead of one complete plan Mo goes through the
product types — **Basisgerät → Zubehör** for the chosen base (Latzug-Option, Dip-Barren,
Hip-Thrust-Auflage … from its „Ergänzende Produkte“) **→ Hantelbank → Gewichte → Bodenschutz**
(Cardio only when the focus or the wishes ask for it) — and offers two to three options per type
(`offer_plan_options`, at most four), the recommendation first with the badge „Mos Empfehlung“, each
with pros and cons from the product data. The visitor picks one („Auswählen“; accessories: several,
then „Übernehmen“), skips the type („Überspringen“) or asks for others („Andere Vorschläge“), or types
anything else — another product, a question —, which Mo answers (`search_products`) before going on.
The picks land in the plan on the page („Von dir gewählt“); Mo keeps the subtotal against the budget
in view and ends with a short summary. „Zeig mir einfach was“ starts with the base unit right away.
The step flow needs the new widget (`configurator.features = ["options"]`, API_CONTRACT §2); an old
cached widget keeps the one-plan flow above unchanged.

**Missing answers** (fourth round, 24.10.2026 — external feedback: a tester forgot the m² answer and could
not go on): the page's main button („Weiter“ since round 6) stays clickable while answers are missing; a click outlines every
incomplete card in red with a short line at the missing field and scrolls to the first one (page only,
§7; KPI `configurator_validation_blocked`).

**Deine Hinweise** (round 6, 27.10.2026 — client review): with the basics complete the button reads
„Weiter“ and opens an optional step 04 — „Gibt es etwas, das wir in deinem Fall beachten sollten?“, a
text field of up to 500 characters (examples: ceiling height only 2,20 m, a bench already owned, knee
problems — please joint-friendly, as quiet as possible in a rented flat). „Weiter – Mo berät mich“ hands
over with the text, „Überspringen“ without it in one click; „Ändern“ after the handover shows the note
again (a changed note is a change Mo is told about: „Hinweis: …“), „Neu starten“ clears it, a prefilled
link goes through the same step. The page timeline has five steps: „Grundeinstellungen“ → „Deine
Hinweise“ → „Beratung mit Mo“ → „Dein Plan“ → „Warenkorb“ (page stages `start → notes → questions → plan
→ cart`; the widget keeps `questions / plan / cart`). The note travels as `context.configurator.note`
(§3); Mo takes it into every recommendation (§4). The text is never stored — the KPIs only learn
whether a note was written (§6). The page offers step 04 only when the widget's page API supports the
note (`MS_CHAT.configurator.version` ≥ 2, round-6 fixes): with an older widget „Weiter“ hands over
directly as in round 5, so the page never shows a note as taken that Mo did not get. The note is
cleaned identically by the page, the widget and the backend (API_CONTRACT §2).

**Konfigurator-Rabatt** (fourth round, the client's idea „zur Diskussion“ — built complete but **switched
off by default**): the operator sets code, title, text, terms, the moment and optionally the last day
(„Gültig bis“) in Konfigurator → „Mo im Konfigurator“ (§5) after creating the same code in Shopify
(Rabatte). While it is on (and its last day is not over), the page shows a
pop-up „Dein Konfigurator-Vorteil“ with the code („Code kopieren“, „Rabatt aktivieren“ → Shopify's
`/discount/<code>` stores it for the checkout) once per browser and code — right after the handover
(`start`, default) or when the first product lands in the plan (`plan`) — and afterwards a slim note
above the plan; Mo knows the discount (§4). The public offer: `GET /api/configurator/offer`
(API_CONTRACT §3c); the effect: the card „Konfigurator-Rabatt“ (§6).

**The training focus is Mo's persona.** The card „Welcher Typ bist du? Wähle deinen Trainingsfokus
aus.“ offers six types — the four private personas Mo already derives from a conversation plus
`design_lifestyle` and `weight_loss`, added to Mo's persona set for this (`PersonaArchetype`,
`persona.ts` `ARCHETYPE_META`, `PROFILE_PERSONAS`, each with its consulting addendum in
`system-prompt-core.mjs`). The visitor's choice **is** the archetype of the thread
(`configuratorArchetype` → chat route): Mo consults in that mode from the greeting on without asking
questions to find out, and the persona shows up like any other in Gespräche, Kunden (the AI customer
profile may pick the same six) and the KPI persona breakdowns.

## 2. Marking the products Mo works with („Konfigurator-Sortiment“)

**Answer to „Tag, Kollektion, wtfe?“: a Shopify product tag.** Every product tagged
`home-gym-konfigurator` (case-insensitive; the tag is configurable in Konfigurator → „Shopify-Tag des
Sortiments“) is in the curated assortment. Why a tag and not a collection: tags are already part of
Mo's catalog sync (`Product.tags`) and of the product search; a collection would need a new field in
the catalog query. A smart collection „Home Gym Konfigurator“ with the rule „Tag ist gleich
home-gym-konfigurator“ can still be created in Shopify for the storefront — Mo only reads the tag.

- **Tagging:** Shopify admin → Produkte → (select several) → „Tags hinzufügen“ → `home-gym-konfigurator`.
  The catalog sync picks it up (nightly, or immediately through the product webhook).
- **Without tagging:** Konfigurator → „Zusätzliche Produkte“ adds products by hand (search picker,
  up to 60) — useful for a test before the shop is tagged.
- **Focus:** „Sortiment bevorzugen“ (default) — Mo plans primarily with the assortment but may add a
  product from the rest of the shop when the visitor asks for it or nothing fits („auch einen
  Gymnastikball, wenn der gewünscht ist“); „Nur Sortiment“ — only assortment products unless the
  visitor explicitly asks for a specific other product.
- **What Mo sees:** the assortment as a compact list in the configurator section of the prompt (handle,
  name, category, price or price range, footprint, sold out, short description, up to three accessory
  handles from „Ergänzende Produkte“, and for a product with several variants its orderable variants
  with their ids — the weight steps; a series longer than 16 as an even spread that keeps the lightest
  and the heaviest step, „+N Stufen dazwischen“) — at most 60 lines, the rest through `search_products`; plus a
  retrieval bonus for assortment products (`retrieval.ts` `boostIds`, +0.08 on the score), so the
  detailed product block of each turn prefers them. Sold-out products are never put into a plan.
- An empty assortment is not an error: Mo then plans from the whole shop.

Good candidates: base units (wall cable stations, fold-back/half/power racks, multi-gyms, Multipressen),
benches, adjustable dumbbells and plate sets, floor protection, the cardio machines for small rooms,
and the accessories of the base units.

## 3. Triggers: what the page sends (answer to „welche Auslöser …?“)

The page sends ids from one vocabulary (`src/lib/configurator-core.mjs` → `CONFIGURATOR_FIELDS`; the
theme's `assets/ms-home-gym-configurator.js` uses the same ids):

| Field | Ids (German label) |
| --- | --- |
| `persona` („Typ / Trainingsfokus“, Mo's personas) | `pragmatic_beginner` Pragmatisch starten · `ambitious_home_athlete` Ambitioniert trainieren · `strength_focused` Kraft und Muskeln aufbauen · `cardio_focused` Gesundheit und Ausdauer fördern · `design_lifestyle` Design und Lifestyle leben · `weight_loss` Abnehmen und fit bleiben (each with Anna's subtitle) |
| `location` | `house` Haus / Keller · `apartment` Wohnung (Mietobjekt) · `garage` Garage / Outdoor |
| `space` | `xs` bis 6 m² · `s` 6–10 m² · `m` 10–20 m² · `l` über 20 m² |
| `training` (several) | `free_weights` · `machines` · `cardio` · `functional` |
| `level` | `rookie` · `intermediate` · `pro` |
| `budget` (Mo asks) | `b1` ≤ 1.000 € · `b2` 1.000–2.500 € · `b3` 2.500–5.000 € · `b4` 5.000–10.000 € · `b5` > 10.000 € |
| `wishes` (Mo asks) | `assembly` · `fast_delivery` · `quiet` · `no_drilling` · `foldable` · `floor_protection` · `showroom` |
| `note` (step 04 „Deine Hinweise“, optional; 27.10.2026) | free text ≤ 500 characters — cleaned identically by the page, the widget and the backend (`sanitizeConfiguratorNote`; control and invisible characters out without a trace, ZWNJ / ZWJ kept for emoji, any other whitespace one space, single line breaks kept — API_CONTRACT §2), dropped when empty; a context with only a note is no configurator context |

Required on the page: persona, location, space, level (training is optional) — a click on „Weiter“ with
one of them missing outlines its card (§7). Place, space and level
carry a consulting cue for Mo where it matters (e.g. `apartment` → quiet, impact/floor protection,
drilling only with the landlord's consent; `xs` → wall stations, fold-back racks, adjustable
dumbbells); the persona brings Mo's whole consulting mode instead.

**Answers of the first version** (21.10.2026, before the persona card) still parse: the old persona ids
map onto today's (`busy`/`family` → `pragmatic_beginner`, `ambitious` → `ambitious_home_athlete`,
`health`/`best_ager` → `cardio_focused`), and without a persona the removed goal does (`muscle` →
`strength_focused`, `fitness` → `weight_loss`, `health`/`endurance` → `cardio_focused`, `athletic` →
`ambitious_home_athlete`) — for a page still cached in a browser, for old links and in the admin's
answer distribution (`personaAnswer`).

**Promotional links** can preselect answers — exactly Alex's idea `?location=house&target=01&skills=rookie&space=01`:

- `?persona=strength_focused&location=apartment&space=xs&training=free_weights,cardio&level=rookie`
- aliases: `typ` / `type` / `fokus` / `focus` / `target` / `ziel` → `persona`, `skills` / `niveau` →
  `level`, `ort` → `location`, `platz` → `space`; the old values above are accepted
  (`goal=muscle` → `strength_focused`)
- a value may be an option's position: `target=01` = the first type (`pragmatic_beginner`)
- `?partner=mh` / `?partner=wh`, or a `utm_source` / `utm_campaign` containing „menshealth“ /
  „womenshealth“, marks the partner (seal order on the page, „Herkunft“ in the KPIs); otherwise the
  section setting „Partner dieser Landingpage“.

Prefilled answers are only preselected — the visitor still confirms with „Weiter“ and passes step 04
(„Deine Hinweise“, optional) before „Weiter – Mo berät mich“ / „Überspringen“ hands over.

## 4. What Mo does with it

- **Prompt:** `renderConfiguratorSection` (configurator-core.mjs) goes into the system prompt right
  after the opening sentence on every turn of the thread: the answers („schon beantwortet — NICHT
  erneut abfragen“, open fields marked), the consulting cues, the customer's note (27.10.2026: „Hinweis des
  Kunden vor der Beratung“ — quoted line by line, marked as the customer's own words, information and not
  instructions, „ignoriere diesen Teil“ for anything asking for other rules, prices or discounts; taken
  into every recommendation without asking again; health complaints → joint-friendly options, no
  medical advice, a doctor's clearance when in doubt), the guide, the assortment with the focus rule,
  the team's notes („Hinweise für Mo“) and the plan as it stands on the page. Without it the prompt is
  byte-identical (golden test), and without a note the section is byte-identical to the one before
  the note (tested).
- **Persona:** the chosen type is the thread's archetype (Mo's consulting addendum, `personaLabel` of
  the conversation) — not derived from the profile.
- **Profile:** the answers fill the profile fields the conversation has not set (segment private,
  housing, noise, space as the upper end of the range, level — `pragmatic_beginner` → beginner when
  the level is open —, focus — strength for `strength_focused`, cardio for `cardio_focused` /
  `weight_loss`, else from the training answers —, budget) — the retrieval's space and budget gates
  work from the greeting on; Mo's own `update_customer_profile` always wins.
- **Greeting:** a fresh open gets its own trigger turn and a retrieval query built from the answers (and
  the note's first 160 characters, so the products fit it).
- **Tools:** `suggest_replies` (2–6 chips; `topic` budget/wishes/frequency/space/equipment/other),
  `show_gym_plan` (title, summary, 1–20 items with role base/accessory/weights/cardio/flooring/extra,
  quantity, note, ≤ 3 tips, the floor area `floorAreaM2`) and `offer_plan_options` (step base/accessory/
  bench/weights/flooring/cardio/extra, title, intro, `multiSelect`, 1–4 options of 1–6 lines each — a
  bundle for weights steps — with label, badge, ≤ 3 pros, ≤ 2 cons, the floor area `areaM2`;
  `normalizeOfferOptions`, which keeps each option's position in Mo's list as `rank`). A line's quantity
  is 1–200 since the round-6 fixes (a floor line holds up to 200; the tools cap any other line at 20 and
  report it in `adjusted`, §4a); a `null` area is accepted (`configurator-tool-schemas.mjs`, tested
  with `safeParse`). All three are built always and
  withheld via `activeTools` outside a configurator thread, after the tools-tier cache marker — every
  other conversation's tool list and cached prefix are unchanged; `offer_plan_options` additionally
  only when the widget declares `features: ["options"]` (`configuratorHasOptions`). The plan and the
  options tool answer the model with unknown / sold-out ids so it can correct itself in the same turn;
  the options tool counts an option as shown only when **every** item is known and available — the
  widget's rule (`offerOptionsResult`; a vanished variant is reported as unknown). Its texts are
  accepted at twice the documented length (title 160, intro 480, label 120, badge 48, pros / cons
  180 each) while the tool descriptions ask for the documented one (pros / cons ≤ 90, a short title,
  label and badge) — `normalizeOfferOptions` and the widget clip, so a slightly long pro never
  invalidates the whole call.
- **Step guide** (with `features: ["options"]`, `STEP_GUIDE_*` / `STEP_AFTER_*`): Mo announces the
  steps, offers one type per answer (one `offer_plan_options` call, no chips, no `show_product` for the
  offered products), pros and cons only from the product data, and waits for the pick. When the tool
  reports fewer `shownOptions` than offered (unknown / sold-out ids), Mo calls it once more in the
  same answer with replacements for those options and never talks about an option that is not shown.
  **Swaps** (the widget's rule, stated for Mo in German and English): a pick in a single-select group
  replaces the earlier pick of the same step — from this group or an earlier one of that step,
  „Ich nehme stattdessen: …“; in the steps accessory and extra and with `multiSelect` a later group
  adds. After a swap of the base unit Mo checks whether the accessories already picked still fit (the
  ones the accessory block names „schon im Plan“ for the new base do) and says which to remove. When
  the base unit needs a barbell (rack, half rack, free stands) and none is in the plan, the weights
  step puts it into every option (its own line, plates matching its diameter); benches, plates and
  mats belong to their own steps. For the accessory step the prompt
  lists the „Ergänzende Produkte“ (`compatibleWith`) of the base units in the plan („Zubehör zu den
  Basisgeräten im Plan“, `planAccessoryBases` / `planAccessories` → `renderAccessories`): the strength
  base units — add-ons by their name (Latzug-Option, Jammer Arms, J-Hooks, Landmine, Spotter …, not
  „Rack mit Latzug-Option“) after the racks, then the most expensive first (the rack, not an add-on
  picked for it — also after a swap, when the widget appends the new base unit behind the add-ons
  picked for the old one; checked on all 215 rack × add-on pairs of the catalog); a base related
  to an already kept one — it lists it or is listed by it (J-Hooks, Landmine, Jammer Arms,
  Latzug-Option picked as accessories) — is no base of its own; an add-on that fits no base in the
  plan still counts as one (the plan context carries no pick step) —, without a strength base the cardio machine
  (training focus endurance / weight loss); per base the first 20 refs, in stock, without weights,
  floor protection and cardio machines, at most ten products, at most three bases; products already in
  the plan are not offered again but named per base („schon im Plan: …“ / "already in the plan: …");
  without any Mo searches for matching accessories. The plan block carries each line's price („— 229 €
  je Stück“) and, when every line is priced, the subtotal („Zwischensumme“) Mo compares with the
  budget. `show_gym_plan` only when the visitor explicitly wants a complete set. The
  English guides (the step guide and an old widget's one-plan guide) name the English page's buttons
  („Add everything to cart“, „+ Weight step“, „+ Add a product“).
- **Weights** (Anna's feedback: the first plans held a single 0,5 kg plate): for weights with
  several steps the guide asks for concrete steps — one line per step with its variant ref (product
  id + `~` + variant id, from the assortment list or the retrieved-products block; never an invented
  id — `search_products` returns none), plates in pairs (quantity 2), matching the bar's diameter,
  sized to level and focus, never only the smallest step; a step that is not listed is replaced by
  the nearest listed one. Weights without variants (adjustable dumbbells, sets, single kettlebells)
  go in with their product id. The page shows one hint above the plan lines when the plan has
  weights — „Mo empfiehlt zu deinem Setup Hantelscheiben. Bitte prüfe eigenständig, welche
  Gewichtsstufen du benötigst …“ (the first sentence only for Mo's own weights lines; Hanteln /
  Kettlebells / Gewichte by the products' names) — and a „+ Gewichtsstufe“ button on weights lines
  with several variants (adds the next heavier free step after the line's own weight, lighter ones only
  when nothing heavier is free; disabled when every variant is in the plan — at 20 lines it explains
  the limit).
- **The visitor's own lines:** „+ Produkt hinzufügen“ under the plan lists the configurator assortment
  (`GET /api/configurator/assortment`: public cards sorted by plan role then name — the role from the
  catalog category, else the name, `planRoleForProduct`; a strength machine that says „Plate Load“ is a
  base unit, not weights; empty when the configurator is off; origin allowlist +
  `products` rate limit, cached 5 min) with role chips and a search field that is always there and
  searches the **whole shop** (`GET /api/configurator/search?q=`, third round — before, the search only
  filtered the curated list and was gone when that list was empty): every word must match name, brand,
  category, tags or a SKU — every variant's too (folded on both sides: case, umlauts / ß, the ae / oe /
  ue spellings, plurals incl. „-er“ and short ones like „Bänke“; `searchCatalogCards`); the exact name
  word first, then its singular / plural — „Kurzhanteln“ before „Kurzhantelablage“ —, then name
  prefixes (an „-er“ stem only finds the exact word: „Laufbänder“ → „Laufband“, but „Ständer“,
  „Halter“, „Hocker“ never „Stands“, „Haltungstrainer“, „Shock“); in-stock before sold-out, then the
  name matches of the plan role the query itself names (`planRoleForProduct` of the query:
  „Rudergerät“ → the rowers before the strength line's rowing machines, „Bank“ → the benches before the
  „Curl Bank“, „Hanteln“ → the dumbbells before the dumbbell racks), then that score, the shorter name,
  the name; hidden products never, at most 12 cards in the assortment's card shape; origin allowlist + `products` rate limit, cached 60 s. No embeddings — free per keystroke
  (about 1 ms per query on the full catalog; the folded fields are built once per catalog product).
  A card goes in with its product rules' minimum (`rules.min`, a repeat adds `step` — since 27.10.2026
  every card carries `rules`, `{}` = one by one, §4a); only from an older backend without any `rules`
  field a weights card with more than one variant (plates, dumbbells in steps) goes in as a pair (2×, a
  repeat adds 2), every other card as one. Added lines and extra weight steps
  are marked „Von dir ergänzt“, picked options „Von dir gewählt“; both go back to Mo as plan items with `added: true` and are listed in the
  prompt as „vom Kunden ergänzt“ — Mo keeps them in every new plan unless the visitor wants them gone.
  Mo's plan and the visitor's own lines share one limit of 20 lines (`PLAN_MAX_ITEMS` =
  `CONFIGURATOR_LIMITS.planItems`); over it, Mo asks what can go. The per-answer product limits (also
  a persona's, e.g. „maximal 1-2 Produkte“) do not apply to the plan.
- **Cart:** the whole plan goes into the shop cart through the plan's button (`/cart/add.js`);
  `add_to_cart` (direct checkout) only when the visitor wants a single product right away.
- **Konfigurator-Rabatt** (24.10.2026, default off): while it is on and complete, the configurator
  section carries one short block after the team's notes — „Konfigurator-Rabatt (vom motion sports Team
  freigegeben)“ with title, code, terms and when the page shows the pop-up (`renderDiscount` via
  `configuratorOffer`): Mo brings it up only when price, budget or the cart come up or the visitor asks —
  not in the greeting, not with its own budget question, on its own at most once; with the moment
  „Beim ersten Produkt im Plan“ and an empty plan not before the plan has a product (only when asked),
  so Mo does not announce it before the page's pop-up —, names code and terms, points to „Rabatt
  aktivieren“ / the checkout, never promises more than the terms, never calculates reduced prices (the
  subtotal stays without the discount) and never invents other discounts or codes; the newsletter /
  welcome rules keep their own section. Off, incomplete or past „Gültig bis“ the section is
  byte-identical (tested, and compared with the version before the discount).
- **Switch:** Konfigurator → „Geführte Beratung“ (admin setting, default on). Off: the page still works,
  Mo just chats normally (no answers, chips or plan) and the discount offer is `null`. Settings are
  cached per instance for 60 s.

## 4a. Product rules (round 6, 27.10.2026)

Data-driven constraints the tools **validate** instead of relying on the prompt — the pure, tested
`src/lib/product-rules.mjs`. A new rule is an entry in the registry; no prompt template changes.

- **Registry** `PRODUCT_RULES`: id, label, description, a predicate on the catalog data — plan role
  (`planRoleForProduct`, `plan-role.mjs`), regexes on category / name / tags / description, the sales
  unit („Liefereinheit“ `custom.liefereinheit` → `specifications.Liefereinheit`: Stück / Paar / Set;
  „unknown“ where it is not maintained), explicit handles, negations — and effects: `quantityStep`
  (2 = pairs), `minQuantity`, `maxQuantity` and `coveragePerUnitM2` (a number, or „dimensions“: from the
  variant's or the name's dimensions — „1000 x 1000 mm“ = 1 m², „500 × 500“ = 0,25 m², a pack „Set 10
  Stück“ ×10, a connector or edge variant none —, else the catalog's width × depth, else the
  footprint, and with `coverageFromDescription` as the last source the description's „Länge: … cm“ /
  „Breite: … cm“ or a labelled „Maße: A x B mm“ line, units required). **A coverage always means
  „plan it for the whole room“** (`fillsRoom` — round-6 fixes): the flooring-room rule's tiles and any
  product with `mo.coverage_m2` > 0 alike.
- **Shipped rules**, checked against the bundled catalog (and with the merchant's Liefereinheit from the
  product CSV — the same result):
  - „Hantelscheiben paarweise“ (`plates-pairs`, step 2, min 2) — 30 products: plates sold per piece, e.g.
    ATX® Calibrated Steel Plates, ATX® Gym / Rubber / HQ / Color … Bumper Plates, ATX® Fractional Steel
    Plates, Hantelscheiben Guss 30 / 50 mm, Gummi (Gripper) 30 / 50 mm, Polyurethan 4-Grip 30 / 50 mm,
    Standard Barbell Plate Guss 50 mm, DYO Full Rubber Bumper Plates, Fractional Rubber Plates.
  - „Kurzhanteln paarweise“ (`dumbbells-pairs`, step 2, min 2) — 9 products: Hex Hanteln Gummi,
    Kompakthanteln Gummi (Logo), Kurzhantel Fat Bar, Kurzhantel mit Kugellagerung 50 mm, Kurzhantelstange
    Gewinde 30 mm, Rubber Dumbbell PRO-Style, Trainingshanteln Chrom, Urethan Dumbbells, Vinyl Hanteln.
  - „Bodenschutz für den ganzen Raum“ (`flooring-room`, coverage from the dimensions, whole room) — 10
    products: Bodenschutzmatte Standard / Excellence 1000 × 1000 (1 m²), their „Set 10 Stück“ (10 m²),
    Gymfloor® Granulat Schutzplatten 500 × 500 (0,25 m²) and Premium 1000 × 1000, Fallschutzplatte
    Antishock, Puzzleplatte Excellence 980 × 980 (0,96 m²) and — since the round-6 fixes, from its
    description („Länge: 101 cm“, „Breite: 101 cm“) — Fallschutzplatte / Gewichthebermatte 40 mm
    (1,02 m²; the only product the description source changes in the bundled catalog: a genuine 40 mm
    floor plate sold per piece). Only products whose **name** the rule matches read the description.
  - Not matched on purpose: sets and Vorteilspakete (31 weights products), products already sold as pairs
    („Paar“, „Paarweise“, a price per pair), adjustable dumbbells and kettlebells (Nüobell, BowFlex …),
    kettlebells (no pair rule), weight-vest plates; exercise mats (AIREX …) and flooring without
    recognisable dimensions.
- **Metafields** (namespace `mo`, per product, beat the registry; [`CATALOG_SYNC.md`](./CATALOG_SYNC.md)):
  `mo.sold_in_pairs` (boolean — `false` lifts a pair rule), `mo.quantity_step`, `mo.min_quantity`,
  `mo.max_quantity` (integers), `mo.coverage_m2` (decimal; a positive value makes the product floor
  protection sized to the whole room — any product, whatever its plan role; `0` switches coverage and
  the whole room off; an edge-piece or connector variant of such a product still covers nothing,
  `NON_TILE_VARIANT`, like the widget). Parsed in `catalog-mapping.ts` into `product.moRules`; no other
  namespace.
- **Resolution** `resolveProductRules(product, { showroomIds, variant })` → `{ step, min, max,
  coverageM2, fillsRoom, showroom, ruleIds }` — integers within the line's cap (`lineCapOf`: 20, a floor
  line — one with a coverage — 200; `RULE_LIMITS.lineMax` / `floorLineMax`); `fillsRoom` is true exactly
  when there is a coverage; conflicts resolve towards the smaller quantity (a maximum below the step
  drops the step). Helpers: `normalizeQuantity`, `validateLines` / `validateOptions`, `ruleHint`
  (prompt), `publicRules` (API — `coverageM2` only together with `fillsRoom`), `ruleBadges` (admin).
- **Where they apply:**
  - *Prompt* — every product line Mo sees carries the hint („nur paarweise“, „deckt ca. 1 m² je Stück“,
    „für die ganze Raumfläche planen“, „im Showroom ausgestellt“): the retrieved-products block
    („- Regeln: …“), the configurator assortment („| Regeln: …“), the accessories („— 99 € (Regeln: …)“
    since the round-6 fixes) and the plan lines („— Regeln: …“); the `search_products` hits carry the
    same hint as `rules` (so a product Mo finds by search shows „im Showroom ausgestellt“ too). One
    generic instruction each in the base prompt and the configurator guide: follow the product rules of
    the product lines; tool results may carry `adjusted` quantities — use the corrected ones in the text
    (configurator: only with a widget that declares the feature `rules`, below).
  - *Heights* (round-6 fixes) — the configurator's assortment, plan and accessory lines carry „H 227 cm“
    when the catalog knows the height (`dimensions.height`; EN the same), `search_products` hits
    `heightCm`; with a note Mo compares a ceiling height the visitor states with the equipment's height
    plus room above it for pull-ups and overhead work and leaves out what does not fit — even when it is
    on display in the showroom (one generic sentence in the note block; without a note the prompt is
    unchanged).
  - *Tools* — `show_gym_plan`, `offer_plan_options` (per shown option) and `add_to_cart` validate and
    answer the model with `adjusted` [{ productId, from, to, rule }] (rule „paarweise“, „Mindestmenge“,
    „Schrittweite“, „Höchstmenge“, „höchstens 20 je Position“ / „höchstens 200 je Position“ — the cap
    that applied —, „Raumfläche“), `coverage` and `inShowroom`; a result without any stays exactly as
    before. A line's quantity may be 1–200 in the tool input; a non-floor line is capped at 20 there.
    The widget renders the tool INPUT and normalises it itself with the same rules (API_CONTRACT §3), so
    the page and Mo agree — the lockstep decisions (coverage = whole room, the caps 20 / 200, one floor
    product sized, edge pieces without coverage, one note cleaner) are listed in API_CONTRACT §3.
  - *API* — `GET /api/products`: `rules` on every entry since the round-6 fixes (only what applies; `{}`
    = one by one — no `rules` at all = an older backend, so the widget's old pair heuristic never adds a
    kettlebell twice) and `showroom`; the cart permalinks carry the rule's minimum (a pair of plates →
    `:2`) and the add_to_cart card says so („2× …“, „Paarweise“, the line total). The assortment and
    search cards carry the same.
  - *Admin* — the column „Regeln“ and the overview „Produktregeln“ (§5).
- **Flooring** — covers the **whole room** (look & feel), not only the rack's footprint. Before
  recommending flooring for a room that is equipped as a whole (training room, garage, Keller — or the
  visitor says so), Mo asks for the exact floor area (Länge × Breite) unless it is known and stores it
  with `update_customer_profile` (`spaceM2`); the „Platz“ answer is only a range, and the space value
  the answers put into the customer profile (`SPACE_M2`, e.g. 40 for „über 20 m²“) only its upper end,
  not the floor area (the configurator guide says so; the base prompt is unchanged). **In a rented flat**
  (location `apartment`) the configurator guide plans the floor protection for the training area (the
  „Platz“ answer, its exact size asked for), not the whole living room — unless the visitor says it is
  a room of its own; house / Keller, garage and an open location keep the whole-room text. With the
  area in `offer_plan_options.areaM2` (step flooring) or `show_gym_plan.floorAreaM2`, the tools size
  **one** floor product: only when the plan, or an option, has exactly one line with coverage (a line
  whose variant is an edge piece or a connector has none), that line gets ceil(area / m² per unit),
  respecting step, minimum and the floor line's cap of **200**. With two or more coverage lines (e.g. a
  drop zone of heavy plates under the rack plus mats for the rest) nothing is resized: Mo works out the
  counts so that together they cover the area (the configurator guide and the base prompt say so). The
  tools report `coverage` { areaM2, coveredM2, lines, missingM2?, neededQuantity? } — `missingM2` when
  the lines leave part of the area uncovered, `neededQuantity` only for the one sized line when the cap
  stopped it (Mo then picks a larger tile or a set). The widget sizes with the same rule and shows
  „deckt ca. N m²“ on flooring lines. The direct checkout (`add_to_cart`) carries only the minimum per
  product, so a piece count Mo names outside the plan is set by the customer in the cart (base prompt,
  tool description).
- **The widget's feature `rules`** (round-6 fixes): the round-6 widget declares `features: ["options",
  "rules"]` — it applies the rules itself, so the configurator guide tells Mo that the page shows the
  tools' `adjusted` and to name the corrected quantities. An older widget (no `"rules"`, the rollout
  window) shows exactly Mo's input and holds at most 20 per line: the guide then tells Mo to put the
  final, rule-conforming quantities into the tool input itself (pairs; flooring area ÷ coverage, rounded
  up, at most 20 per line), never claims that the page shows `adjusted`, and the tools cap floor lines at
  20 for that widget (`widgetRules: false` → `floorLineMax` 20 in `validateLines`). Both variants are
  tested.

## 4b. Showroom availability (round 6, 27.10.2026)

- **Where the list lives:** the showroom page (`/pages/showroom-munchen-grobenzell`) uses the theme's
  default template `templates/page.json`; its products come from a `featured-collection` section
  („Teste unsere Top-Geräte live im Showroom“, `featured_collection_hzmn37`) whose `products` setting is
  a hand-picked list (23 handles) — no collection, tag or metafield. The list exists only in the
  **live** theme.
- **Reading it** (`showroom-store.ts` over the pure, tested `showroom-core.mjs`; a copy of the template
  is the test fixture): Admin GraphQL `themes(first: 1, roles: [MAIN]) { files(filenames: [...]) }`
  (text, base64 or URL body), the leading `/* … */` comment stripped, the `featured-collection`
  sections whose heading or subheading mentions „Showroom“ (or the one `SHOWROOM_SECTION_ID` pins), their
  product handles — and when such a section points to a collection, that collection's products
  (`read_products`). When no section matches and nothing is pinned (the client renamed the heading in
  the theme editor), the section ids of the last good read are tried before the error is recorded
  (`showroomFromStoredSections`), so later changes to the hand-picked products still reach Mo.
- **Scope `read_themes`:** needed to read the theme — the live state and the CLI steps that add it
  (a new app version, the permission accepted in the Shopify admin): [`ROLLOUT_TODO.md`](./ROLLOUT_TODO.md)
  item 16.3. Without it every refresh records „Berechtigung read_themes fehlt …“ and only the manual
  list applies.
- **Cache and refresh:** `admin_settings` key `showroom` (no migration) keeps the last good theme list
  (handles, collections, sections, theme name, file, `fetchedAt`), the manual list, the last attempt and
  its error; read per instance with a 5-minute TTL (chat, `/api/products`, the cards). Refreshed daily by
  the catalog sync cron (`/api/cron/sync-catalog`, in parallel, fail-soft — its log carries `showroom`)
  and on demand („Jetzt aktualisieren“, §5). A failed refresh keeps the last good list. The refresh
  reads the state again right before writing and applies only the theme part to it, so a manual list
  saved meanwhile (another tab, a save during the cron's Admin API call) is kept; when that read fails,
  nothing is written.
- **Manual list** (admin, ≤ 60 products): joined with the theme list; applies alone while the theme
  cannot be read.
- **Env:** `SHOWROOM_THEME_FILE` (default `templates/page.json`; `off` = no theme source, the manual
  list only), `SHOWROOM_SECTION_ID` (pin one section) — `.env.example`.
- **Behaviour:** Mo suggests the showroom only when a recommended base unit or a matching accessory is
  on display (the product lines say „im Showroom ausgestellt“; the base prompt's showroom rule and the
  persona addenda are availability-based, no longer price-based). With the wish „Vorher im Showroom
  testen“ Mo prefers and names the products on display and says honestly when none of the recommended
  ones is there. A product without a product line in the current turn (an earlier answer, a
  `search_products` hit — whose result carries the hint as `rules` since the round-6 fixes) Mo checks
  with `suggest_showroom` before saying it is not on display; `ok: false` renders no card, so the check
  is safe. `suggest_showroom` checks its productIds: `{ ok, showroomKnown, inShowroom, notInShowroom,
  unknownIds? }` — `showroomKnown` on every result; none of the known products on display → `ok: false`
  with a reason about exactly those (`notInShowroom`), and the widget renders nothing; only ids the
  catalog does not know → `ok: false` with `unknownIds` and a reason to retry with the ids of the product
  lines, without any claim about the display. An unknown list (never read, no manual list) → Mo does not
  suggest the showroom on its own; asked about it, Mo promises no particular product (the tool result's
  note), and the widget's card names no product („Besuche unseren Showroom – welche Geräte dort
  ausgestellt sind, bestätigt dir das Team bei der Terminvereinbarung.“). The widget reads `ok`,
  `showroomKnown` and `inShowroom` (API_CONTRACT §2).

## 5. Admin screen „Konfigurator“

`/admin?tab=konfigurator` (group Arbeit, no digit shortcut — all ten are taken), details in
[`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.11:

- **Wirkung** (`?kpiRange=7d|30d|90d`): page views (consent only), handovers, plans, cart value,
  orders + revenue; the funnel „Vom ersten Klick zur Bestellung“ (with the stage „Hinweise erreicht“
  between „Konfigurator begonnen“ and „An Mo übergeben“ only for periods that start on or after the
  note step's first day — `NOTE_STEP_FROM`, derived from the release `konfigurator-hinweise-regeln`, so
  re-dating that release moves it; the stage's InfoTip says so — and when the period has such
  sessions); how visitors answered (one card per field, plus „Hinweis vor der Beratung“: handovers
  „mit Hinweis“ / „übersprungen“), the partner split, „Schritt für Schritt“ (per product type: options shown, picked, skipped,
  „Andere Vorschläge“ — third round), the products in Mo's plans, chip topics, the 12 latest
  configurator consultations with a link to the transcript in Gespräche; the card „Konfigurator-Rabatt“
  (24.10.2026: Pop-up gezeigt, Rabatt aktiviert, Code kopiert, Bestellungen mit dem Code + revenue — only
  while the discount is on or the period has pop-up events; §6).
- **Mo im Konfigurator:** on/off, assortment focus, Shopify tag, extra products, „Hinweise für Mo“
  (≤ 1.500 characters, e.g. a running promotion or delivery times); the card **„Konfigurator-Rabatt“**
  (24.10.2026): Aktiv / Aus (default Aus), Zeitpunkt („Nach dem Start der Beratung“ / „Beim ersten
  Produkt im Plan“), Rabattcode (3–40 characters, letters, digits, `-`, `_` — exactly the code created in
  Shopify → Rabatte with the same value and conditions; **not** starting with `MK-` / `MS5-`, the
  prefixes of Mo's own unique codes that the order attribution counts as Mo's — `isMoDiscountCode`,
  [`ORDER_ATTRIBUTION.md`](./ORDER_ATTRIBUTION.md)), Überschrift (≤ 60), Text (≤ 200, optional),
  Bedingungen (≤ 200; Preisangaben: state them in full — minimum order value, validity, exclusions,
  combinability), **Gültig bis** (optional, the last day in Europe/Berlin: from 00:00 the day after,
  the offer is `null` and Mo's block is gone without a save — `isDiscountEnded`; the badge then reads
  „Abgelaufen“) and a simplified preview. „Aktiv“ needs code, title and terms (`validateConfiguratorDiscountInput`,
  German messages); a stored row without them, or with a reserved code, is never active
  (`parseConfiguratorDiscount`, fail-closed). Mo creates no code and checks none in Shopify.
- **Sortiment:** the resolved assortment with price, stock and why it is in (Tag / Liste); warnings for
  unknown extra handles and a mostly sold-out assortment. Since 27.10.2026 also:
  - the column **„Regeln“** — per product its rules as badges („paarweise“, „1 m²/Stk“, „ab N Stk“,
    „max. N Stk“, „Metafeld“ when a `mo.*` metafield sets or lifts one, „Showroom“), sortable (the
    category column shows from 1280 px on, so the rules fit at 1024 px);
  - the card **„Produktregeln“** — the registry read-only: rule (description in the InfoTip), what it
    does, how many catalog products it matches; the number of products with `mo.*` metafields (the
    metafields in the InfoTip); „Betroffene Produkte“ lists the matched products per rule (§4a);
  - the card **„Showroom“** — status (N Produkte ausgestellt / Unbekannt), source (Theme / eigene Liste /
    both), „Zuletzt gelesen“ (the last good read) and „Letzter Versuch“, the theme section and theme,
    the error of the last refresh („Theme nicht gelesen“ — the read_themes how-to „Was tun“ only for a
    missing scope; a renamed section, a throttle or a network error say what to do in their own message;
    the last good list keeps applying), „Jetzt aktualisieren“ (needs Shopify), the products on
    display („Ausgestellte Produkte“, each marked Theme / Liste), handles the catalog does not know, and
    the manual list „Eigene Liste“ (product picker, ≤ 60, „Liste speichern“) — §4b.

Storage: `admin_settings` key `configurator` (migration 0078 — **no new migration**; the discount is the
field `discount` of the same value). Route: `POST /api/admin/konfigurator/settings` (`guardAdminPost`,
audit `settings.configurator` with the discount's on/off, code, moment and last day; a body without `discount` keeps
the stored one). Public: `GET /api/configurator/offer` (origin allowlist, `products` bucket, cached 60 s —
a change reaches the page within about two minutes; the save toast says so when the discount changed).
Showroom (27.10.2026, `admin_settings` key `showroom`, no migration): `POST
/api/admin/konfigurator/showroom` `{ handles }` (the manual list, validated — German messages; audit
`settings.showroom`) and `POST /api/admin/konfigurator/showroom/refresh` (reads the theme now; audit
`showroom.refresh`), both `guardAdminPost` and answering with the card's data; Mo's caches follow
within five minutes.

Elsewhere in the admin (ADMIN_DASHBOARD.md §3.5 / §5.22 and §3.4):

- **KPIs** → group „Beratung & Funnel“ → „Home-Gym-Konfigurator“ (handovers, plans, cart value, orders +
  revenue for any KPI period, link „Im Konfigurator öffnen“); „Wie der Umsatz entstand“ has the cross-cut
  row „davon über den Home-Gym-Konfigurator“, and the order list a „Konfigurator“ badge (§6).
- **Gespräche:** a „Konfigurator“ badge on every configurator thread (fired `suggest_replies`,
  `show_gym_plan` or `offer_plan_options`; search for `suggest_replies` lists them all), the tools as
  „Antwort-Chips“ / „Home-Gym-Plan“ / „Produkt-Optionen“, and the latest plan (lines, roles, notes,
  today's prices) above the transcript.
- **Komplettanalyse / Verbesserung:** `chat.configuratorHandover`, `chat.configuratorPlans`,
  `chat.configuratorCarts` and `revenue.viaConfigurator` ([`BUSINESS_SNAPSHOT.md`](./BUSINESS_SNAPSHOT.md));
  the switch `configuratorDiscount` (on = visitors get the offer now) makes switching the discount on or
  off a confounder of chat and journey changes (`SWITCH_EFFECTS`).

## 6. KPIs and attribution

Events (names and data: API_CONTRACT §5): widget `configurator_viewed` (only with Shopify analytics
consent), `configurator_started`, `configurator_handover`, `configurator_answers_changed`,
`configurator_chip_clicked`, `configurator_plan_edited` (`action` qty / variant / remove / restore /
add / add_step), `configurator_cart_added`, `configurator_option_picked` / `_skipped` / `_more`
(step flow), `configurator_validation_blocked` (`fields`, 24.10.2026), `configurator_discount_shown`
(`trigger`) / `_activated` / `_copied` / `_closed` (24.10.2026), `configurator_note_step` (`prefilled`; the
page showed the step „Deine Hinweise“, once per run — 27.10.2026) and `configurator_handover.note`
(`written` / `skipped`); server-only `configurator_chat_started` (`steps`: the step flow was on; `note`:
the context carried a note — a boolean, 27.10.2026),
`configurator_plan_shown`, `configurator_options_shown` (in `SERVER_ONLY_EVENTS`). Ids, enums, counts
and booleans only — never a name, text or e-mail.

- Every funnel stage counts **distinct sessions on its own**: the handover starts a fresh thread
  (anonymous visitors get a new session id like „Neuen Chat starten“), so the stages before and after
  the handover can sit on different session ids. Within the chat (chat → plan → cart → order) the
  session is the same.
- **Started** = once per configurator run: the first answer picked, or — when the link prefilled
  everything — the moment step 04 opens (with a version-1 widget, which gets no step 04, the handover);
  „Neu starten“ begins a new run.
- **Hinweise erreicht** (27.10.2026) = distinct sessions with `configurator_note_step` — counted only for
  a period that starts on or after `NOTE_STEP_FROM` (`kpi-releases.mjs`, the date of the release
  `konfigurator-hinweise-regeln` — one date to re-date to the theme upload; `noteStepCounted`, tested):
  a period across the release mixes runs without the step, whose starts and handovers count, and would
  show a false drop at the new optional step (the default 30-day view for weeks after the upload). Such
  a period leaves the stage out; so does a period without such sessions. **Hinweis vor
  der Beratung** = handovers by `configurator_handover.note` („mit Hinweis“ / „übersprungen“; the card
  shows only with such handovers). The note's **text is never stored** — not in `kpi_events`, not in a
  new column; it lives only in the request context (and in Mo's reply if Mo echoes it).
- **Orders „über den Konfigurator“** — one rule for the Konfigurator screen, the KPI screen and the
  snapshot: a realised `mo_orders` row (PAID / PARTIALLY_REFUNDED) **processed in the period** (order
  date, like „Umsatz durch Mo“) whose **latest consultation row before the order** — the attribution
  anchor (`CONSULTATION_ANCHOR_TOOLS`, written by the order's session) — sits in a thread where Mo showed
  a Home-Gym plan or product options (`CONFIGURATOR_PLAN_TOOLS` = `show_gym_plan` + `offer_plan_options`
  — in the step flow Mo may never show a complete plan). Spelled out in `mo-revenue-store.ts` and
  `configurator-store.ts` (Neon templates are not composable). A later ordinary consultation of the same
  device moves the order out; signed-in customers keep their session id across threads, so the thread,
  not the session, decides. These orders are **inside** „Umsatz durch Mo“ (mostly „Beraten & gekauft“ /
  „Beraten, anderes gekauft“), never added on top. They exist only with the `_mo` marker, i.e. with
  analytics consent ([`ORDER_ATTRIBUTION.md`](./ORDER_ATTRIBUTION.md)); refunds and cancellations after
  payment lower them (orders/updated + orders/cancelled).
- **The plan in the attribution and the selection:** its products enter the discussed products, it
  anchors the attribution window like `show_product`, and the latest plan is the conversation's
  **selection** (`selected_product_ids`, like `add_to_cart` — `recommended-products.mjs`): „Cart
  angeboten“ in Gespräche, „Gespräche mit Produktempfehlung“, the Eingang rule „Kaufabsicht ohne Kauf“
  and the summary cart. A pinned variant (`id~variantId`) counts as its product for „Beraten & gekauft“.
  In the step flow the options' products are discussed products and `offer_plan_options` anchors the
  window like the plan; the selection is the **plan on the page** as the widget sent it with the turn
  (Mo's lines and the visitor's picks — `planSelection` in `persistTurn`), not the offered options —
  unless Mo's own `show_gym_plan` / `add_to_cart` of that turn replaces it; a plan the visitor emptied
  clears the selection down to the latest direct `add_to_cart`, if any (`turnSelection` in
  `recommended-products.mjs`).
- **Plans shown** = `show_gym_plan` calls the widget renders: a call that failed the schema or whose
  lines are all unknown is not counted (`planShownEvents`); unknown lines are left out of the products.
  The funnel stage „Plan erstellt“ counts sessions with a shown plan **or** a picked option.
- **Options shown** = `offer_plan_options` calls with at least one renderable option
  (`optionsShownEvents`, `configurator_options_shown` {step, options, items}) — counted with the
  widget's rule: an option counts only when **every** item is known and available; an option with an
  unknown or sold-out id is left out, and items / products come from the kept options only.
  „Schritt für Schritt“ sets them against the widget's picks (`rank` = the option's position in Mo's
  list, Mo's recommendation is 1 — options the widget left out count too), skips and „Andere
  Vorschläge“ per step.
- **Cart value** = the plan price of the lines that actually landed in the cart (not the plan total).
- **Konfigurator-Rabatt** (card on the Konfigurator screen, `getConfiguratorDiscountKpis`, pure DB):
  „Pop-up gezeigt“ / „Rabatt aktiviert“ / „Code kopiert“ = distinct sessions with the page event in the
  period (an activation from the note above the plan counts too; the rates are against the sessions
  that saw the pop-up, capped at 100 %); „Bestellungen mit dem Code“ = realised `mo_orders` rows (PAID /
  PARTIALLY_REFUNDED) processed in the period whose `discount_codes` contain the **current** code
  (trimmed, case-insensitive) + their revenue. `mo_orders` holds only orders with the Mo marker (analytics
  consent), so orders with the code but without the marker are missing — the InfoTip says so; after a code
  change the old code's orders no longer count. These orders are inside „Umsatz durch Mo“ like any marked
  order, never added on top. `configurator_validation_blocked` is stored but not shown yet (the fields
  visitors miss, for a later look).
- `configurator_cart_added` matches `%cart%`, so it also counts as an add-to-cart click on the KPI
  screen (tested in `kpi-widget-events.test.mjs`); no other configurator event matches a click pattern.
- KPI release markers `home-gym-konfigurator` and `attribution-variants-refunds` (21.10.2026,
  `kpi-releases.mjs`) name the counting changes for periods across the launch;
  `konfigurator-personas` (22.10.2026) the persona card, weight steps and own plan lines (behaviour, no
  counting change); `konfigurator-schritt-fuer-schritt` (24.10.2026) the step flow — „Plan erstellt“
  and the order rule now also count the options; `konfigurator-pflichtangaben-rabatt` (24.10.2026) the
  missing-answer outline and the discount built switched off (behaviour, no counting change). Both are
  dated by the theme upload of 24.10.2026 (live check: widget 7cf0c7d), not by their build days.
  `konfigurator-hinweise-regeln` (27.10.2026) the step „Deine Hinweise“ (a new funnel stage, the existing
  stages count as before), the product rules (pairs, room-sized flooring — plan quantities and cart
  values change) and the availability-based showroom (behaviour); re-date it to the theme upload if that
  comes later. The answer
  distribution „Typ / Trainingsfokus“ counts first-version answers under the mapped persona; the goal card
  has no distribution any more.

## 7. Storefront (theme repo `ms_shopify_clone`)

| File | What |
| --- | --- |
| `sections/ms-home-gym-configurator.liquid` | the landing page: hero (with the photo of the setting `hero_image`, else white) with the partner seals, configurator (three cards with the badges SCHRITT 01–03, persona card with the seals), Mo dock, plan host, „So funktioniert's“, „Starke Partner“; all texts, the photo and the seals are section settings |
| `assets/ms-home-gym-configurator.js` / `.css` | page logic (answer cards, prefill, partner, handover, edit, stepper, KPI; since 24.10.2026 the missing-answer outline and the „Konfigurator-Rabatt“ pop-up + note) and styles — light design after the Performance campaign mail (accent light blue `#008ccb`) in the homepage's structure: sections alternate `#ffffff` / `#f9f9f9`, headings as a blue kicker over a regular-weight headline („Darf in keinem Gym fehlen. / Bestseller.“), no divider lines (second round of 22.10.2026); buttons like the homepage's „MOTION SPORTS – Learn more“ (black pill, blue with a lift, glow and shine on hover; blue on the photo; outline pill as secondary) — no red since the third round of 23.10.2026 |
| `templates/page.home-gym-mo.json` | the page template (assign it to a page, or open any page with `?view=home-gym-mo`) |
| `assets/ms-chat-widget.js` / `.css` | docked mode (`[data-ms-chat-dock]`), `window.MS_CHAT.configurator` (`start`, `update`, `restart`, `track`, `state`, `version` — 2 since 2026-10-27: the note and the product rules are supported; the page shows step 04 only for ≥ 2, API_CONTRACT §2), the `ms-chat:configurator` events, chips, plan card, Mo's option cards (`ms-chat-offer`: „Auswählen“ / „Übernehmen“, „Überspringen“ / „Andere Vorschläge“), plan host („+ Produkt hinzufügen“ with the whole-shop search, „+ Gewichtsstufe“, weights hint, picked lines „Von dir gewählt“), cart add; the homepage buttons in the page plan and the dock only — the floating widget on every other page keeps its look (since 27.10.2026 only its showroom and add_to_cart cards follow the product rules, „Round-6 fixes“ below) |

The existing static guide (`templates/page.home-gym-konfigurator.json`, blocks `ai_gen_block_296597c` /
`fc74bf0`) is left untouched. The widget must render on the page (theme setting „AI Advisor“ on, the
template not in „ausgeschlossene Vorlagen“). Seals: upload the PNGs of Anna in the theme editor (section
→ „Siegel Men's Health“ / „Siegel Women's Health“).

**Texts and the live template.** Shopify stores the section settings (texts, seal images) in the live
template JSON, so a changed default only reaches the page under a new setting id. The round of
22.10.2026 therefore uses new ids for every changed text (`hero_intro`, `seal_caption`,
`partners_label`, `partners_text`, `mo_intro` — the Mo panel's intro without „links“, which was wrong
on phones) and drops the old ones (`eyebrow`, `subheading`, `usp_1…3`, `seal_label`, `coop_eyebrow`,
`coop_text`, `mo_text`); the second round of the same day the same way: `seal_note` („… das
Empfehlungssiegel **von** Men's und Women's Health“) for `seal_caption`, `mo_hello` („Hallo, ich bin
Mo.“) and `mo_lead` (one sentence) for `mo_title` / `mo_intro` — the panel's three checkmark lines are
gone —, plus the checkbox `hero_intro_caps` („Einleitung in Großbuchstaben“, off: the blue line stays
in mixed case, as the client preferred for the long sentence). The third round (23.10.2026) adds
`hero_image` („Bild (optional)“ — Anna's photo; the theme editor's focal point sets the crop) and
`partners_copy` („KI-Home-Gym-Berater“ instead of „KI-Fitnessberater“) for `partners_text`; the progress
labels („Grundeinstellungen“, „Beratung mit Mo“, „Dein Plan“, „Warenkorb“), the step-3 text of „So
funktioniert's“, the badges and the Mo panel's line „KI-Home-Gym-Berater · kostenlos & unverbindlich“
are in the section's code, as are the docked Mo's „Online · KI-Home-Gym-Berater“ and its footer line
(widget, dock only). `templates/page.home-gym-mo.json` must **not** be re-uploaded — that would reset
the uploaded seals and the photo.

**Hero with the photo** (third round): from 750 px a dark banner — the photo fills it from about 30 %
of the width to the right edge (38 % up to 989 px) and fades into the dark on the left, so the rack
never sits under the copy (white headline, light-blue kicker, the blue button); the seals sit half on
the photo's lower edge, the caption next to them on white. Phones: the photo on top (16:10), then the
copy and the seals on white. Without a photo the white hero of the second round stays.

**Step by step on the page:** Mo's options appear as cards in the docked chat (picture, name, price,
the lines of a bundle, badge, ✓ pros and – cons); a pick puts the lines into the plan on the page —
also when Mo showed no plan yet (the plan then starts as „Dein Home-Gym-Plan“ of the visitor's
lines) — and a pick in a single-select group replaces the earlier pick of the same step, also from an
earlier group („Ich nehme stattdessen: …“; accessories, extras and multi-select groups add). In a
configurator thread continued on another shop page (no plan host) a pick shows the visitor's plan as a
plan card in the chat. The sign-in and e-mail popups wait
in a configurator thread until Mo shows a complete plan, so in the step flow they do not interrupt
(the header's „Anmelden“ / „Per E-Mail teilen“ stay available).

**Missing answers** (fourth round, 24.10.2026): the main button („Weiter – Mo berät mich“ then, „Weiter“
since round 6) stays clickable while required
answers are missing — `aria-disabled="true"` with the disabled look, not the `disabled` attribute, which
would swallow the click (the edit mode „Ändere eine Angabe …“ and the unavailable mode are unchanged). A
click (or Enter) with answers missing outlines every incomplete card in the page's error red (2 px, the
card's radius — the only red on the page besides error text) and puts a short line at each missing field
(„Bitte wähle deine Fläche aus.“, DE / EN; the field group `aria-invalid`, `aria-describedby` to its
line; one `role="alert"` announcement per click, not one per field); the first incomplete card scrolls
into view below the sticky header (smooth unless reduced motion) and its first option gets the focus; the
hint under the button names what is open as before. A field's line and outline go as soon as it is
answered (the card's outline when the card is complete); there is no outline before the first click, and
every click validates again. KPI `configurator_validation_blocked` { fields } — the missing field keys as a
comma list — through the page's `track()`. 320–1920 px, DE and EN.

**Konfigurator-Rabatt on the page** (fourth round; nothing changes without an offer — no markup, no
flash): the page fetches `GET {apiBase}/api/configurator/offer` once on load (origin request, no secret;
a failure = no offer). Trigger `start`: about one second after a successful handover; `plan`: at the
first `ms-chat:configurator` event that reports a plan with at least one line. Once per browser and code
(`localStorage` `ms-hgk-discount-<code>`). The pop-up is a modal dialog in the page's design (labelled,
focus moves in and back, Esc / backdrop / × close): the blue kicker „Dein Konfigurator-Vorteil“ („Your
configurator benefit“), the title, the text, the code in a code box with „Code kopieren“ (secondary
pill, „Kopiert ✓“), the primary pill „Rabatt aktivieren“ — `fetch('/discount/' + code, { redirect:
'manual' })` on the shop's own origin (the 302 that sets Shopify's discount cookie is the answer), so
Shopify keeps the code for the checkout — then „Aktiviert ✓ – wird an der Kasse abgezogen, sobald die
Bedingungen erfüllt sind.“, and the terms in small print (also read out when the pop-up opens). An offer
without terms is not shown. Afterwards a slim note directly above the plan host keeps title, code,
„Aktivieren / Aktiviert ✓“ and the terms (the activated state survives a reload). Buttons per the third
round (black / blue pills, no red). KPI events `configurator_discount_shown` { trigger },
`_activated`, `_copied`, `_closed` (§6).

**Round 6 on the page and in the widget** (27.10.2026, client review — the shared spec; the theme's
MANIFEST lists the files): the seals as one block with the sentence (regular weight; since 29.10. below
the seals, „Hero seals after the client's picture“ below), large, top right inside the hero by default — new setting `seal_position` („Oben rechts“ / „Unten rechts“, one
modifier class on the hero); the plan box „Dein Home-Gym-Plan“ dark blue with white text (token
`--hgk-navy` = `--hgk-step-3` `#00577f`, the widget reads `var(--hgk-navy, #00577f)`); „Ändern“ / „Neu
starten“ as outline pills; the step timeline in its own container above the chat (desktop) with five
steps; step 04 „Deine Hinweise“ (§1). The widget applies the product rules of `GET /api/products` (lines
normalised from the tool input and on restore, the stepper moves by `step` and never below `min`, „+
Produkt hinzufügen“ adds `min`, the cart add uses them — the old pair heuristic only for a backend
that sends no `rules` field at all; flooring lines may show „deckt ca. N m²“) and shows the
`suggest_showroom` card only for products with `showroom: true` (nothing when none; an old backend
without the field: as before).

**Hero seals after the client's picture** (29.10.2026, theme only — the theme's MANIFEST entry of that
day): the seal block has no box any more (no background, border, blur or shadow); Women's Health left,
Men's Health right, the sentence `seal_note` centred below them on three lines, white, regular weight.
From 1200 px it sits on the photo sized after the picture (seal `clamp(120px, 10.65 % of the hero,
230px)`, gap 0.343 × seal); the photo placement keeps the old block geometry, so intro, headline, CTA,
banner and photo are unchanged. „Unten rechts“ adds a soft darkening behind the text for contrast. The
picture is matched with square seal PNGs cropped tight to the seal's width. No setting id, no template
change, no widget or backend change.

**Seals 2×, sentence ½** (30.10.2026, theme only — MANIFEST entry of that day, on the maintainer's request):
the seal box doubles where it fits (on the photo from 1200 px `clamp(240px, 21.3 % of the hero, 460px)`,
300–400 px at 750–1199; phones and the white hero from 1200 px keep their size — the row or the headline
leave no room); the gaps between the seals, the edge margins and the gap to the sentence keep their previous
values; the sentence is half its size with a 12 px floor. A soft radial darkening behind the sentence keeps it
at ≥ 4.5:1 on the photo; the active partner seal (1.06) grows away from its neighbour; at 750–1199 the banner
grows by exactly the taller seal row, so the copy does not move. The seals now cover part of the rack and the
plant on the photo (accepted). Seal images are requested up to 920 px wide.
Seal PNGs with a transparent margin (30.10. evening, after the upload: seals and sentence stood far apart —
every gap on the page is the layout's gap plus the PNGs' margin): theme setting `seal_trim` („Leerer Rand in
den Siegel-Bildern“, 0–30 % per side, default 0 = unchanged) shrinks the hero's seal box to the artwork
(`--hgk-seal × (1 − 2 × trim)`) and draws the image larger inside it, clipped — the seals keep their visible
size, the gaps and the sentence's distance become the designed ones; a value too high cuts the seals' edges.

**Round-6 fixes** (27.10.2026, after the adversarial review — decisions the backend, the widget and the
page implement identically; API_CONTRACT §2 / §3): coverage means „whole room“ (a published
`coverageM2` is always sized to the room); a floor line holds up to 200 pieces, any other 20; only one
floor product is sized to the area (two → Mo works out the counts); `rules` on every product and card
(`{}` = one by one); edge-piece and connector variants (`NON_TILE_VARIANT`, mirrored byte for byte in
the widget) have no coverage and no „Deckt ca.“ hint; one note cleaner (ZWNJ / ZWJ kept); the widget
declares `features: ["options", "rules"]` and `MS_CHAT.configurator.version: 2`. In the widget besides:
the showroom card without product names while the list is unknown (`showroomKnown: false`); the
add_to_cart card shows „2× “, „Paarweise“ and the line total for a product with `rules.min` > 1 — what
the checkout link buys; the limit note on a removed plan line is no longer dimmed. On the page: no step
04 with a version-1 widget (and a note the old widget dropped is not shown as taken), the step-04 intro
hint („← Noch ein optionaler Hinweis, dann übernimmt Mo“), the hero photo clamped to the banner, the
copy / rack / seal block fitted from 1200 to 1600 px, the note field tall enough at 280–360 px, a
reload during a run counting `configurator_started` / `configurator_note_step` once, the step-04 badge
in `--hgk-muted`, the timeline scrolled into view after „Weiter“, and the EN CTA „Continue – Mo advises
me“.

**Persona tiles:** every title on two lines (a fixed break, `|` in the page's vocabulary — hidden on
phones, where each tile is one row), the subtitles of the client (second round: „Platzsparende
Fitnesslösungen für den optimalen Einstieg.“, „Vielseitige Fitnessgeräte in erstklassiger Qualität.“,
„Stärke gezielt und progressiv weiterentwickeln.“, „Langfristig fit, gesund und aktiv bleiben.“) — the
same texts as `subDe` in `configurator-core.mjs`, which Mo reads in the answers line.

Screenshots (local harness: the real section and widget, Mo's dialogue mocked, placeholder seals):
[`screenshots/konfigurator/`](./screenshots/konfigurator/) — storefront after the third round of
23.10.2026 (`storefront-r3-*`: the photo hero at 1440 / 1024 / 390 px, the step badges, Mo's options
for the base unit, accessories and weights, the plan built from picks, the whole-shop search) and the
second round of 22.10.2026 (persona card, Mo's panel, handover on the phone, plan with weight steps
and own lines, „So funktioniert's“, „Starke Partner“), admin 1440 / 1024 px in light and dark
(`admin-konfigurator-*`, as of 24.10.2026: „Schritt für Schritt“, the persona distribution with
first-version answers mapped, the card „Konfigurator-Rabatt“ in „Wirkung“ and its settings block;
`admin-rabatt-einstellung-1440-*`, `admin-rabatt-kpi-1440-*`, `admin-rabatt-validierung-1440-light` —
„Aktiv“ with nothing filled and an invalid code); the KPI integration (`kpi-section-*`, `kpi-umsatz-wege-*`,
`kpi-bestellungen-*`, `gespraeche-plan-*`) on local seed data.

## 8. Limits

- The plan is rendered from Mo's tool input; prices and stock come from `/api/products` (catalog sync,
  daily + webhooks) — the cart itself is the shop's truth (a refused line is named, the rest lands).
- Budget and wishes are learned in the conversation (chips are text); only `configurator_chip_clicked`
  records the topic. The answer distribution covers the page's answers.
- Page views need analytics consent; without it the funnel starts at „Konfigurator begonnen“.
- A configurator thread with the step flow (`features: ["options"]`, the configurator switched on in
  Konfigurator) takes up to 80 messages per request (40 elsewhere, API_CONTRACT §2) — every pick, swap, skip and „Andere Vorschläge“ is a user
  turn. Beyond that the widget offers a new chat.
- Product rules (§4a): a floor line holds at most 200 units (any other line 20 — also every line of an
  older widget without the feature `rules`), so a very large room in small tiles (more than 50 m² of
  0,25 m² tiles) can stay partly uncovered — the tool reports `missingM2` / `neededQuantity` and Mo says
  so or picks a larger tile or a set. Two floor products are never sized by the system (Mo works out
  their counts; `coverage` reports what is missing). The description is a coverage source only for
  products whose name says they are floor tiles, and only with explicit units. The sales unit
  (`custom.liefereinheit`) arrives with the live catalog sync; the bundled fallback catalog does not
  carry it (the rules give the same result without it — checked). Mail cart links (summary, marketing,
  the 1:1 draft) carry the rules' minimum too (`buildPrefilledCartUrlForIds`). The rule hint „für die
  ganze Raumfläche planen“ on a floor product's line is generic; in a rented flat the configurator
  guide narrows it to the training area (§4a). Two rare cases where page and tools can still differ
  until Mo's next plan: a line Mo pinned to an edge piece (`~variant`) that the visitor switches to a
  tile variant keeps the edge piece's rules on the page (no „Deckt ca.“, at most 20); and a floor
  product named by its plain id whose tile variant is sold out — the page takes the first available
  variant (an edge piece, no coverage), the tools size the default variant.
- Showroom (§4b): without the scope `read_themes` only the manual list applies; a theme change reaches Mo
  with the next refresh (daily, or „Jetzt aktualisieren“) plus up to five minutes of cache.
- The customer's note itself is not stored: it travels in the configurator context of each request.
  It lands in the conversation only where the visitor's update message („Hinweis: …“ after „Ändern“) or
  Mo's reply contains it — under the conversation's retention like any message.
