# Backend task: newsletter opt-in reward, sign-in teaser, value-moment ask, § 7 Abs. 3 UWG prep (2026-10-08)

This is for the backend agent that owns `4motionsports-GmbH/mo`. That agent owns `docs/frontend/API_CONTRACT.md`, `ACCOUNT_CONTRACT.md`, `CONSENT_CONTRACT.md`, `docs/ANWALTSDOSSIER.md` and `npm run verify:live`.

It comes from the theme/widget repo `ms_shopify_clone`, which has the frontend spec for the widget round of 2026-10-08. Where this file and the uploaded widget source (`assets/ms-chat-widget.js`) disagree, the source wins. Ask before you build on a difference.

**How sure each statement is**
- Backend facts carry `file:line` in `mo`. They were checked against the local clone at `17eccf3`. That clone is **shallow**: `git rev-parse --is-shallow-repository` → `true`, 81 commits.
- Shopify behaviour that nobody could check against the live shop or the Shopify docs is marked **[unverified]**. Each such item says how to verify it.
- Legal points are research input for counsel, not legal advice. Sources: `legal.md` research report of 2026-10-08, summarised in §8.

---

## 0. Summary

### 0.1 What the owner wants
The newsletter sign-up reward should be advertised **as attractively as possible** at the right moments.

**Already decided by the owner:**
- **All four options are wanted:**
  1. advertise the reward on the chat's consent ask (popup and inline card);
  2. a **value-moment** opt-in ask after Mo has helped with a product;
  3. a **teaser** about the reward on the anonymous sign-in surfaces (login popup, welcome sign-in card);
  4. **prepare** e-mail advertising to existing customers under § 7 Abs. 3 UWG.
- **Pre-selection is rejected.** No pre-ticked box and no default "yes", anywhere. This includes the Shopify checkout marketing checkbox (see the Owner to-do list). Planet49 (C-673/17) and BGH I ZR 7/16 make a pre-ticked box invalid consent, however much it is explained. CONSENT_CONTRACT §1 already forbids it.

### 0.2 Decisions still OPEN for the owner (each blocks the step named)

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| O-1 | **Reward amount and design** | Replace the current **5 %** with a **fixed euro amount**. Either one fixed amount (e.g. **50 € from 500 € order value**) or **tiers advertised as „bis zu 100 €“** (25 € from 250 € / 50 € from 500 € / 100 € from 1,000 €). See the margin table below. | T3 copy, T1 code settings |
| O-2 | **Who issues the codes**: the Shopify automation, or the Mo backend | **(a) the Shopify automation as the only issuer now**; (b) the backend as issuer in phase 2. See T1. | T1, T5, T6 |
| O-3 | **Validity** | **30 days** from issue. A reminder around day 21 is fine because the customer is subscribed. | T1 |
| O-4 | **Code type** | **Unique, single-use code per customer.** A shared code (e.g. `WELCOME5`) leaks to coupon sites. | T1 |
| O-5 | **Exclusions** | **Sale items and Concept2, stated the same way everywhere**: footer, `/pages/rabatte`, popup, chat badge and terms, welcome e-mail, Mo. Enforce them technically with an "eligible" collection. | T1, T3, Owner to-do |
| O-6 | What counts as "first sign-up" (Erstanmeldung) | One code per Shopify customer, ever. No new code after unsubscribe and resubscribe. After an erasure, accept that a second code is possible (unless counsel allows a hashed ledger, T2.6). | T1, T2 |
| O-7 | Whether checkout subscribers and admin-imported or API-created subscribers get the code | Checkout subscribers: owner's choice (a code right after a purchase rewards nothing incremental). Imported: no. | T1, test cases 7 and 15 |
| O-8 | Goodwill rule for buyers who order before their code arrives | Optional policy. If adopted, write it down; it creates expectations. | none |
| O-9 | Go/no-go on § 7 Abs. 3 UWG | This reverses the client decision of 16.06.2026 (OQ-06). Build nothing until counsel answers. | T7 |

**Recommendation on O-1.** The source is `legal.md` §5: Jonah Berger's "Rule of 100", plus the margin maths below.
- Above about 100 €, a fixed amount feels bigger than the same value as a percentage. „85 € Willkommensbonus“ reads stronger than „5 %“ on a 1,699 € treadmill, even though both are worth the same.
- A percentage also gives away the most margin on the largest baskets.
- **„bis zu“ is defensible only if the top tier is realistic for an appreciable share of orders.** Sources: LG Frankfurt 2-06 O 050/21; BGH I ZR 170/80.
  - Before choosing tiers, the owner should check the share of orders ≥ 1,000 € (Shopify Analytics → orders by value). For treadmills it is plausible, but it has not been checked.
- **Technical caveat on tiers [unverified].** A native Shopify "amount off order" code has, as far as is known, **one** value and **one** minimum requirement.
  - A single code that pays 25/50/100 € by basket size probably needs a discount Function (custom app). The alternative is three codes plus an app-side "only one of the three" rule.
  - Shopify Email's welcome automation very likely cannot do tiers at all.
  - **So:** with design (a), the fixed amount (one tier) is the realistic choice. Tiers fit design (b) or a Function.
  - **Verify:** Shopify Admin → Discounts → Create → "Amount off order", and check whether more than one tier can be configured.

**Margin table.** It assumes a 1,699 € gross treadmill, 19 % VAT, a net price of 1,427.73 € and a 30 % gross margin, which gives 428.32 € net margin. **The real margin is unknown**; this is for illustration only.
- Break-even = net cost ÷ margin left. It is the share of redemptions that must be orders that would not have happened anyway.

| Reward | Gross value | Net cost | Margin left | Share of margin given away | Break-even (incremental share needed) |
|---|---|---|---|---|---|
| 5 % (today) | 84.95 € | 71.39 € | 356.93 € | 16.7 % | 20 % |
| 10 % | 169.90 € | 142.77 € | 285.55 € | 33.3 % | 50 % |
| 50 € fixed, min. order 500 € | 50 € | 42.02 € | 386.30 € | 9.8 % | 10.9 % |
| 100 € fixed, min. order 1,000 € | 100 € | 84.03 € | 344.29 € | 19.6 % | 24.4 % |
| Tiered 25/50/100 € at 250/500/1,000 €, on this 1,699 € basket | 100 € | 84.03 € | 344.29 € | 19.6 % | 24.4 % |

**The same tiers at their thresholds** (same 30 % assumption, computed here, not in `legal.md`):

| Order (gross) | Tier | Net margin | Net cost | Share of margin given away | Break-even |
|---|---|---|---|---|---|
| 250 € | 25 € | 63.03 € | 21.01 € | 33.3 % | 50 % |
| 500 € | 50 € | 126.05 € | 42.02 € | 33.3 % | 50 % |
| 1,000 € | 100 € | 252.10 € | 84.03 € | 33.3 % | 50 % |

**Reading the tables**
- At each threshold the tier is worth 10 % of the order, which is one third of a 30 % margin.
- Tiers are cheap on baskets well above a threshold and expensive on baskets just above it.
- A single fixed 50 € from 500 € is the cheapest option per redemption.
- Once the reward is advertised on every surface, **cannibalisation** is the main risk: most buyers will subscribe and redeem. Measure the incremental lift with a hold-out (T6) before raising the amount.
- **Non-cash alternatives** have the same transparency duties (§ 6 DDG). Examples: a free floor-protection mat, free assembly, an extended warranty.

### 0.3 State in one paragraph
**Widget:** shipped **dormant**. With today's backend (copy `v5`, no new fields) it behaves exactly as before, apart from two hardening fixes.

**Backend today has:**
- no welcome-code feature. It was **retired on purpose** because of alias abuse: `docs/CUSTOMERS.md:266-275`; `docs/archive/CONSENT_SIGNOFF_HISTORY.md:358-366`.
- a system-prompt rule that forbids Mo to mention any welcome discount (`src/lib/system-prompt-core.mjs:164-175`);
- a copy ceiling that forbids discount amounts.

**Where the 5 % welcome code comes from:** a Shopify-side automation or app, not Mo, and not the theme (`theme.md` §5). Mo's DOI confirmation writes `SUBSCRIBED`/`CONFIRMED_OPT_IN` to Shopify with a fresh `consentUpdatedAt`, so it **probably already triggers that automation** [unverified, T1].

**Order of work:**
1. Settle who issues codes (T1).
2. Make "only once" hold (T2).
3. Get counsel's sign-off (T8).
4. Only then serve the reward fields (T3) and switch Mo's prompt (T4).

---

## 1. Baseline

**Widget**
- Main is at `bc7fb5d`. The reward round of 2026-10-08 has been uploaded **dormant**.
- **Upload date: `<UPLOAD-DATE>`.** Fill this in from the top entry of the theme's `MANIFEST.md` once the owner has uploaded. Until then, treat the widget as not live and confirm it with `npm run verify:widget` and the fingerprint markers in §2.6.

**Today's flow, without v6 fields** (frontend `docs/frontend/04-accounts-sign-in-and-consent.md`; backend ACCOUNT_CONTRACT §6.1–6.2, CONSENT_CONTRACT §3):
- The signed-in consent ask shows as a **popup** 700 ms after the first send of a tab session (placement `popup`).
- After a chat sign-in return in the middle of a conversation, it shows as an **inline card** (placement `signin_return`).
- Anonymous visitors see the **login popup** (`presentLoginGate`) and the **welcome sign-in card** (`buildSignInCard`). Neither carries served text today: the text is `ACCOUNT_COPY` widget chrome.

**Theme**
- New, dormant: `snippets/ms-marketing-objection-notice.liquid`.
- It renders in the cart drawer and on the cart page only when the theme setting **„Widerspruchshinweis im Warenkorb“** (`settings.ms_uwg73_notice`, group "Marketing-Hinweise") is filled.
- It is empty, so it renders nothing.

## 2. What the widget now reads and does (the contract the backend must serve)

### 2.1 New optional fields on `GET /api/consent-copy?surface=signin` (backend copy v6)

```jsonc
"reward": {                 // optional. Rendered all-or-nothing: badge AND terms must both be valid
  "badge":       "…",       // string, trimmed non-empty, ≤ 60 chars
  "terms":       "…",       // string, trimmed non-empty, ≤ 300 chars
  "termsUrl":    "https://…", // optional. Rendered only if the widget's safeHref() accepts it (http/https/mailto)
  "teaser":      "…",       // optional, ≤ 160 chars. Anonymous sign-in surfaces only
  "afterAccept": "…"        // optional, ≤ 200 chars. Success view after accept, outcome 'pending' or 'other' only
},
"valueMoment": {            // optional. Present and valid → the signed-in ask switches to value-moment timing
  "lead": "…"               // trimmed non-empty, ≤ 200 chars
}
```

These are the example strings from the frontend spec. They are **placeholders until O-1 and counsel decide**:

```jsonc
"reward": {
  "badge": "Bis zu 100 € Willkommensgutschein",
  "terms": "Für deine erste Newsletter-Anmeldung, nach Bestätigung per E-Mail. 25 € ab 250 €, 50 € ab 500 €, 100 € ab 1.000 € Bestellwert; einmal einlösbar, 30 Tage gültig; nicht für reduzierte Artikel und Concept2.",
  "termsUrl": "https://www.motionsports.de/pages/newsletter-gutschein",
  "teaser": "Melde dich an und sichere dir bis zu 100 € Willkommensgutschein.",
  "afterAccept": "Dein Gutschein kommt per E-Mail, sobald du deine Anmeldung bestätigt hast."
},
"valueMoment": { "lead": "Gefällt dir die Empfehlung? Hol dir deinen Willkommensgutschein für die Bestellung." }
```

The page `/pages/newsletter-gutschein` **does not exist** in the theme (`templates/` has `page.newsletter*.json` and `page.rabatte.json` only). Either the owner creates it, or `termsUrl` is omitted.

**Validation in the widget** (helpers `servedReward(c)`, `servedValueMoment(c)`)
- `reward` becomes `null` when any of these is true:
  - `c.reward` is missing or not a plain object;
  - `badge` or `terms` is invalid;
  - **`LOCALE === 'en' && c.enLegalReviewed !== true`**.
- Invalid optional sub-fields (`termsUrl`, `teaser`, `afterAccept`) are dropped one by one. They never invalidate the reward.
- `valueMoment` follows the same EN rule.
- **Both require `c.lawyerApproved === true`** at every call site, including the anonymous login popup and the welcome card.
- **EN consequence for the backend.** The backend serves `enLegalReviewed: true` for `en` today (`CONSENT_COPY_EN_LEGAL_REVIEWED = true`, `src/lib/consent-copy-core.mjs:25`), so the widget **would render an English reward**.
  - The flag is global and covers the existing translations (D-AP3 / F-12, 05.10.2026), not a new reward text.
  - **Serve `reward` / `valueMoment` for `locale=en` only once counsel has confirmed the EN reward text. Until then, omit the keys for `en`.**
- **Neither field is ever part of `consentTextShown`**, and the widget echoes `consentTextShown` byte for byte. So `resolveConsentCopyVersion` (route `src/app/api/account/marketing-opt-in/route.ts:131-134`) keeps working unchanged.

### 2.2 Where each field renders

| Field | Surface | Placement in DOM | Class |
|---|---|---|---|
| `reward.badge` | Consent popup (`presentConsentGate`) and inline card (`buildMarketingOptInCard`, incl. `value_moment`) | before the headline (after the logo in the popup; after the value-moment lead in the card) | `div.ms-chat-reward-badge` (gift icon + text) |
| `reward.terms` (+ `termsUrl` link „Bedingungen“ / "Conditions") | the same consent surfaces | after `benefits`, **before** `marketingLabel` | `div.ms-chat-reward-terms` |
| `reward.afterAccept` | success view of popup and card, outcome `pending` or `other` (not `already`) | below the existing body text | `p.ms-chat-reward-after` |
| `reward.teaser` (+ terms + link) | **Login popup** `presentLoginGate()`: after the benefits list. **Welcome sign-in card** `buildSignInCard()`: above the CTA | — | `div.ms-chat-reward-teaser` + `div.ms-chat-reward-terms` |
| `valueMoment.lead` | inline card with placement `value_moment` only, at the top of the card body | — | `div.ms-chat-vm-lead` |

**Order on the consent surfaces** (CONSENT_CONTRACT §3.1, extended):
[popup: logo] → value-moment lead (card `value_moment` only) → **reward badge** → headline → benefits → **reward terms (+ link)** → marketingLabel → consentFooter → Impressum/Datenschutz → error → accept → decline.

Nothing widget-authored sits between the headline and `marketingLabel`. Without `reward` the DOM is exactly today's.

**Anonymous surfaces now fetch the sign-in copy.**
- **Login popup:** waits **at most 1200 ms** for `fetchSignInConsentCopy()` (same function, single header `x-ms-session`), then presents with or without the teaser. Eligibility is re-checked after the wait.
- **Welcome card:** built immediately. The teaser is inserted later if the copy arrives while the card is still shown, the visitor is still anonymous and the session id is the same.
- **Backend impact:**
  - more `GET /api/consent-copy?surface=signin` from anonymous sessions, in the `products` bucket (60/60 s per key);
  - variant assignment by `x-ms-session` now also happens for anonymous sessions.
  - **Verify** that the anonymous `sid` survives the chat sign-in (ACCOUNT_CONTRACT §1/§2a). If it does, the teaser variant and the later consent variant match. If it does not, the teaser's `variant` and the consent ask's `variant` can differ, and T6 must not assume they match.
- The header „Anmelden“ pill and the account-menu link are **unchanged** (no teaser).

### 2.3 Value-moment timing (placement `value_moment`)

The mode is active when `servedValueMoment(c)` is valid **and** `lawyerApproved === true`.

**a) Popup suppressed** (`maybeShowConsentGate`)
- After fetching the copy, if value-moment mode is on and sessionStorage `ms-chat-signin-returned !== '1'`, the consent **popup is not presented**.
- In that case no `GATE_SS_KEY` is set and no KPI is sent.
- **Exception:** the visitor completed a chat sign-in return in this tab (`handleAuthReturn` sets `ms-chat-signin-returned = '1'` on success). Then today's behaviour stays (popup / `signin_return` card), because they signed in expecting the offer.

**b) The ask** (hooked at the end of `finalizeStream`)
- It needs **all** of these:
  - a clean finish (not the network-error path, see H-1) and `!streamErrored`;
  - the same `sid`;
  - a live user turn (`opts.userMsg`; not the nudge greeting);
  - the finished parts contain `tool-show_product`, `tool-compare_products` or `tool-add_to_cart`;
  - the panel is open, `!voiceMode`, no dialog open, `!state.rateLocked`;
  - `auth.settled && auth.signedIn`;
  - `optInActionable()`;
  - `ms-chat-optin-ask-shown !== '1'`;
  - no pending opt-in card;
  - not already shown on this page view.
- It then fetches the copy, re-checks everything and appends a **new assistant row** with `buildMarketingOptInCard('value_moment')`.
- The card behaves like the `signin_return` card:
  - POST `placement: "value_moment"`;
  - decline → 30-day device snooze;
  - shown → sets `ms-chat-optin-ask-shown`.
- At most **once per tab session**. Never from restored history, never in voice mode, never while a dialog is open. The card is never saved into history.

**Without `valueMoment` there is no value-moment ask.**

**Backend facts that matter here**
- `value_moment` is already an accepted placement: `SIGNIN_PLACEMENTS`, `src/lib/consent-variants.mjs:18`.
- The admin dashboard labels it „Wertmoment“ (`ConsentGateSection.tsx:46`).
- Its `consent_gate_shown` / `_declined` (`surface: "signin"`) **count toward the shared anti-nag cap**: 3 shown sessions or 1 decline in 30 days (`src/lib/signed-in-identity.ts:88-103`). There is no per-placement rule. This is intended: one cap for every signin ask.

### 2.4 KPI additions (widget events, stored verbatim by `/api/kpi`; no allow-list change needed)

| Event | `data` today | `data` new |
|---|---|---|
| `consent_gate_shown` / `_accepted` / `_declined` / `_dismissed` | `{surface:"signin", placement?, variant?}` | adds **`reward: true`** when the reward rendered on that ask, otherwise the key is absent. `placement` may now be **`"value_moment"`** |
| `login_gate_shown` | `{}` | **`{teaser: true, variant?}`** only when the teaser rendered (`variant` = `servedVariant(c)` when valid), otherwise `{}` |
| other `login_gate_*`, `account_signin_*` | unchanged | unchanged |
| welcome-card teaser | — | **no KPI** |

**Notes**
- ids, enums and booleans only. No server-only names, no new request header.
- The dashboard's `normalizeConsentVariantRows` (`src/lib/kpi-widget-events.mjs:226-254`) shows unknown variants as „unbekannt“. Register new variant ids (T3).
- **Audit note:** the POST body is **unchanged**. It does not say whether a reward was shown. The only trace is `reward: true` on `consent_gate_accepted` of the same session id (KPI, not the consent record). Whether "incentive shown" must be part of the Art. 7 evidence is a counsel question (T8, like F-38 b).

### 2.5 Hardening that is active with today's backend

- **H-1:** `finalizeStream` is also reached from the network-error catch when partial content arrived.
  - In that case the widget now skips both `moAttrRenew()` (the attribution renewal) and the value-moment hook.
  - Backend effect: slightly fewer attribution renewals on broken streams. This is correct per API_CONTRACT §10.
- **H-2:** `mktDecisionQuiet()` now also treats `{state:'accepted'}` recorded within the last **24 h** (localStorage `ms-chat-mkt-decision`) as quiet.
  - A second tab whose `/api/auth/me` predates the accept therefore does not ask again and trigger a second DOI mail.
  - Within one tab, the accept button never POSTs twice.
  - **This reduces duplicates on one device only. It does not replace server-side idempotency (T2).**

### 2.6 Fingerprint markers (for `verify:widget` / `check-live-widget.mjs`)
- New literals in the served widget file: **`ms-chat-reward-badge`** and **`ms-chat-vm-lead`**. Add them to the live-widget check so the backend can tell when the dormant round is live.
- Existing markers (e.g. `ms-chat-optin-benefits`) are unchanged.

---

## 3. Goal and KPI

**Goal.** More confirmed newsletter opt-ins from chat visitors, without new legal risk and with **exactly one welcome code per customer across all paths**.

**KPI**, read in the admin dashboard „Einwilligung“ section and in `verify:live` section 3:
- confirmed opt-ins per eligible signed-in session, by variant × placement;
- the login-popup teaser's effect on the sign-in rate;
- code redemption share;
- incremental lift against hold-out variant `a`.

T6 has the details.

## 4. Contract references

| Contract | Section | Change |
|---|---|---|
| API_CONTRACT | §7.4 `GET /api/consent-copy` (line 1499) | add `reward`, `valueMoment`, `version: "v6"`, the EN rule, and the "never part of `consentTextShown`" rule |
| API_CONTRACT | §5 `POST /api/kpi` (line 1100) | `consent_gate_*` gets `reward?: true` and `placement: "value_moment"` (now sent); `login_gate_shown` gets `{teaser?: true, variant?}` |
| API_CONTRACT | §0 rules | unchanged; restate rule 11 (anonymous sign-in chrome is widget text) with the exception that the **teaser** is served |
| API_CONTRACT | Appendix A | entry for v6 |
| CONSENT_CONTRACT | §1 (copy ceiling, line 62) | „no concrete discount amount“ stays for headline and benefits; an **exception for the served `reward` block**, only while `lawyerApproved` covers it |
| CONSENT_CONTRACT | §3.1 (line 97) | the extended render order (§2.2) and the success-view `afterAccept` |
| CONSENT_CONTRACT | §3.2 (line 120) | `value_moment` is now sent; timing rules of §2.3 |
| ACCOUNT_CONTRACT | §6.1 (line 356) | anti-nag counts `value_moment`; value-moment mode suppresses the first-send popup |
| ACCOUNT_CONTRACT | §6.2 (line 410) | only if T2 changes the meaning of `doiEmailSent` within a cooldown (see T2.1) |
| Playbook | `docs/frontend/07-feature-and-kpi-playbook.md:136` (frontend copy of the ceiling) and backlog **D6** (~:470) | D6 done; ceiling exception as above |

## 5. Backend state (verified in code, `mo` @ `17eccf3`)

**Opt-in route** (`src/app/api/account/marketing-opt-in/route.ts`)
- Guard: `requireSignedInCustomer`, `chat` bucket.
- Steps:
  1. `isEmailAlreadySubscribed` (:141);
  2. `upsertEmailCapture` (:143-152);
  3. `recordMoOptIn` (:167-173);
  4. DOI mail via Resend (:180-217);
  5. answer `optInAnswer`.
- `placement` / `variant` go to the KPI only. **There is no `optInActionable` check in the route and no lock.**

**DOI decision** (`decideCaptureDoi`, `src/lib/email-capture-core.mjs:34-71`)
- "Ticked, not suppressed" → **always a new token and a new mail, even while pending** (:52-59).
- This is tested as "re-request" (`email-capture-core.test.mjs:73`).

**Upsert** (`src/lib/email-capture-store.ts:209-276`)
- SELECT, then `INSERT … ON CONFLICT (email) DO UPDATE`, **unconditionally**, overwriting `doi_token` / `doi_sent_at`.
- Not atomic: two concurrent POSTs both send a mail.
- The anonymous capture form (`/api/capture-email`) uses the same store.

**Confirm** (`confirmMarketingByToken`, `email-capture-store.ts:319-354`)
- Status check, then an **unconditional** `UPDATE … WHERE id` (:347-352).
- Expiry: `MARKETING_DOI_EXPIRY_DAYS` (default 7, :49).
- `recordDoiConfirmed` (`src/lib/consent-flows.ts:83-100`) applies `subscribed` / `confirmed_opt_in` with `at = new Date()` at confirm time (:91) and runs the Shopify outbox inline.

**Shopify write** (`src/lib/shopify-outbox.ts:113-133`)
- `customerEmailMarketingConsentUpdate` with `SUBSCRIBED` + `CONFIRMED_OPT_IN` and `consentUpdatedAt = payload.at` (:126). That is the confirm time, so **fresh**.
- `customerCreate` with the same consent for Mo-only people (:149-192).
- `pending` is never pushed.
- On in production since 02.10. (`SHOPIFY_CONSENT_WRITEBACK=true`, `ROLLOUT_TODO.md` 1.1).

**Shopify consent webhook** (`src/lib/shopify-webhook-customers.ts:95-110`)
- A consent change for a customer **not yet mirrored** is dropped (`ignored:unknown-customer`).
- This is the likely root of **C.29** (`ROLLOUT_TODO.md:787`): a shop sign-up stays PENDING in Shopify, Mo sees nothing, and the chat asks again → two confirmation mails.

**Welcome code**
- Retired: `src/lib/shopify-discounts.ts:170-175`; `docs/DISCOUNTS.md:42-49`; `docs/CUSTOMERS.md:266-275`.
- The migration `0009` columns `welcome_code*` / `welcome_issued_at` are read-only. Their only reader is the chat memory (`src/lib/customer-memory.ts:66-72`).
- `createUniqueDiscountCode` (`shopify-discounts.ts:197-271`) exists for `MS5-` / `MK-` (percentage, `customerSelection:{all:true}`, `usageLimit:1`, `appliesOncePerCustomer:true`, 7-day `endsAt`).
- **The local clone is shallow.** The retired `WELCOME-` minting code is not in local history; its earliest local commit `bf194c9` already only documents the retirement. Recover it with `git log --all -S WELCOME_DISCOUNT -- src` in a **full** clone of `4motionsports-GmbH/mo`.

**Mo's prompt** (`src/lib/system-prompt-core.mjs:164-175`, used at :270 EN and :327 DE)
- „Ein automatisches Willkommensgeschenk gibt es derzeit NICHT — versprich oder erwähne KEINEN Willkommens- oder Neukundenrabatt …“

**Copy ceiling**
- `docs/CONSENT_FLOW.md:54-60`; `src/lib/consent-variants.mjs:11-12`; CONSENT_CONTRACT §1 :62.
- `docs/ANWALTSDOSSIER.md:51`: „keine Rabattversprechen (Rabattcodes vergibt ausschließlich das Team per E-Mail)“.

**Variants**
- `variantsFor` builds only `a` (`consent-variants.mjs:44-49`).
- `SHIPPED_SIGNIN_VARIANT_IDS=["a"]`; `CONSENT_SIGNIN_VARIANTS` defaults to `a`.
- `activeSigninVariants` serves only active **and** `lawyerApproved` variants.
- With more than one active variant the response is `private, no-store`; otherwise `public, max-age=60, stale-while-revalidate=300`.

**Copy version:** `CONSENT_COPY_VERSION = "v5"` (`src/lib/consent-copy-version.mjs:17-48`; test `consent-copy-version.test.mjs:13-14`).

**`verify:live`** (`scripts/verify-live-kpis.mjs`)
- Section 3 covers consent.
- It does **not** count DOI mails or welcome codes per person.
- DOI mails are logged in `email_messages` by `recordSentMessage` (`src/lib/email-messages-store.ts:136`).

**§ 7 Abs. 3 UWG:** removed by client decision 16.06.2026. Sources: `ANWALTSDOSSIER.md:274` (OQ-06), Annex A :609, `CONSENT_FLOW.md:397-401`, migration `0029`. There is no open F-question.

**"No-op if the widget ships later":** every backend change below is invisible to a pre-2026-10-08 widget. It ignores unknown keys and sends no `value_moment`.

## 6. Rules that do not change

- **API_CONTRACT §0.** Served text is rendered only via `textContent`; URLs only via `safeHref`. KPI data is ids, enums and booleans only. No new request header: CORS stays `Content-Type, x-ms-chat-key, x-ms-session, x-ms-locale`.
- **CONSENT_CONTRACT §1.** Nothing pre-selected. Decline is as easy as accept. `marketingConsent: true` is sent only on the accept tap. **`consentTextShown` is unchanged in v6**; `reward` / `valueMoment` are framing and never part of it.
- **No Kopplung.** The chat, the summary, the sign-in and any product information never depend on consent. The reward is an **advantage for subscribing**, never a disadvantage for declining. The code is **never revoked** after an unsubscribe (Art. 7(3) GDPR).
- **The DOI mail stays neutral:** no reward, no code, no marketing copy (T5).
- **Consent is written only through `applyConsentActs`** (`CLAUDE.md`). Switches default `false`. `.env.example` documents every new variable.
- **Production status goes only in `docs/ROLLOUT_TODO.md`** (C.n items).
- **Mo never computes or shows reduced prices** (PAngV, T4).

---

## 7. Tasks (in order)

Recommended sequence:
- **T2 now**, independent of the reward: it fixes real duplicate mails today.
- **T1 investigation now**, which is mostly the owner's admin checks.
- **T8** to counsel in parallel.
- Then **T3/T4/T5** behind switches, **T6**, the **T9** live test, and the switch flip.
- **T7** only after counsel.

### T1. Find, verify and settle the ONE issuer of welcome codes (required, first)

**Where**
- Investigation: the live Shopify admin. Repo changes: none for design (a); `src/lib/welcome-code*.{mjs,ts}` (new) for design (b).

**Trigger.** None. This is an investigation plus a decision.

**Step 1: find the live sender.**
- The theme has **no** Klaviyo, Omnisend, Mailchimp embed, Shopify Forms or Seguno reference (`theme.md` §5).
- The privacy page names **MailChimp** 16 times (`templates/page.datenschutz.json`). That may be outdated.
- Candidates, in this order:
  1. Shopify admin → **Marketing → Automations**: a "Welcome new subscribers" or "Welcome series" automation with a discount;
  2. **Shopify Flow** → workflows with the trigger "Customer subscribed to email marketing";
  3. installed apps (Settings → Apps), e.g. a Mailchimp sync;
  4. Mailchimp's own audience automation, if a sync exists.
- For each, record:
  - trigger;
  - conditions (e.g. "first-time email subscribers", tag conditions, whether checkout subscribers are included);
  - the discount: type, value, shared vs unique, usage limits, minimum, collections, expiry;
  - the activity report (recipient count).
- Take screenshots for the dossier.

**Step 2: does Mo's API write trigger it?**
- Mo writes `SUBSCRIBED` / `CONFIRMED_OPT_IN` with `consentUpdatedAt` = confirm time (`consent-flows.ts:91` → `shopify-outbox.ts:126`).
- Shopify changelog [search-result level, unverified in full text]: apps can fire the "Customer subscribed to email marketing" trigger via the API **if `consentUpdatedAt` is within the last 24 h**.
- **Expected:** a chat DOI confirmation **does** start the Shopify welcome automation.
- **Two exceptions:**
  - if the outbox row fails and is retried more than 24 h later, the automation may **not** fire, so that customer gets no code;
  - a Mo-only person created by `customerCreate` with consent: verify separately.
- **Verify:** test case 8 (T9) with a fresh inbox, and the automation's activity report.

**Step 3: decide one issuer.** Both designs need **owner + counsel sign-off**.
- The welcome code was **retired on purpose** (`docs/CUSTOMERS.md:266-275`: „too exploitable via alias e-mails“).
- `docs/archive/CONSENT_SIGNOFF_HISTORY.md:358-366` requires „a fresh lawyer review“ and restoring „the gift-for-completing-the-DOI framing“ if it is ever reintroduced.

**Design (a): the Shopify automation is the single issuer (recommended now)**
- Keep or create one welcome automation, set to **first-time email subscribers only**.
- Add a **tag-based exclusion**: the automation, or a Flow step, tags the customer `welcome_code_issued` and excludes tagged customers.
  - Verify whether Shopify Email automations can add tags. If not, use a Flow workflow on the same trigger.
- **Unique codes if supported [unverified].** It is not confirmed that Shopify Email inserts unique per-recipient codes; it may be one shared code.
  - If it is shared: use a **minimum order value** and an **"eligible" collection** to limit leak damage, and accept the coupon-site risk.
  - Or use an app that supports unique codes.
- The discount must match the advertised terms **exactly**: value or tiers (see the O-1 caveat), 30 days, single use per customer, minimum order, eligible collection = vendor ≠ Concept2 AND no compare-at price, not combinable except shipping.
- **Backend work:** none for issuance. T2, T3 (`afterAccept` = „kommt per E-Mail“), T6 (issue and redeem metrics are limited, see T6) and T9.
- **Limits**
  - Alias addresses (`a+1@`, Gmail dots) each get a code. Shopify's "one use per customer" is tracked by e-mail.
  - No code can be shown on Mo's DOI landing page, because Mo does not know it.

**Design (b): the backend is the single issuer (phase 2, maximum attractiveness)**
- Reintroduce the retired `WELCOME` issuance from git history (full clone, see §5), **with fixes against alias abuse**:
  - **mint on the first DOI confirmation only**, inside the winning branch of the conditional confirm UPDATE (T2.3), never before confirmation;
  - **one unique code per customer**: `discountCodeBasicCreate` with `customerSelection` restricted to **that Shopify customer** (context/customers), not `{all:true}` as in `createUniqueDiscountCode`;
  - `usageLimit: 1`, `appliesOncePerCustomer: true`;
  - **minimum subtotal**;
  - `endsAt` = +30 days;
  - items = the **eligible collection**;
  - `combinesWith` all false except shipping;
  - fixed amount; for tiers, see the O-1 caveat (a Function, or three codes with a one-of-three rule).
- **Ledger** `welcome_code_ledger`:
  - key: `customer_id` **and** `email_hash` = HMAC-SHA256 of the **normalised** e-mail (lower-case; strip `+tag`; for Gmail/Googlemail also strip dots and unify the domain);
  - columns: `code`, `code_gid`, `issued_at`, `expires_at`, `source_surface`, `redeemed_at?`;
  - UNIQUE on each key → **at most one code per customer and per normalised address**.
  - Issue with `INSERT … ON CONFLICT DO NOTHING RETURNING`, so only the winner mints.
  - Erasure policy: see T2.6 and counsel.
- **Show the code on the DOI landing page** (`/api/confirm-marketing`, T5), plus a separate welcome mail (kind `welcome`, a new e-mail design kind) sent **after** confirmation.
- **The Shopify automation must then be disabled, or must exclude Mo-issued customers.** Mo tags `mo-welcome-issued` via the outbox, and the automation condition excludes that tag. Otherwise customers get two codes.
- Reuse the migration `0009` columns, or replace them with the ledger. Update `customer-memory.ts` so Mo knows a code was issued.
- New switch `WELCOME_CODE_ENABLED` (default `false`) and `WELCOME_CODE_*` settings: amount or tiers, minimum, days, collection gid.

**Storage**
- (a): none in Mo.
- (b): `welcome_code_ledger` (new migration), with a retention rule in `docs/DATA_RETENTION.md`.

**KPI**
- (b): new server-only events `welcome_code_issued {source}` and `welcome_code_redeemed` (from the order webhook if it carries discount codes [verify]).
- (a): read from Shopify only.

**Failure mode**
- (b): if minting fails, the landing page says „Dein Gutschein kommt per E-Mail“ and a retry job mints later. Never block the confirmation.

**Edge cases**
- Outbox delay longer than 24 h (a);
- the customer unsubscribes before using the code (keep the code valid);
- erased and re-registered (T2.6);
- checkout subscribers (O-7);
- imported customers with an old `consentUpdatedAt` (should not trigger).

**Acceptance (T1)**
- [ ] Written record in `ROLLOUT_TODO.md` (new C-item): which tool sends the 5 % code today, its trigger, conditions, discount settings and screenshots.
- [ ] Test case 8 run. It is documented whether a chat DOI confirmation fires the automation, with timestamps.
- [ ] Owner decision O-2 recorded; counsel sign-off recorded (dossier Annex A).
- [ ] (a) Automation set to first-time subscribers, tag exclusion active, discount matches the served terms exactly.
- [ ] (b) Ledger plus unique customer-restricted codes, minted only in the confirm winner branch; Shopify automation disabled or excluding `mo-welcome-issued`; unit tests for the normalisation and the ledger decision core (`.mjs`).
- [ ] T9: **exactly one welcome code per customer across all paths**.

### T2. "Only once" guarantees in the backend (required, can ship now)

**Where**
- `src/lib/email-capture-core.mjs` (`decideCaptureDoi`);
- `src/lib/email-capture-store.ts` (upsert and confirm);
- `src/app/api/account/marketing-opt-in/route.ts`;
- `src/app/api/confirm-marketing/route.ts`;
- `src/lib/shopify-webhook-customers.ts`;
- `scripts/verify-live-kpis.mjs`.

**T2.1 Idempotent opt-in while pending (cooldown)**
- New env `MARKETING_DOI_RESEND_COOLDOWN_MINUTES`. Suggested default 30; document it in `.env.example`.
- In `decideCaptureDoi`: when `existing.status === "pending"` and `existing.sentAt` is within the cooldown → **keep** the token and `sentAt`, `doiEmailRequired: false`.
- After the cooldown, a re-request may send again. Prefer **re-sending the same, still-valid token**: today the old link dies when the token is overwritten. Note the expiry is counted from `doi_sent_at` (`email-capture-store.ts:340-345`), so decide whether a re-send refreshes it.
- **Answer within the cooldown:** `status: "pending"`, `doiEmailSent: true`, read as "a valid confirmation mail is out". The widget then shows „Fast geschafft!“, which is correct.
- **Document the changed meaning in ACCOUNT_CONTRACT §6.2.** Add a server KPI field `doiCooldown: true` (server-only event, so no widget change).
- Keep "pending + send failed (`doi_sent_at` null) → the next accept sends" (ACCOUNT_CONTRACT §6.2 row 2).
- This applies to `/api/capture-email` too, because both use the same store.

**T2.2 Concurrent double POST**
- Make the decision and the write atomic. Either:
  - (i) a **conditional upsert**: `ON CONFLICT (email) DO UPDATE SET doi_token=…, doi_sent_at=… WHERE email_captures.marketing_doi_status <> 'pending' OR email_captures.doi_sent_at IS NULL OR email_captures.doi_sent_at < now() - <cooldown> RETURNING id, doi_token`. Only the request that gets a row back with **its own** token sends the mail.
    - The loser re-reads and answers as in T2.1.
    - **Careful:** the route answers 503 today when the upsert returns nothing (:153-160). Separate "lost the race" from "DB failed".
  - (ii) `pg_advisory_xact_lock(hashtext(lower(email)))` around SELECT + decide + upsert.
- Unit-test the decision core. Add a route-level test that fires two POSTs in parallel against a test DB, if the harness allows; otherwise test the SQL with a script.

**T2.3 DOI link clicked twice**
- Make the confirm **conditional**: `UPDATE email_captures SET marketing_doi_status='confirmed', doi_confirmed_at=now() WHERE id=$1 AND marketing_doi_status='pending' RETURNING id`.
- Zero rows → answer `alreadyConfirmed: true`.
- Only the winner runs `recordDoiConfirmed`, writes the KPI `email_capture_marketing_confirmed` and, in design (b), mints the code.
- Today a concurrent double click can write the confirmed KPI twice (`email-capture-store.ts:347-352`, route :59).

**T2.4 C.29: Shopify pending not mirrored → double DOI**
- (i) In `handleConsentWebhook`, do not drop `unknown-customer`. Import the customer inline (or enqueue an immediate reconciliation) and then apply the consent act.
- (ii) Belt and braces in the opt-in route: when Mo's mirror says `none`, **read the live Shopify consent** (`customer.emailMarketingConsent.marketingState`) for the signed-in customer before deciding the DOI.
  - If it is `PENDING`: answer `pending` and send **no** Mo DOI (Shopify's confirmation mail is out). Record the Shopify state through `applyConsentActs` with `source: "shopify"`.
  - If it is `SUBSCRIBED`: answer `confirmed` / `alreadyConfirmed`.
  - It is one Admin API call per accept, which is low volume.
- (iii) Run the C.29 check (open list item 1): compare the admin status with Mo's „Verlauf“.

**T2.5 Second tab / cross-device**
- The widget's H-2 covers one device.
- Server-side, T2.1 and T2.2 cover everything else.
- `/api/auth/me` already reports `optInActionable: false` once pending.

**T2.6 Erase and resubscribe policy**
- **Today:**
  - after an unsubscribe the address is suppressed and Mo surfaces never ask again; only a newer Shopify subscribe or an admin lift reopens it (`consent-core.mjs:173-180`);
  - `erasePerson` deletes `email_captures`, `consent_events` and the customer row (including `welcome_*`) and keeps a suppression row `erasure` (`CONSENT_FLOW.md:449-463`).
- **Policy to write down:**
  - **unsubscribe → resubscribe = no second code** (Shopify "first-time subscribers" plus tag; (b) ledger);
  - **erase → new account = a second code is possible** unless counsel approves keeping a **salted hash** of the normalised e-mail in the ledger after erasure. That hash is itself processing and needs a lawful basis, e.g. Art. 6(1)(f) fraud prevention, plus a retention period. This is a counsel question (T8).
  - Never revoke an issued code on unsubscribe.

**T2.7 `verify:live` section 10 „Einmal-Garantie“** (read-only, no e-mail addresses printed)
- **DOI mails** per customer and per capture in the window, from `email_messages`.
  - Identify DOI rows by send kind if the table carries it; otherwise match the `doiEmailSubject` strings, or add a `kind` column.
  - **Flag** more than 1 DOI mail per address within the cooldown, and more than 2 per address overall in the window.
- **Opt-in POSTs** (`email_capture_marketing_opted_in`) per customer; flag more than 1 with `doiSent: true` within the cooldown.
- **Confirmations** (`email_capture_marketing_confirmed`) per customer; flag more than 1.
- **Welcome codes:**
  - (b): count per customer id and per `email_hash` from the ledger; flag more than 1.
  - (a): read the customer tag `welcome_code_issued` via the Admin API for the customers confirmed in the window, and print "no tag" counts.
  - Note in the output that Shopify-side codes cannot be counted from Mo's DB alone.
- **C.29 detector:** Shopify consent `PENDING` while Mo has no `shopify` consent event. Use `--session` or a sample through the Admin API.
- Print customer ids or shortened session ids only, as in the existing sections.

**Acceptance (T2)**
- [ ] `decideCaptureDoi` tests: pending within cooldown → keep, no mail; after cooldown → re-send (same token if chosen); a send-failed pending → send.
- [ ] Two parallel POSTs → exactly **one** DOI mail (script or test DB), and the second answer is `pending`.
- [ ] A double-clicked DOI link (parallel) → one `email_capture_marketing_confirmed`, one consent act, one Shopify write, (b) one code.
- [ ] C.29 reproduced and fixed: a shop sign-up that is still PENDING → the chat does not send a second confirmation mail.
- [ ] ACCOUNT_CONTRACT §6.2 updated (`doiEmailSent` within the cooldown, `doiCooldown`), plus Appendix A.
- [ ] `verify:live` section 10 present; it prints zero flags on production after the T9 run, or each flag is explained.

### T3. Served copy v6: `reward` + `valueMoment` per variant, behind switches (required after counsel)

**Where**
- `src/lib/consent-variants.mjs` (variant objects);
- `src/lib/consent-copy.ts` (`SignInMarketingConsentCopy`, `signInMarketingConsentCopy()`, :151-202);
- `src/lib/consent-copy-core.mjs` (DE/EN strings);
- `src/lib/consent-copy-version.mjs` (v6) and the tests;
- `.env.example`.

**Switches** (default `false` / `a`)
- `CONSENT_REWARD_ENABLED`: serve `reward` for variants that define it.
- `CONSENT_VALUE_MOMENT_ENABLED`: serve `valueMoment` for variants that define it.
- `CONSENT_SIGNIN_VARIANTS`: e.g. `a,b,c` to run the test (default `a`).
- Optional: `CONSENT_REWARD_TERMS_URL`. Omit `termsUrl` when it is unset.

**Variants**
- **a (control):** today's headline and benefits, no `reward`, no `valueMoment`. `lawyerApproved: true`. Also the hold-out.
- **b (reward, popup timing):** a's headline and benefits + `reward` (badge, terms, termsUrl?, teaser, afterAccept). `lawyerApproved: false` until counsel signs off the reward copy.
- **c (reward + value moment):** b + `valueMoment.lead`. `lawyerApproved: false` until counsel signs off the value-moment ask.
- **Approval is tracked per variant:** `activeSigninVariants` already serves only approved variants. Add `b` and `c` to `SHIPPED_SIGNIN_VARIANT_IDS` (never remove ids; tested).
- Consider the benefit bullet „Exklusive Rabatt-Aktionen nur für Abonnenten“ under F-17 (exclusivity claim) once a reward exists on the open footer form too.

**Request / response**
- Request: `GET /api/consent-copy?surface=signin&locale=de|en` (unchanged).
- Response: today's payload + `version: "v6"` + `reward?` + `valueMoment?` (§2.1 shape and limits).
- **The server enforces the widget's limits:** badge ≤ 60, terms ≤ 300, teaser ≤ 160, afterAccept ≤ 200, lead ≤ 200 chars, trimmed and non-empty, `termsUrl` https.
  - A unit test fails the build if a configured string exceeds a limit. Otherwise the widget silently drops it and the KPI would be misleading.

**Rules**
- **Bump `CONSENT_COPY_VERSION` to `v6`** and update `consent-copy-version.test.mjs:13-14`.
  - `consentTextShown` is **unchanged**, so echoes of the v5 text will now be stamped `v6`.
  - Note in the version header that v6 adds framing only.
- **EN:** omit `reward` / `valueMoment` for `locale=en` until counsel confirms the EN texts (§2.1).
- **Lift the copy ceiling only for the reward block, and only after counsel approves:**
  - CONSENT_FLOW.md:54-60;
  - `consent-variants.mjs:11-12` (comment rule);
  - CONSENT_CONTRACT §1 :62;
  - ANWALTSDOSSIER :51;
  - frontend playbook 07:136 (note for the frontend).
  - Headline and benefits keep „no concrete discount amount“.
- **The served terms must state, at the claim itself:**
  - first sign-up only;
  - after DOI confirmation;
  - value or tiers with minimum order values;
  - single use;
  - 30 days;
  - exclusions: sale items **and Concept2**;
  - not combinable.
- Full terms behind `termsUrl`. Sources: OLG Hamm 4 U 4/18; § 6 Abs. 1 Nr. 3 DDG; § 5a UWG.
- **The reward served must equal the reward the issuer (T1) actually delivers, and what the theme surfaces advertise.** Do not flip `CONSENT_REWARD_ENABLED` while the footer, `/pages/rabatte` or the Shopify automation still say or send 5 %.
- **Cache:** with one variant the payload is public for 60 s + SWR 300 s, so a switch-off takes up to ~6 min to propagate. With several variants it is `no-store`. The widget caches 60 s per sid.

**KPI**
- Register `b` and `c` for the dashboard. `reward: true` and `teaser: true` are already stored verbatim by `/api/kpi`.

**Failure mode**
- An invalid or oversized field → the widget drops it → today's DOM. A missing required key (`marketingLabel`, `consentTextShown`, `lawyerApproved`) → the surface is off.

**Edge cases**
- `en`;
- old widget (ignores the keys);
- variant b assigned to an anonymous session whose teaser shows, then the sid changes at sign-in (§2.2 verify);
- `lawyerApproved: false` for b/c → never served, so `a` is served even if `CONSENT_SIGNIN_VARIANTS=a,b,c`.

**Acceptance (T3)**
- [ ] With switches off, `curl …/api/consent-copy?surface=signin` returns v6 with no `reward` / `valueMoment`. The widget is unchanged.
- [ ] With switches on and `lawyerApproved` true for b and c: variants assigned per session, `private, no-store`, the payload passes the limit tests, and there is no `reward` on `en`.
- [ ] `consentTextShown` byte-identical to v5; the opt-in stamp works (`v6`).
- [ ] API_CONTRACT §7.4, §5, Appendix A and CONSENT_CONTRACT §1, §3.1, §3.2, Appendix A updated in the same PR. ACCOUNT_CONTRACT §6.1 notes the value-moment timing and anti-nag.
- [ ] Tests: `consent-variants.test.mjs`, `consent-copy-core.test.mjs`, `consent-copy-version.test.mjs` (v6).
- [ ] The live widget (390 / 1280 px) shows badge, terms and link on popup and card, the teaser on the login popup and welcome card, and the value-moment card after a product recommendation (variant c).

### T4. Mo's system prompt (required with T3)

**Where:** `src/lib/system-prompt-core.mjs:164-175` (`renderWelcomeMemoryRule`, used at :270 / :327) and the prompt builder that knows the served copy.

**Change**
- While `CONSENT_REWARD_ENABLED` is on **and** the reward copy for the locale is served and `lawyerApproved`, replace „Kein Willkommensgeschenk versprechen“ with a rule built **from the served `reward.badge` and `reward.terms`**, never from free text.
- **When asked** about a newsletter, welcome or new-customer discount, Mo states the reward **exactly as served** (badge + terms; link name „Bedingungen“ if `termsUrl`):
  - it requires the first newsletter sign-up **and** confirmation via the e-mail link;
  - the code comes after confirmation.
- **Never more:**
  - no other amounts or percentages, no invented codes;
  - no claim that a code is already issued;
  - no urgency or scarcity;
  - no pressure, and no link between consent and help or the summary;
  - no computed reduced price („Laufband X jetzt 1.614,05 € statt 1.699 €“ is forbidden, PAngV § 11);
  - no statement that the reward applies to a sale or Concept2 product.
- **Already subscribed, or `welcomeAlreadyIssued`:** the reward is for the first sign-up only. Point to the earlier welcome e-mail or info@motionsports.de.
- **Not eligible** (suppressed / unsubscribed): do not push the reward.
- Mo does **not** raise the reward proactively in this round. A proactive mention is a separate decision (owner + counsel).
- **Switch off → today's rule unchanged.** EN only when the EN reward text is approved.

**Acceptance (T4)**
- [ ] Unit test for the prompt core: switch off → today's string; switch on → contains the served badge and terms verbatim and no other number.
- [ ] Manual chat test: „Gibt es einen Newsletter-Rabatt?“ → correct terms; „Gilt der für das Concept2 RowErg?“ → no; „Was kostet das Laufband dann?“ → no computed price.

### T5. DOI mail stays neutral; confirmation landing page (required check, small change)

**Where**
- `src/lib/consent-copy.ts:291-397` (`doiEmailBody` / `doiEmailSubject`);
- `src/app/api/confirm-marketing/route.ts`;
- `src/lib/consent-copy-core.mjs:71-73` (confirm page text).

**Rules**
- **The DOI mail contains no reward, code or marketing copy.** Source: LG Stendal 12.05.2021, 22 S 87/20, which held logo, welcome text and a contact prompt unlawful (minority strict view; OLG München 29 U 1682/12 vs OLG Celle 13 U 15/14).
- Check the admin-selected design (`getCachedEmailDesignForKind("doi")`) for marketing elements.
- Whether the mail may *mention* the reward („bestätige, um deinen Gutschein zu erhalten“) is a counsel question. Default: **no mention**.
- **Landing page** (a web page, not an e-mail; § 7 UWG does not apply [background view, counsel to confirm]):
  - design (a): may say „Dein Willkommensgutschein kommt in Kürze per E-Mail.“, **only if T1 showed the automation fires reliably for chat confirmations**;
  - design (b): may show the code itself, its terms and the expiry date (code text only; escape the output).
  - Show it only in the confirm **winner** branch and on `alreadyConfirmed` (b: show the existing ledger code; never mint again).
- Also check the Shopify notification **"Customer marketing confirmation"** (Settings → Notifications) for neutrality. Owner to-do.

**Acceptance (T5)**
- [ ] DOI mail preview (`scripts/send-test-emails.mjs`) shows no reward, logo-marketing or offer text; counsel answer recorded.
- [ ] The landing page shows the reward status (a) or the code (b) only after a successful or already-confirmed token; expired and unknown tokens show nothing about the reward.

### T6. KPI and dashboard (required before the switch flip)

**Where**
- `src/lib/kpi-widget-events.mjs` (normalisers);
- `ConsentGateSection.tsx`;
- `getConsentGateFunnel`;
- `docs/ADMIN_DASHBOARD.md`;
- `verify:live` section 3.

**Funnel per variant × placement** (`popup` / `signin_return` / `value_moment`)
1. `consent_gate_shown` (with or without `reward`)
2. `consent_gate_accepted`
3. server `email_capture_marketing_opted_in` (`doiSent`)
4. `email_capture_marketing_confirmed`
5. **code issued**
6. **code redeemed**

**Attributing confirmations**
- `email_capture_marketing_confirmed` carries only `{source}` today (route :59-67).
- Copy `placement` / `variant` from the customer's latest `email_capture_marketing_opted_in` into the confirmed **KPI** event. Keep them out of the consent record (F-38 b).

**Code issued and redeemed**
- (b): ledger + `welcome_code_redeemed`.
- (a): only from Shopify:
  - automation report;
  - discount usage;
  - or orders carrying the code, if the order webhook or mirror stores discount codes [verify in `mo`].
- If neither is available, show "n/a" rather than an estimate.

**Login popup teaser**
- Compare sessions with `login_gate_shown {teaser:true}` and those with `{}`: rate of `login_gate_signin_clicked` → `account_signin_linked` (and the later opt-in).
- `variant` on `login_gate_shown` allows a per-variant read.

**Incremental lift**
- Hold-out = variant **a**: confirmed opt-ins per eligible signed-in session and orders / revenue per session, b and c vs a.
- **Caveat for design (a):** variant-a subscribers also receive the Shopify welcome code. The test therefore measures the effect of **advertising** the reward in the chat, not of the reward itself.
- Report the redemption share and the share of orders using the code, to watch cannibalisation.

**Data rules:** no e-mail addresses on the KPI page; ids only.

**Acceptance (T6)**
- [ ] Dashboard shows the funnel per variant × placement, the teaser comparison and the lift vs a; unknown values show as „unbekannt“.
- [ ] `verify:live` section 3 lists `reward`, `teaser` and `value_moment` rows for `--session`.

### T7. § 7 Abs. 3 UWG (existing customers): dossier question only; build after counsel

**Status**
- Removed by client decision **16.06.2026** (OQ-06, `ANWALTSDOSSIER.md:274`; Annex A :609).
- Schema dropped in migration `0029`.
- The removed parts: `BESTANDSKUNDE_SENDS_APPROVED`, an audience, an eligibility cache, a separate opt-out list and `bestandskunden-store.ts` (`archive/CHANGE_REPORT_ROUND9.md:123-126`).
- **This task is a reversal** and needs a new F-question (T8) plus owner confirmation.

**Prerequisites** (all cumulative; read narrowly)
1. **Notice at collection** (§ 7 Abs. 3 Nr. 4 UWG), at the point where the e-mail is collected in connection with a sale:
   - theme: the setting **„Widerspruchshinweis im Warenkorb“** now exists **dormant** (`snippets/ms-marketing-objection-notice.liquid`, rendered in the cart drawer and cart page; empty = nothing);
   - **checkout** (Shopify admin → Settings → Checkout → Customize, at the contact step);
   - **order-confirmation e-mail** (Settings → Notifications → Order confirmation);
   - privacy policy.
   - Old suggested text and placement notes: `git show deef929:docs/backend-handoff/UWG_7_3_NOTICE_THEME_NOTES.md` in the theme repo.
   - **Addresses collected without a notice cannot be used retroactively** (prevailing view; no decision found that allows a later notice).
2. **Notice with each use:** an objection/unsubscribe link in every mail.
3. **Own similar products only, per purchased category** (treadmill buyer → mats, maintenance, chest strap, service). No general newsletter, no Black-Week blast.
4. **A completed sale.** Cancelled orders are excluded (LG Nürnberg-Fürth 4 HK O 655/21).

**Build (after counsel)**
- A separate audience whose Shopify consent is **never flipped to SUBSCRIBED**, because that would falsify the consent record.
- Sending through Mo's campaign path, with human approval per send (dossier §6).
- Objection handling: immediate permanent suppression (Art. 21(2)/(3) GDPR), with minimal data.
- Time limit: counsel decides; conservative is last order ≤ 24 months.
- Stop after an objection.

**Acceptance (T7):** none before counsel. After counsel: a separate spec.

### T8. Counsel package (required before T3 goes live)

The proposed numbering continues after **F-38**; renumber if taken. Add each to `docs/ANWALTSDOSSIER.md` with the relevant surfaces and texts, and update :51 („keine Rabattversprechen“) and the `CONSENT_SIGNOFF_HISTORY` note.

| Proposed | Question |
|---|---|
| **F-39 Incentive and Kopplung** (Art. 7(4), Recital 43 GDPR) | Is a welcome voucher for the newsletter sign-up "freely given" at the planned value (up to 100 € on high-value goods)? Sources: OLG Frankfurt 6 U 6/19 (Anlocken ≠ pressure) vs LDI NRW; WKO says the risk grows with value. Confirm: the code is not revoked on unsubscribe; consent stays separate from account and terms. |
| **F-40 Reward copy and conditions** (§ 5a UWG, § 6 Abs. 1 Nr. 3 DDG) | Approve badge, terms, `termsUrl` page, `afterAccept`, the theme footer, `/pages/rabatte` and the popup texts. Are the conditions complete and "at the claim" (OLG Hamm 4 U 4/18; BGH I ZR 195/07)? Is the asterisk / one-line summary + link enough on the chat cards? |
| **F-41 „bis zu“ tiers** | Is „bis zu 100 €“ with stated tiers allowed (LG Frankfurt 2-06 O 050/21; BGH I ZR 170/80; OLG Köln 6 U 80/07)? Data: the share of orders ≥ 1,000 €. |
| **F-42 Teaser on the anonymous sign-in popup and welcome card** | A reward teaser on a sign-in prompt (not consent) that leads to a later consent ask: framing, Kopplung, transparency. |
| **F-43 Value-moment ask** | An opt-in ask inside the chat right after a product recommendation (variant c). Does the „Gefällt dir die Empfehlung?“ framing stay within honest framing? |
| **F-44 PAngV § 11** | Advertising a voucher without a computed reduced price. Is a fixed-€ welcome voucher an "individual" reduction (§ 11 Abs. 4 Nr. 1)? Confirm that Mo must not show „X € statt Y €“. |
| **F-45 DOI mail neutrality and landing page** | May the DOI mail mention the reward (LG Stendal 22 S 87/20)? May the landing page show the code? Also the Shopify "Customer marketing confirmation" mail. |
| **F-46 Unsubscribe, erasure, ledger** | The reward is never revoked on unsubscribe. May a salted hash of the normalised e-mail be kept after erasure to enforce "first sign-up only"? On what basis, and for how long? |
| **F-47 § 7 Abs. 3 UWG (reversal of OQ-06)** | T7 prerequisites; notice texts for cart, checkout, order confirmation and privacy policy; "similar products" per category; time limit; Inteligo C-654/23. |
| **F-17 (update)** | „Exklusive Rabatt-Aktionen nur für Abonnenten“ once the welcome reward is also offered at other sign-up points. |
| **F-29 / Concept2 consistency (update)** | One set of conditions on footer, `/pages/rabatte`, popup, chat, Mo and the welcome mail. The Concept2 exclusion is missing on `/pages/rabatte` and the popup today. |
| **F-38 (update)** | Variants b and c; must "reward shown" / variant / placement be part of the consent evidence? Today it is KPI only. |
| **F-12 / D-AP3 (update)** | Does the EN approval cover the new reward and value-moment texts? |

**Acceptance (T8)**
- [ ] Questions in the dossier, package sent, answers recorded in Annex A.
- [ ] `lawyerApproved` for b and c set only after the corresponding answers.

### T9. Live test matrix (required before the switch flip; repeat after each issuer change)

**Setup**
- Shopify DOI on.
- Fresh real test inboxes, plus `+alias` variants to probe abuse.
- Fresh private browser window per case (widget per-tab memory).
- Note every active automation, Flow, app and the Mo issuer state (T1).
- Run with the switches on for testing. If needed, use a temporary test allow-list (precedent: `CHAT_ORDER_STATUS_TEST_CUSTOMERS`).
- Clean up afterwards: „Meine Daten löschen“ or the admin's „Kunde vollständig löschen“, plus delete in the Shopify admin.

**Check in the Shopify admin, per case**
- customer e-mail marketing status and opt-in level;
- customer timeline;
- Marketing → Automations → Welcome activity;
- Flow run history;
- Discounts → usage;
- customer tags (`welcome_code_issued` / `mo-welcome-issued`).

**Check in Mo's DB, per case**
- `email_captures` (status, `doi_sent_at`, token changes);
- `customers.email_consent_state` and `marketing_status`;
- `consent_events`;
- `shopify_outbox` rows;
- `email_messages` DOI count;
- `kpi_events` (`consent_gate_*`, `email_capture_*`);
- (b) `welcome_code_ledger`;
- `npm run verify:live -- --session <prefix>` sections 3 and 10.

**Inbox, per case:** count the DOI mails and the welcome mails.

| # | Path | Expected |
|---|---|---|
| 1 | Footer form, new e-mail | PENDING → 1 neutral Shopify DOI → click → SUBSCRIBED / CONFIRMED_OPT_IN → **1** welcome mail with a valid code |
| 2 | Theme newsletter popup (if re-enabled) | as #1 |
| 3 | DOI link clicked twice, or again hours later | still **1** welcome code; Mo: 1 confirmed KPI (T2.3) |
| 4 | DOI never clicked / expired → sign up again → click | 0 codes before the click, **1** after |
| 5 | Same e-mail in two tabs, or footer + chat in quick succession | Mo: ≤ 1 DOI within the cooldown (T2.1/T2.2); **1** welcome code |
| 6 | Registration with the newsletter box (find the live path: theme has none, `sections/main-register.liquid:7-94`; likely new customer accounts or checkout) | DOI if applicable, then **1** code; the chat must not send a second DOI (C.29, T2.4) |
| 7 | Checkout "news and offers" box | per O-7; document whether the automation includes checkout subscribers |
| 8 | **Chat**: signed-in consent ask (variant b) → Mo DOI → click | Shopify SUBSCRIBED with fresh `consentUpdatedAt` → **exactly 1** code mail in total, from Shopify **or** Mo, never both; the landing page as in T5 |
| 9 | Chat accept by an already SUBSCRIBED customer | `already` outcome, 0 mails, 0 codes |
| 10 | Subscribe → code → unsubscribe → resubscribe (form, and chat if possible) | **0** additional codes; the chat does not ask (suppressed) |
| 11 | Erased customer → new account with the same e-mail | per T2.6 / F-46 (second code possible unless the ledger hash is approved) |
| 12 | Plus/alias addresses (`a+1@`, Gmail dots) | (a) each gets a code (accepted risk, limited by minimum order and eligible collection); (b) **1** per normalised address |
| 13 | Code rules | single use; second order rejected; another customer cannot use it (b); expiry; minimum order; sale items and Concept2 rejected; no stacking |
| 14 | Locales (de/en and theme locales) and every surface | identical conditions incl. Concept2 on footer, `/pages/rabatte`, popup, chat badge/terms, Mo answer and welcome mail; no chat reward on `en` until approved |
| 15 | Admin-imported / API-created customer set to SUBSCRIBED with an old `consentUpdatedAt` | no code (should not trigger; > 24 h) |

**Pass criterion:** **exactly one welcome code per customer across all paths** (except the accepted cases 11 and 12a), **at most one Mo DOI mail per address within the cooldown**, and `verify:live` section 10 without unexplained flags.

---

## 8. Legal constraints (summary; details for counsel in T8)

- **Planet49 / BGH Cookie-Einwilligung II:** no pre-selection, ever. Information does not cure a pre-ticked box.
- **Art. 7(4) GDPR:** the reward is an advantage for subscribing, not a detriment for declining. It is never revoked on unsubscribe. No upper limit has been set by any court; the risk grows with value.
- **§ 5a UWG / § 6 Abs. 1 Nr. 3 DDG:**
  - conditions clear and close to the claim on **every** surface;
  - no unnamed exclusions (OLG Hamm 4 U 4/18);
  - „bis zu“ only with a realistic top tier;
  - only true scarcity (UWG Annex No. 7).
- **PAngV § 11:** no computed reduced prices in the chat.
- **DOI (BGH I ZR 164/09):** reward only after confirmation. The DOI mail stays neutral (LG Stendal).
- **§ 7 Abs. 3 UWG:** four cumulative conditions; notice at collection cannot be added retroactively; never flip such customers to SUBSCRIBED.
- **`lawyerApproved`:** per variant. EN reward only after an EN check. `consentTextShown` unchanged.

## 9. Fail-safe notes

- **Everything is additive.** The widget ignores unknown fields. A pre-2026-10-08 widget ignores `reward` / `valueMoment` entirely.
- **Removing a field turns that surface off:**
  - no `reward` → no badge, terms or teaser;
  - no `valueMoment` → no value-moment ask, and the first-send popup comes back;
  - missing `marketingLabel` / `consentTextShown` / `lawyerApproved` → the consent surface is off.
- **Kill switch:** `CONSENT_REWARD_ENABLED=false` / `CONSENT_VALUE_MOMENT_ENABLED=false`, or drop b/c from `CONSENT_SIGNIN_VARIANTS`. Propagation takes ≤ 60 s + 300 s SWR with a single variant, and is immediate with `no-store`.
- **The widget fails silent:** a copy fetch error or the 1200 ms timeout → today's login popup without the teaser.
- **T2 is safe to ship alone:** it only reduces duplicate DOI mails.
- **Design (b) minting never blocks the confirmation.**

## 10. Deployment

**Order**
1. T2 (+ `verify:live` section 10).
2. T1 investigation and owner decisions.
3. T8 sent.
4. T6.
5. After counsel: T1 issuer setup, then T3 + T4 + T5 with switches off.
6. Owner aligns the theme texts and the automation with the decided reward.
7. T9 with the switches on for testing.
8. Flip `CONSENT_REWARD_ENABLED`, then `CONSENT_SIGNIN_VARIANTS=a,b` (or `a,b,c` with `CONSENT_VALUE_MOMENT_ENABLED`).
9. ROLLOUT_TODO C-items for each.

**New env variables** (document in `.env.example`, default off):
- `MARKETING_DOI_RESEND_COOLDOWN_MINUTES`
- `CONSENT_REWARD_ENABLED`
- `CONSENT_VALUE_MOMENT_ENABLED`
- `CONSENT_REWARD_TERMS_URL` (optional)
- design (b): `WELCOME_CODE_ENABLED` and `WELCOME_CODE_*`

**Theme (already done, dormant):**
- widget JS/CSS;
- `snippets/ms-marketing-objection-notice.liquid`;
- `sections/cart-modal.liquid`, `snippets/cart-side-inner.liquid`, `config/settings_schema.json` (group "Marketing-Hinweise");
- MANIFEST entry 2026-10-08.
- The theme needs no further upload for T1–T6.

## 11. Acceptance checklist (overall)

- [ ] T1: the live sender is identified and documented, one issuer is decided and configured, and owner + counsel sign-off is recorded.
- [ ] T2: one DOI per address within the cooldown, including under concurrency; conditional confirm; C.29 fixed; `verify:live` section 10.
- [ ] T3: v6 served behind switches; limits enforced; no EN reward before approval; `consentTextShown` unchanged; contracts updated in the same PR.
- [ ] T4: Mo states only the served reward and terms, only while the switch is on; no computed prices.
- [ ] T5: neutral DOI mail (ours and Shopify's); landing page per design.
- [ ] T6: funnel per variant × placement, teaser effect, lift vs a, issued/redeemed (or "n/a" for (a)).
- [ ] T7: dossier question only; nothing built.
- [ ] T8: questions F-39…F-47 and the updates in the dossier; answers recorded before `lawyerApproved` is set for b/c.
- [ ] T9: all 15 cases pass; **exactly one welcome code per customer across all paths**.
- [ ] The live widget shows `ms-chat-reward-badge` / `ms-chat-vm-lead` in the served file. The surfaces look right in DE at 390 and 1280 px. No console errors; no pre-selection; no server-only events from the widget.

## 12. Uncertainties and how to verify them

| Uncertain | How to verify |
|---|---|
| Which tool sends today's 5 % code | Shopify admin → Marketing → Automations; Flow; Apps; Mailchimp account (T1 step 1) |
| Whether Mo's API write fires the automation | Test case 8 + automation activity report; the 24 h `consentUpdatedAt` rule (changelog, read at search-result level only) |
| Whether Shopify Email supports unique per-recipient codes | Create a test automation with a discount and look at the options; send to two test inboxes |
| Whether native discounts support tiers in one code | Discounts → Create → Amount off order |
| Whether unsubscribe → resubscribe re-triggers the welcome automation | Test case 10 |
| Whether the anonymous sid survives the chat sign-in (variant consistency teaser → consent) | ACCOUNT_CONTRACT §1/§2a + a live session trace with `verify:live --session` |
| Whether order data in Mo carries discount codes (redeemed metric) | Check the order webhook or mirror code in `mo` |
| Where the owner's "ticked box at registration" came from (the theme register form has none) | Shopify admin: customer accounts setting (classic / new) and the checkout marketing option |
| The retired WELCOME code | Full clone: `git log --all -S WELCOME_DISCOUNT -- src` |

---

## Owner to-do (Shopify admin and theme; no code)

1. **Find the sender of the 5 % welcome e-mail.** Look under Marketing → Automations, Shopify Flow, Settings → Apps and Mailchimp. Note its trigger, the "first-time subscribers" setting, whether checkout subscribers are included, and the discount settings (shared or unique code, usage limits, minimum order, collections, expiry). Send screenshots to the backend agent (T1).
2. **Checkout marketing checkbox** (Settings → Checkout → Marketing options): make sure "Email me with news and offers" is **not pre-selected**.
3. **Double opt-in** (Settings → Notifications → Customer notifications → "Customer marketing confirmation" / marketing double opt-in):
   - confirm it is **on**;
   - check that the confirmation mail is **neutral** (no logo marketing, no offer, no code).
4. **Fix the Concept2 inconsistency:**
   - footer (`sections/footer-group.json`, block `newsletter_UfNf8U`) names Concept2;
   - `/pages/rabatte` (`templates/page.rabatte.json`) and the newsletter popup (`sections/overlay-group.json`; disabled) do not.
   - Use one identical set of conditions everywhere, and later the new reward (O-1) instead of 5 %.
   - Same edit pass: the English "Subscribe" button on `/pages/rabatte`, the expired Black Week copy on `/pages/newsletter-anmeldung`, and the placeholder newsletter text in `templates/blog.json`.
5. **Privacy policy** (`/pages/datenschutz`): if Mailchimp is not used, replace the outdated MailChimp mentions (16) with the actual provider (e.g. Shopify Email) and describe the welcome voucher. Counsel to review.
6. **Decide O-1 to O-9** (§0.2): reward design and amount, issuer, 30 days, unique codes, exclusions, first-sign-up rule, checkout and imported subscribers, goodwill rule, § 7 Abs. 3 go/no-go.
7. **Share of orders ≥ 1,000 €** (Shopify Analytics), needed for a „bis zu 100 €“ claim (F-41).
8. **Create the terms page** `/pages/newsletter-gutschein` with the full conditions once counsel approves, or tell the backend to omit `termsUrl`.
9. **Leave the theme setting „Widerspruchshinweis im Warenkorb“ empty** until counsel approves a § 7 Abs. 3 text. Checkout and order-confirmation notices are admin-only (T7).
10. **Run the C.29 check** (ROLLOUT_TODO open item 1): Shopify admin consent status vs Mo „Verlauf“ for a box-ticked sign-up.
