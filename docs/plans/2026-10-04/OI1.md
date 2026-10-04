# OI1: Measure opt-ins honestly through the DOI, and stop the e-mail-summary ask for signed-in sessions

**Implementation plan (backend only, two PRs)**

- **Scope:** `/home/user/mo` (backend + admin).
- **Widget change:** none.
- **Migration:** none.
- **New endpoint:** none.
- **Contract:** additive only.
  - New enum keys go on server-only events.
  - The tool is withheld for tier 3, which CA §6.0 already describes.
  - `/api/capture-email` keeps accepting any `trigger` echo but stores only the tool's enum values. The request shape is unchanged and the field stays telemetry only.
- **Not touched:** `getCoreMetrics`. P0.6 is being fixed separately.
- **Effort:** M, about two days in total, split into two PRs.
  - **PR 1 (Part A + G1):** about half a day. It can ship today and changes the chat behaviour only.
  - **PR 2 (Parts B–F, G2, H, I):** about one and a half days. It covers measurement, dashboard and docs, and includes lint, tsc, build, tests and the Playwright screenshots of two sections at 1440/1024 px in light and dark (CLAUDE.md "Before you push", "Verify visually").

---

## 0. What ships and what the operator sees afterwards

| | Before | After |
|---|---|---|
| Signed-in chat at the `add_to_cart` moment | Mo runs a forced extra step and calls `offer_email_summary`. The widget hides the card (CA §6.0, 03 §8.6), so the model's text points at a form that never appears. | The tool is withheld and the forced step never fires. The prompt says: no e-mail summary, no newsletter pitch, and no sign-up promise even when asked. Back-in-stock wishes go to `show_contact_form`. If the customer asks for a summary, it is the PDF behind the download icon, but only when the thread has a `conversationKey`. |
| `email_capture_submitted` / `_marketing_opted_in` | `{marketingConsent, trigger?}` / `{doiStatus, trigger?}` | Adds `source` (`mo_capture_form` \| `mo_signin` \| `mo_chat_gate`) and `outcome` (`doi_required` \| `already_confirmed` \| `already_subscribed` \| `suppressed`). The existing keys stay. The capture form's `trigger` is stored only when it is one of the tool's enum values. |
| `email_capture_marketing_confirmed` | `{}` | `{source}`. The source is taken in this order: the latest opt-in with a DOI mail in the capture's session, then the latest pending consent row, then `mo`. |
| „E-Mail-Capture-Funnel“ | Mixes in sign-in opt-ins. The DOI denominator includes opt-ins that never got a DOI mail. „Angeboten“ includes asks the widget hid. Declines are raw clicks. The trigger list shows raw client strings. | Covers the capture form only, with visible asks only. The submit rate uses submits that followed an offer. Shows „Bereits abonniert“. DOI rate = confirmed ÷ opt-ins with „DOI-Mail fällig“. Declines are deduped per session and trigger. The per-trigger table uses normalised triggers. DOI confirmations are shown by source, and older confirmations are attributed through their session's opt-in. |
| „Einwilligung nach der Anmeldung“ | Event counts. One session can be both accepted and dismissed. | Counts sessions; accepted beats declined, which beats dismissed. The chart reads „Angezeigt“ → „Opt-in gespeichert“ (server) → „DOI bestätigt“. „Akzeptiert“ (the widget tap) is a stat. Opt-ins are split into neue DOI / bereits abonniert / gesperrt. |
| KPI tab | – | Release notes for both deploy days. Both sections note that the source/outcome split only exists from the PR 2 deploy day and that older events are approximated. |

---

## 1. Verified starting point (read in code today)

| # | Claim | Where (verified) |
|---|---|---|
| 1 | The offer is allowed without any sign-in check. | `src/app/api/chat/route.ts` L309-310: `allowEmailSummaryOffer = !emailCaptured && emailOffersMade < MAX…`. Neither `defaultActiveTools` (L448-451) nor the two `shouldForceEmailOfferStep` calls (inside `prepareStep` at L534, inside `stopWhen` at L554) ever see sign-in state. |
| 2 | Today's code relies on "the force gates are a strict subset of `allowEmailSummaryOffer`". If the tool is withheld via `activeTools` but the force still fires, `prepareStep` sets `activeTools: ["offer_email_summary"]` and **re-enables it**. | `route.ts`: comment L523-529, `prepareStep` L530-548. So `signedIn` must go into **both** `allowEmailSummaryOffer` and `shouldForceEmailOfferStep`. |
| 3 | `customerMemory` alone cannot tell "signed in". | `src/lib/customer-memory.ts → resolveSignedInMemory` (L200): a live but non-personalised customer without a display name returns `null`, the same as anonymous. `resolveChatMemory` (L274) then falls back to the e-mail memory. The predicate is the same as `/api/auth/me`: `resolveSignedInCustomer` + `getValidAccessToken` (`src/app/api/auth/me/route.ts` L51-57). |
| 4 | The forced ask also reaches a signed-in customer **live** whenever the offer arrives before the widget's first auth probe resolves. | 03 §8.6 ("The same happens for a live offer that arrives before the first auth probe resolves"), 04 §10.8. Withholding on the server closes that path. Only restored stored parts remain (04 §18 item 2 → D11). |
| 5 | The prompt cache is unaffected. | `src/lib/tools.ts` L236-246: the tools-tier marker sits on `show_contact_form`. `offer_email_summary` comes after it and is already withheld per turn via `activeTools` (NOTE at L73). The system prompt is rebuilt every turn anyway (profile, retrieval). |
| 6 | The German golden pins a signed-in memory case with an active offer section. | `src/lib/system-prompt-core.fixtures.mjs` case 3: `customerMemory: memorySignedIn()`, `emailOffer: {offersMade: 1, …}`. So the prompt must switch on an **explicit** `emailOffer.signedIn` flag, not on `customerMemory.signedIn`. Otherwise the golden breaks. |
| 7 | The capture funnel has no origin filter, and its DOI denominator includes no-DOI outcomes. | `src/lib/kpi-store.ts → getEmailCaptureFunnel` (L621ff.): `count(*) … GROUP BY event` over all five events; `submitRate = submitted / askShown`; `doiRate = confirmed / marketingOptedIn`. |
| 8 | The sign-in opt-in is counted as a capture submit. | `src/app/api/account/marketing-opt-in/route.ts` L157-168: `{marketingConsent:true, trigger:'signin_optin'}` / `{doiStatus, trigger:'signin_optin'}`. See also 04 §14 "counted twice". |
| 9 | `opted_in` is written whether or not a DOI mail is due, and **before** any mail is sent. | `src/app/api/capture-email/route.ts` L185-198 records `doiStatus` for every ticked box, before the summary send and the DOI send. `marketing-opt-in/route.ts` writes the KPI at L157-168, before `sendEmail` at L172ff. `src/lib/email-capture-store.ts → upsertEmailCapture` sets `doiEmailRequired=false` when the address is suppressed, already confirmed or `subscribedElsewhere`. The result does not expose `suppressed`. |
| 10 | `alreadyConfirmed` answers are **not** the same as `doiStatus = confirmed`. | Both routes compute `alreadyConfirmed = subscribedElsewhere \|\| (status==='confirmed' && !doiEmailRequired)` (`marketing-opt-in/route.ts` L219-221, `capture-email/route.ts` L270-271). Two cases break the equivalence:<br>• A `subscribedElsewhere` answer carries `doiStatus` `none` or `pending` in the event.<br>• A **suppressed** address whose capture row is still `confirmed` also answers `true` (`upsertEmailCapture` else-branch keeps `confirmed`).<br>The live script (`scripts/verify-live-kpis.mjs` §3, "nach DOI-Status") therefore cannot count user item 3. ROLLOUT_TODO 1.11 also expects "an opt-in with `doi_status = pending` (→ confirmed after the click)", but the opt-in event never changes; the click writes a separate `_confirmed` event. `outcome` fixes this (§3 B1 `isAlreadyConfirmedAnswer`). |
| 11 | The confirmation event carries no source, but a source is already computed. | `src/app/api/confirm-marketing/route.ts` L53-60 records `{}`. `src/lib/consent-flows.ts → recordDoiConfirmed` computes `pendingSurface(customerId)` (the latest `consent_events` row with `state='pending'`) and throws it away. |
| 12 | `pendingSurface` can name the wrong surface. | A second pending act on an already-pending customer is an "echo" (`consent-core.mjs → sameConsent`, L79-83 and L128-130) and writes no `consent_events` row (`consent-store.ts` L191: only when `d.changed`). `upsertEmailCapture`, however, issues a new token for that second ticked submit. The capture row's `session_id` is the latest submitter's session (`COALESCE(EXCLUDED.session_id, …)`), and `confirmMarketingByToken` returns it. So the session's latest `doi_required` opt-in names the live token's surface better. |
| 13 | `trigger` is client-controlled on the capture side. | `capture-email/route.ts` L52 and L106-109 trim the echo and cut it to 40 chars, with no enum check. `email_capture_declined` arrives through `/api/kpi`, whose `data` is kept as given (`src/app/api/kpi/route.ts` L80-94). `chat-marketing-opt-in/route.ts` L110-112 / L189 / L194 store `trigger ?? "chat_gate"`, a client echo (AC L1596). The tool enum has 5 values (`tools.ts` L271-278); `api/chat` writes `unspecified` as its fallback (`route.ts` L638). `source`/`outcome`/`_confirmed` are safe: the `email_capture_*` server events are dropped by `/api/kpi` (`isServerOnlyEvent`). |
| 14 | The consent gate counts events, not sessions. | `kpi-store.ts → getConsentGateFunnel` (L285ff.): `count(*) GROUP BY event, surface`. 04 §10.2 / §18.15: accepting and then pressing Esc on the success view also sends `_dismissed`. `ms-chat-optin-ask-shown` is per tab, so several tabs give several `_shown` events under one sid (04 §14). `consent_gate_accepted` is sent only after the opt-in POST returned 2xx (05 §4.6). |
| 15 | Declines inflate. | 05 §4.7: a stored offer can be declined again after every reload. `getEmailCaptureFunnel` counts raw `email_capture_declined` events. |
| 16 | Only `kpi-store.ts` reads these events, apart from the verify script. | `grep` over `src/`: there is no other reader of `email_capture_*`. `EmailCaptureFunnel` / `ConsentGateFunnel` are used only by `KpiTab.tsx` and the two section files. |
| 17 | The sold-out rule promises the e-mail tool. | `src/lib/system-prompt-core.mjs` L1116 (EN) / L1243 (DE): "…via `offer_email_summary` or `show_contact_form`". |
| 18 | Before migration 0073 (2026-10-03), `account_signin_succeeded` alone linked the chat. | AC §5 server table ("Since 0073 this alone does not sign the chat in"). `account_signin_linked` exists only from 2026-10-03 (`kpi-releases.mjs` `signin-code`). |

**Found while planning (outside OI1, reported, not fixed here).** These are ranked follow-ups and are also listed under Dependencies.

- **F1. Possible opt-in loss.** In `email-capture-store.ts → upsertEmailCapture`, a later submit **without** the marketing tick, for an address whose DOI is still `pending`, takes the `else` branch. It writes `marketing_doi_status='none'` and `doi_token=NULL`, so the DOI link already in the inbox becomes invalid. The one consent (`customers.email_consent_state`) stays `pending` until the expiry job.
  - Size check (read-only): `SELECT count(*) FROM customers c JOIN email_captures ec ON ec.email = c.email WHERE c.email_consent_state = 'pending' AND ec.marketing_doi_status = 'none';`
  - Fix as its own small change: keep `pending` + token + `doi_sent_at` when the existing status is `pending`, the address is not suppressed and marketing is not ticked now. Add a test.
- **F2. Misleading "already subscribed" answer.** A suppressed address whose capture row is still `confirmed` gets status `confirmed` and `alreadyConfirmed: true`. This happens, for example, after a Shopify-side unsubscribe, which writes `suppression_list` but not `email_captures`. The widget then shows „Du bist bereits für unsere Angebote angemeldet“ (04 §10.6).
  - Check: `SELECT count(*) FROM email_captures ec JOIN suppression_list s ON s.email = ec.email WHERE ec.marketing_doi_status = 'confirmed';`
  - OI1 records `outcome: 'suppressed'` (with `doiStatus: 'confirmed'`) for this case and reports it in its own bucket, so it becomes visible.
  - **Ranked follow-up (backend-only):** for a suppressed address, answer `status: 'none', alreadyConfirmed: false` in both routes. That uses only documented enum values, and the shape is unchanged. The widget maps it to `other`: the capture form appends no marketing line, and the popup/card show the neutral „Danke! / Wir haben deine Anmeldung erhalten.“ instead of the false "already subscribed". It needs a route-level test and a one-line CA/AC note.
- **F3. „DOI-Mail fällig“ ≠ mail sent.** `outcome:'doi_required'` reflects `doiEmailRequired`, and the KPI is written before `sendEmail` runs (§1 row 9). A failed or skipped send (Resend not configured, or the capture form's 502 on a summary failure, which returns before the DOI send) still counts. OI1 names the stage accordingly and says so in the InfoTip.
  - Follow-up: a server event or field for a DOI mail actually sent.

---

## 2. Part A — Withhold the offer for signed-in sessions (`/api/chat`) — PR 1

### A1. `src/lib/customer-memory.ts`: one resolution that returns both memory and sign-in state

This adds no extra DB or Shopify call. It is the same `resolveSignedInCustomer` + `getValidAccessToken` the route already runs every turn.

```ts
export interface ChatIdentity {
  /** Live tier-3 session — same rule as /api/auth/me (linked sid + valid access token). */
  signedIn: boolean;
  memory: CustomerMemoryContext | null;
}

async function resolveSignedInMemory(sessionId: string | null): Promise<ChatIdentity> {
  const sid = sessionId?.trim() || null;
  if (!sid) return { signedIn: false, memory: null };
  let signedIn = false;                       // set once the token is proven
  try {
    const resolved = await resolveSignedInCustomer(sid);
    if (!resolved) return { signedIn: false, memory: null };
    const token = await getValidAccessToken(resolved.customerId);
    if (!token) return { signedIn: false, memory: null };
    signedIn = true;
    const customer = await getCustomerById(resolved.customerId);
    if (!customer) return { signedIn, memory: null };
    // … unchanged body; every former `return null` → `return { signedIn, memory: null }`,
    //   every former `return {...}` → `return { signedIn, memory: {...} }`
  } catch (err) {
    reportError(err, { route: "lib/customer-memory", phase: "resolveSignedInMemory" });
    return { signedIn, memory: null };        // a failure after the token check still knows "signed in"
  }
}

export async function resolveChatIdentity(input: { sessionId: string | null; email: string | null }): Promise<ChatIdentity> {
  const tier3 = await resolveSignedInMemory(input.sessionId);
  if (tier3.memory) return tier3;
  const memory = input.email ? await resolveCustomerMemory({ email: input.email, sessionId: input.sessionId }) : null;
  return { signedIn: tier3.signedIn, memory };   // memory fallback exactly as today
}

/** Kept for compatibility (only caller today is api/chat). */
export async function resolveChatMemory(input: { sessionId: string | null; email: string | null }) {
  return (await resolveChatIdentity(input)).memory;
}
```

The privacy gate is unchanged. Memory resolution is byte-for-byte the same as today, and `signedIn` is only an extra output.

### A2. `src/app/api/chat/route.ts`

Cited by anchor; current line numbers are given in brackets.

1. Import `resolveChatIdentity` instead of `resolveChatMemory` [L17].
2. In the `Promise.all` [L322; the call at L326], replace `resolveChatMemory(...)` with `resolveChatIdentity(...)`. Then:
   ```ts
   const customerMemory = identity.memory;
   const signedIn = identity.signedIn;
   // CA §6.0 on the server: the widget suppresses the capture card for tier 3, so the
   // backend never offers it (no dead ask, no forced step). Fail-open: a failed sign-in
   // lookup leaves today's behaviour.
   const emailOfferAvailable = allowEmailSummaryOffer && !signedIn;
   ```
   Keep `hasDeclinedEmailCapture` gated on `allowEmailSummaryOffer`. It runs in parallel, so its cost is unchanged.
3. `defaultActiveTools` [L448-451]: use `(emailOfferAvailable || name !== "offer_email_summary")`.
4. `buildSystemPrompt({... emailOffer: { offersMade: emailOffersMade, emailCaptured, signedIn, summaryDownload: signedIn && conversationKey !== null } ...})`.
   - The download icon only shows when the thread has an `activeConversationKey` (04 §7.1, 04 §17: signed-in threads that started anonymously have none). `conversationKey` is the bounded body value [L260-263].
5. Pass `signedIn` to both `shouldForceEmailOfferStep({... , signedIn })` calls (in `prepareStep` and `stopWhen`). Update the comment block above `prepareStep` [L523-529] to: "the trigger's gates (incl. `signedIn`) are a strict subset of `emailOfferAvailable`".
6. `onFinish` (the `ask_shown` loop) stays unchanged. With no tool call there is no event.

### A3. `src/lib/email-offer-trigger.mjs → shouldForceEmailOfferStep`

```js
export function shouldForceEmailOfferStep({ emailCaptured, offersMade, declined, toolNamesCalled, signedIn = false }) {
  if (signedIn) return false;   // CA §6.0: tier 3 never gets the capture card
  … // unchanged
}
```

Update the JSDoc: "Fires only when ALL of these hold: … the session is not signed in (tier 3)".

**Tests (`src/lib/email-offer-trigger.test.mjs`).**
- A signed-in session never fires, across the whole eligible matrix with `CHECKOUT_TURN`.
- Omitting `signedIn` gives exactly the old matrix; the existing tests stay green unchanged.
- `signedIn: true` with `offer_email_summary` already called is still `false`.

### A4. Prompt: `src/lib/system-prompt-core.mjs → renderEmailOfferSection` + `src/lib/system-prompt.ts → EmailOfferState`

Add optional fields to `EmailOfferState`: `signedIn?: boolean; summaryDownload?: boolean`. Update the JSDoc of `buildSystemPrompt` to `emailOffer?: { offersMade, emailCaptured, signedIn?, summaryDownload? }`.

The new first branch in `renderEmailOfferSection(state, locale)` comes before `emailCaptured` and the cap. The copy names no widget label, because the backend does not own the label text and `DOWNLOAD_COPY` has an EN overlay (02 L622, 04 §7.1).

- **DE:**
  ```
  ### Zusammenfassung
  Der Kunde ist mit seinem Kundenkonto angemeldet. Biete KEINE Zusammenfassung per E-Mail an (das Tool steht dir nicht zur Verfügung), frage im Chat nie nach einer E-Mail-Adresse und sprich von dir aus keine Newsletter- oder Angebots-Anmeldung an. Fragt er selbst nach Newsletter oder Angeboten: melde ihn nie selbst an, versprich keine Anmeldung und hole keine Einwilligung im Chat ein. Möchte er erfahren, wann ein ausverkaufter Artikel wieder lieferbar ist, nutze dafür `show_contact_form`. {DL} Berate einfach normal weiter.
  ```
  - `{DL}` with `summaryDownload`: „Fragt er nach einer Zusammenfassung, kann er sie über das Download-Symbol oben im Chat als PDF herunterladen.“
  - `{DL}` without: „Fragt er nach einer Zusammenfassung, versprich keinen Versand; deine Empfehlungen und der Warenkorb-Link stehen hier im Chat.“
- **EN:**
  ```
  ### Summary
  The customer is signed in with their customer account. Do NOT offer a summary by email (the tool is not available to you), never ask for an email address in the chat and do not bring up a newsletter or offers sign-up on your own. If they ask about the newsletter or offers themselves: never sign them up yourself, don't promise a sign-up and don't collect consent in the chat. If they want to know when a sold-out item is back in stock, use `show_contact_form` for that. {DL} Just keep advising normally.
  ```
  - `{DL}` with `summaryDownload`: "If they ask for a summary, they can download it as a PDF via the download icon at the top of the chat."
  - `{DL}` without: "If they ask for a summary, don't promise to send one; your recommendations and the cart link are right here in the chat."

This keeps marketing consent on the backend-served surfaces (popup/card, `lawyerApproved`, `consentTextShown` echoed; CONSENT_FLOW, AC §7.4) and away from model text. The back-in-stock sentence overrides the sold-out rule's "`offer_email_summary` oder `show_contact_form`" (§1 row 17) for tier 3. The same pre-existing gap in the captured and cap branches stays out of scope.

**Tests (`src/lib/system-prompt-core.test.mjs`).**
- The German golden stays byte-identical. The fixtures do not set `signedIn`, so the existing test must stay green unchanged.
- `signedIn: true`, DE:
  - The prompt contains `### Zusammenfassung\n` (heading plus newline).
  - It does **not** contain `### Zusammenfassung per E-Mail`, which is the heading of the captured, cap and offer branches.
  - It contains `show_contact_form` and „melde ihn nie selbst an“.
- `signedIn: true`, EN:
  - The prompt contains `### Summary\n`.
  - It does not contain `### Summary by email` or `### Offer a summary by email`.
  - It contains "never sign them up yourself".
- `summaryDownload: true` gives the PDF line with „Download-Symbol“ / "download icon". `false` gives no "PDF" in the section. Neither variant contains the quoted label „Zusammenfassung“ in the `{DL}` sentence.
- `signedIn` wins over `emailCaptured: true` and over `offersMade: 2`.

### A5. `src/lib/tools.ts`

Comment only. In the "NOTE on withholding offer_email_summary" (L73), add: "… or the session is signed in (tier 3, CA §6.0)".

---

## 3. Part B — Opt-in events carry `source` and `outcome` — PR 2

### B1. New pure core `src/lib/capture-funnel.mjs` (+ `capture-funnel.test.mjs`)

One vocabulary for the write side (routes) and the read side (dashboard, verify script):

```js
export const OPT_IN_SOURCES = Object.freeze(["mo_capture_form", "mo_signin", "mo_chat_gate"]);
export const OPT_IN_OUTCOMES = Object.freeze(["doi_required", "already_confirmed", "already_subscribed", "suppressed"]);
/** The offer_email_summary trigger enum — keep in sync with src/lib/tools.ts (inputSchema.trigger). */
export const TOOL_OFFER_TRIGGERS = Object.freeze(["recommendation_accepted", "comparison_delivered",
  "consideration_pause", "buying_intent", "checkout_intent"]);
/** Read side: tool enum + api/chat's fallback. */
export const OFFER_TRIGGERS = Object.freeze([...TOOL_OFFER_TRIGGERS, "unspecified"]);
/** Server-set or server-defaulted legacy markers, only consulted when `source` is missing. */
export const LEGACY_SOURCE_TRIGGERS = Object.freeze(["signin_optin", "chat_gate"]);

/** Write side (/api/capture-email): keep a client echo only when it is a tool enum value. */
export function storedOfferTrigger(raw) {
  return typeof raw === "string" && TOOL_OFFER_TRIGGERS.includes(raw) ? raw : null;
}

/** Read side: any stored trigger → bounded key. '' → 'none' (no offer), unknown text → 'other'. */
export function normaliseTrigger(raw) {
  if (typeof raw !== "string" || raw === "") return "none";
  return OFFER_TRIGGERS.includes(raw) ? raw : "other";
}

/** Write side: the outcome of a ticked marketing box, from the upsert result. null when not ticked. */
export function optInOutcome({ marketingConsent, suppressed, doiEmailRequired, marketingDoiStatus, subscribedElsewhere }) {
  if (!marketingConsent) return null;
  if (suppressed) return "suppressed";                       // never re-pended (CONSENT_FLOW)
  if (doiEmailRequired) return "doi_required";               // a DOI mail is due (not necessarily sent, F3)
  if (marketingDoiStatus === "confirmed") return "already_confirmed"; // Mo DOI on record
  if (subscribedElsewhere) return "already_subscribed";      // one consent (Shopify / earlier act)
  return null;                                               // unreachable with today's upsert
}

/**
 * The route's `alreadyConfirmed: true` answer, reconstructed from a stored opt-in:
 * already_confirmed ∪ already_subscribed ∪ (suppressed ∧ doiStatus 'confirmed') — the last is F2.
 */
export function isAlreadyConfirmedAnswer(outcome, doiStatus) {
  return outcome === "already_confirmed" || outcome === "already_subscribed"
    || (outcome === "suppressed" && doiStatus === "confirmed");
}

/** Read side: stored opted_in → outcome; legacy rows (no `outcome`) approximated by doiStatus. */
export function eventOutcome(outcome, doiStatus) {
  if (OPT_IN_OUTCOMES.includes(outcome)) return outcome;
  if (doiStatus === "pending") return "doi_required";        // legacy ≈ (rare: pending + subscribed elsewhere)
  if (doiStatus === "confirmed") return "already_confirmed";
  return "unknown";                                          // legacy 'none': Shopify-subscribed or suppressed
}

/**
 * Read side: stored submitted/opted_in → source. `source` is server-set and wins.
 * Legacy rows (no `source`) by the server-set or server-defaulted trigger: signin_optin is
 * server-set; chat_gate was only the DEFAULT of a client echo on the retired chat gate
 * (AC §7.6) — a non-default echo there lands in mo_capture_form (negligible, retired 2026-10-01).
 */
export function eventSource(source, trigger) {
  if (typeof source === "string" && source !== "") return OPT_IN_SOURCES.includes(source) ? source : "mo_capture_form";
  if (trigger === "signin_optin") return "mo_signin";
  if (trigger === "chat_gate") return "mo_chat_gate";
  return "mo_capture_form";
}

/** Write side (confirm route): session's DOI opt-in, else latest pending consent row, else 'mo'. */
export function confirmationSource({ sessionSource, pendingSource }) {
  if (OPT_IN_SOURCES.includes(sessionSource)) return sessionSource;
  if (OPT_IN_SOURCES.includes(pendingSource)) return pendingSource;
  return "mo";
}

/**
 * Read side: a confirmed row → source. Event `source` wins; 'mo' → 'unknown'. Legacy {} rows
 * take the source of the session's latest DOI opt-in (query §5 c), else 'unknown'.
 */
export function confirmedSourceOf({ source, optInSource, optInTrigger, hasOptIn }) {
  if (typeof source === "string" && source !== "") return OPT_IN_SOURCES.includes(source) ? source : "unknown";
  return hasOptIn ? eventSource(optInSource, optInTrigger) : "unknown";
}

export function summariseCaptureFunnel({ rows, signedInAsks, confirmations }) { … }   // §5
export function summariseConsentSessions(rows) { … }                                  // §6
```

**Tests.**
- `optInOutcome`: the full matrix, including:
  - suppressed + previously confirmed gives `suppressed` (F2);
  - an unticked box gives `null`.
- `isAlreadyConfirmedAnswer`: matches the routes' `alreadyConfirmed` formula over every `upsertEmailCapture` branch, including `('suppressed','confirmed') → true`, `('suppressed','none') → false` and `('doi_required','pending') → false`.
- `eventOutcome` / `eventSource`:
  - the legacy mappings;
  - `eventSource('mo_capture_form', 'signin_optin')` gives `mo_capture_form`, so a forged echo never moves a row into the sign-in funnel.
- Triggers:
  - `storedOfferTrigger('signin_optin')` and `storedOfferTrigger('x'.repeat(40))` give `null`;
  - `normaliseTrigger('')` gives `none`, `normaliseTrigger('foo')` gives `other`, and `normaliseTrigger('unspecified')` stays `unspecified`.
- `confirmationSource`: the session wins over pending; pending is the fallback; `{}` gives `mo`.
- `confirmedSourceOf`:
  - `{source:'mo'}` gives `unknown`;
  - legacy `{}` with a session opt-in `{source:'mo_signin'}` gives `mo_signin`;
  - legacy `{}` with a legacy opt-in `{trigger:'signin_optin'}` gives `mo_signin`;
  - legacy `{}` without an opt-in gives `unknown`.
- The summariser cases in §5 and §6.

### B2. `src/lib/email-capture-store.ts → upsertEmailCapture`

`UpsertCaptureResult` gets two additive fields: `suppressed: boolean` and `optInOutcome: OptInOutcome | null`. Both are computed with `optInOutcome({...})` from values the function already holds. Nothing else changes, so the DOI state machine is untouched (F1 is not addressed here).

### B3. The three opt-in routes

`data` is exactly as follows; all old keys stay.

**`src/app/api/capture-email/route.ts`** (L185-198):
```ts
const outcome = capture.optInOutcome;            // null unless marketing was ticked
const storedTrigger = storedOfferTrigger(trigger); // client echo → tool enum or nothing (request still accepted)
data: { marketingConsent, source: "mo_capture_form", ...(outcome ? { outcome } : {}), ...(storedTrigger ? { trigger: storedTrigger } : {}) }   // _submitted
data: { doiStatus: capture.marketingDoiStatus, source: "mo_capture_form", ...(outcome ? { outcome } : {}), ...(storedTrigger ? { trigger: storedTrigger } : {}) } // _opted_in
```

**`src/app/api/account/marketing-opt-in/route.ts`** (L157-168): the same, with `source: "mo_signin"`.
- Keep `trigger: "signin_optin"` (server-set) for older readers and the verify script.
- This is the countable form of user item 3: the response's `alreadyConfirmed: true` ≡ `isAlreadyConfirmedAnswer(outcome, doiStatus)`, that is `outcome ∈ {already_confirmed, already_subscribed}` **or** (`outcome = 'suppressed'` ∧ `doiStatus = 'confirmed'`). The last case is F2 and is reported in its own bucket.

**`src/app/api/chat-marketing-opt-in/route.ts`** (L186-195, retired surface): add `source: "mo_chat_gate"` and leave `trigger` as is.

The new keys and the capture form's stored `trigger` are enums only. There is no e-mail, no customer id and no token (AC §5, 05 §13.3). The two remaining free-text paths are:
- `email_capture_declined.trigger` (widget, via `/api/kpi`);
- the retired chat gate's echo.

The read side bounds both with `normaliseTrigger` (§5).

---

## 4. Part C — DOI confirmation carries its source — PR 2

**`src/lib/consent-flows.ts → recordDoiConfirmed`** returns the surface it already computes. The consent record is unchanged: `consent_events.source` stays `pendingSurface`.

```ts
export async function recordDoiConfirmed(input: { email: string; captureId?: number | null }): Promise<ConsentSource | null> {
  const customerId = await customerIdForEmail(input.email);
  if (!customerId) return null;
  const source = await pendingSurface(customerId);   // read BEFORE the subscribe act
  const res = await applyConsentAct({ customerId, incoming: { state: "subscribed", level: "confirmed_opt_in", at: new Date().toISOString(), source }, originRef: … });
  if (res) await runOutboxInline(res.outboxIds);
  return source;
}
```

**New `src/lib/kpi-events.ts → latestDoiOptInSource(sessionId, sql: Sql | null = getSql())`** is null-safe, uses `try/catch` + `reportError(err, { route: "lib/kpi-events", phase: "latestDoiOptInSource" })`, and returns `null` on any problem:

```sql
SELECT COALESCE(data->>'source', '') AS source, COALESCE(data->>'trigger', '') AS trigger
  FROM kpi_events
 WHERE session_id = ${sessionId}
   AND event = ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}
   AND (data->>'outcome' = 'doi_required'
        OR (data->>'outcome' IS NULL AND data->>'doiStatus' = 'pending'))
 ORDER BY created_at DESC, id DESC
 LIMIT 1
```

It maps the row with `eventSource(source, trigger)`, so legacy opt-ins from before the deploy resolve too. It uses `kpi_events_session_idx` (migration 0031).

**`src/app/api/confirm-marketing/route.ts`** (L50-61): merge the two `if (!result.alreadyConfirmed)` blocks.

```ts
if (!result.alreadyConfirmed) {
  const pendingSource = await recordDoiConfirmed({ email: result.email });
  const sessionSource = result.sessionId ? await latestDoiOptInSource(result.sessionId) : null;
  await recordKpiEvent({
    sessionId: result.sessionId,
    event: KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED,
    data: { source: confirmationSource({ sessionSource, pendingSource }) },
  });
}
```

Why the session comes first: the capture row's `session_id` is the latest submitter's session, and that submit issued the live token (§1 row 12). A person who opts in on surface A and then on surface B within the DOI window is credited to B. `pendingSurface` would credit A, because B's pending act was an echo with no `consent_events` row.

Remaining limitations (documented in `capture-funnel.mjs` and the InfoTip):
- If the latest submit had no session, `session_id` keeps the older session. The session lookup may then find A's opt-in.
- The KPI source and `consent_events.source` can differ in that rare A→B case. The consent history is not rewritten here.

A DOI clicked after the deploy for an opt-in made before it still gets the right source, through the legacy mapping of the session's opt-in or through `pendingSurface`. Confirmations recorded **before** the deploy have `{}`. The dashboard attributes them the same way at read time (§5 c), so the per-source numbers do not collapse in a 30-day range (`DEFAULT_KPI_PRESET = "30d"`, `kpi-range.mjs`).

The popup vs. the inline card **cannot** be split backend-only: the opt-in body has no placement field (05 §13.4 "Measure DOI completion per surface"). That would be a separate widget task and is out of scope here.

---

## 5. Part D — `kpi-store.ts → getEmailCaptureFunnel()` (capture form only) — PR 2

### SQL

Three queries in `Promise.all`, each spelled out (no nested fragments). `KNOWN_TRIGGERS = [...OFFER_TRIGGERS, ...LEGACY_SOURCE_TRIGGERS]` comes from the core and is passed as one array parameter, as in `admin-conversations.ts` (`= ANY(${…}::text[])`).

**(a) Grouped capture events (without confirmations).** Triggers are bounded in SQL: forged values collapse into `other`, so there are no unbounded GROUP BY rows.

```sql
SELECT event,
       COALESCE(data->>'source', '')    AS source,
       CASE WHEN COALESCE(data->>'trigger', '') = '' THEN ''
            WHEN data->>'trigger' = ANY(${KNOWN_TRIGGERS}::text[]) THEN data->>'trigger'
            ELSE 'other' END            AS trigger,
       COALESCE(data->>'outcome', '')   AS outcome,
       COALESCE(data->>'doiStatus', '') AS doi_status,
       count(*)::int                    AS n,
       (count(DISTINCT session_id) + count(*) FILTER (WHERE session_id IS NULL))::int AS sessions
  FROM kpi_events
 WHERE event IN (${KPI_EMAIL_CAPTURE_ASK_SHOWN}, ${KPI_EMAIL_CAPTURE_SUBMITTED},
                 ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}, ${KPI_EMAIL_CAPTURE_DECLINED})
   AND created_at >= ${range.from}::date
   AND created_at < (${range.to}::date + 1)
 GROUP BY 1, 2, 3, 4, 5
```

**(b) Asks in sessions that were already signed in in the chat.** The widget hid these cards. After the PR 1 deploy this should be about 0: only fail-open turns and widget-side signed-in states the server did not see.

```sql
SELECT COALESCE(NULLIF(a.data->>'trigger', ''), 'unspecified') AS trigger, count(*)::int AS n
  FROM kpi_events a
 WHERE a.event = ${KPI_EMAIL_CAPTURE_ASK_SHOWN}
   AND a.session_id IS NOT NULL
   AND a.created_at >= ${range.from}::date
   AND a.created_at < (${range.to}::date + 1)
   AND EXISTS (SELECT 1 FROM kpi_events s
                WHERE s.session_id = a.session_id
                  AND s.created_at <= a.created_at
                  AND (s.event = ${KPI_ACCOUNT_SIGNIN_LINKED}
                       OR (s.event = ${KPI_ACCOUNT_SIGNIN_SUCCEEDED}
                           AND s.created_at < ${SIGNIN_OUTAGE.from}::date)))
 GROUP BY 1
```

- `SIGNIN_OUTAGE.from` (`2026-10-03`, from `kpi-releases.mjs`) is the day of migration 0073. Before it, `account_signin_succeeded` alone signed the chat in (§1 row 18). From that day only `account_signin_linked` counts.
- `ask_shown` triggers are server-written (tool enum or `unspecified`) and need no SQL bounding.
- This uses the existing `kpi_events_session_idx` (migration 0031).
- Sign-out rotates the sid (04 §7.8), so "linked earlier in the same sid" is a good proxy for "signed in at ask time".
- Code comment for one edge case: a server-side sign-out after a revoked token (`auth/me` → `signOutSessionLinks`, `src/app/api/auth/me/route.ts` L64-71) keeps the sid. Later visible asks in that sid are then wrongly treated as hidden. This is rare and slightly understates „Angeboten“.

**(c) Confirmations with source; legacy `{}` rows attributed through the session's latest DOI opt-in.**

```sql
SELECT COALESCE(c.data->>'source', '') AS source,
       COALESCE(o.data->>'source', '')  AS opt_in_source,
       CASE WHEN o.data->>'trigger' IN ('signin_optin', 'chat_gate') THEN o.data->>'trigger' ELSE '' END AS opt_in_trigger,
       (o.data IS NOT NULL)             AS has_opt_in,
       count(*)::int                    AS n
  FROM kpi_events c
  LEFT JOIN LATERAL (
         SELECT x.data FROM kpi_events x
          WHERE COALESCE(c.data->>'source', '') = ''
            AND c.session_id IS NOT NULL
            AND x.session_id = c.session_id
            AND x.event = ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}
            AND x.created_at <= c.created_at
            AND (x.data->>'outcome' = 'doi_required'
                 OR (x.data->>'outcome' IS NULL AND x.data->>'doiStatus' = 'pending'))
          ORDER BY x.created_at DESC, x.id DESC
          LIMIT 1) o ON true
 WHERE c.event = ${KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED}
   AND c.created_at >= ${range.from}::date
   AND c.created_at < (${range.to}::date + 1)
 GROUP BY 1, 2, 3, 4
```

The opt-in may lie before the window; the lateral has no lower bound. Rows with a `source` skip the lookup, because of the first condition inside the lateral.

### Aggregation in the tested core

`capture-funnel.mjs → summariseCaptureFunnel({ rows, signedInAsks, confirmations })` returns:

```ts
interface CaptureSourceCounts {
  submitted: number; optedIn: number;
  doiRequired: number;                 // „DOI-Mail fällig“ (incl. failed/skipped sends, F3)
  alreadySubscribed: number;           // already_confirmed + already_subscribed („Bereits abonniert“)
  suppressed: number; suppressedConfirmed: number;  // F2: of suppressed, widget answered „bereits angemeldet“
  unknownOutcome: number;              // legacy 'none'
  alreadyAnswers: number;              // isAlreadyConfirmedAnswer — the routes' alreadyConfirmed:true
  confirmed: number; doiRate: number | null;        // confirmed ÷ doiRequired (clamped 0..1)
}
interface EmailCaptureFunnel {
  askShown: number; askShownSignedIn: number; visibleAsks: number;   // visible = all − signed-in
  submitted: number;            // source mo_capture_form (offer card + „Per E-Mail teilen“ + 422 fallback)
  submittedFromOffer: number;   // … with a tool trigger (OFFER_TRIGGERS)
  submittedWithoutOffer: number;// … trigger 'none' (legacy 'other' counts here too)
  marketingOptedIn: number; confirmed: number;   // capture form
  capture: CaptureSourceCounts;                  // = bySource.mo_capture_form
  bySource: Record<"mo_capture_form" | "mo_signin" | "mo_chat_gate", CaptureSourceCounts>;
  confirmedTotal: number;                        // every confirmation in the window
  confirmedUnknownSource: number;                // no source and no attributable session opt-in
  confirmedLegacyAttributed: number;             // {} rows attributed via the session's opt-in
  declined: number;             // Σ distinct sessions per normalised trigger (05 §4.7)
  declinedEvents: number;
  submitRate: number | null;    // submittedFromOffer ÷ visibleAsks
  doiRate: number | null;       // capture.confirmed ÷ capture.doiRequired
  overallDoiRate: number | null;// confirmedTotal ÷ Σ doiRequired
  byTrigger: Array<{ trigger: string; asks: number; visibleAsks: number; submitted: number; optedIn: number; declined: number; submitRate: number | null }>;
  legacyEvents: number;         // opted_in without `outcome` + confirmed without `source` in the window → caveat
}
```

Field notes:
- Rows are mapped with:
  - `eventSource(source, trigger)` (the legacy trigger is only consulted when `source` is empty);
  - `eventOutcome(outcome, doiStatus)`;
  - `normaliseTrigger(trigger)`.
- Confirmations are mapped with `confirmedSourceOf`.
- `byTrigger` keys: the five tool triggers, `unspecified`, `none` (no trigger = „Per E-Mail teilen“ or the 422 fallback, asks „–“) and `other` (unknown client text, only shown when > 0).
- `asksByTrigger` is replaced by `byTrigger`. `EmailCaptureSection` is the only consumer.
- Event counting stays **windowed**, with the same caveat as today.

**Tests (`capture-funnel.test.mjs`).**
- A sign-in opt-in never lands in `capture`.
- A capture-form submit that echoes `trigger:'signin_optin'`, with `source:'mo_capture_form'`, stays in `capture` (forged echo).
- Header-share submits don't enter `submitRate`.
- Already-subscribed and suppressed opt-ins don't enter the `doiRate` denominator.
- `suppressed` + `doiStatus:'confirmed'` counts in `suppressedConfirmed` and `alreadyAnswers`.
- Legacy rows: `{doiStatus:'pending'}` without outcome counts as `doiRequired`; `{doiStatus:'none'}` counts as `unknownOutcome`.
- Confirmations:
  - legacy `{}` with an attributable session opt-in counts under that source and in `confirmedLegacyAttributed`;
  - `{}` without one, and `{source:'mo'}`, go to `confirmedUnknownSource`;
  - `confirmedTotal` equals the sum over all of them.
- Declines: 3 rows of one session × one trigger give 1. Two forged trigger strings collapse into one `other` row.
- Zero denominators give `null`; rates are clamped.

---

## 6. Part E — `kpi-store.ts → getConsentGateFunnel()` per session, with server stages — PR 2

Keep today's query **unchanged** for `total` and `bySurface` (event counts). They are still used for the retired „Chat-Gate“ sub-block (KPI-24), the „ohne surface-Angabe“ note and the empty-state check. Add a per-session query for `surface: signin` plus the server opt-in. The legacy `trigger` is only consulted when `source` is missing, so a forged echo cannot enter.

```sql
WITH s AS (
  SELECT session_id,
         bool_or(event = ${KPI_CONSENT_GATE_SHOWN})     AS shown,
         bool_or(event = ${KPI_CONSENT_GATE_ACCEPTED})  AS accepted,
         bool_or(event = ${KPI_CONSENT_GATE_DECLINED})  AS declined,
         bool_or(event = ${KPI_CONSENT_GATE_DISMISSED}) AS dismissed,
         COALESCE(array_agg(DISTINCT COALESCE(data->>'outcome', 'legacy') || ':' || COALESCE(data->>'doiStatus', ''))
                  FILTER (WHERE event = ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}), '{}') AS outcomes
    FROM kpi_events
   WHERE session_id IS NOT NULL
     AND created_at >= ${range.from}::date
     AND created_at < (${range.to}::date + 1)
     AND ((event IN (${KPI_CONSENT_GATE_SHOWN}, ${KPI_CONSENT_GATE_ACCEPTED},
                     ${KPI_CONSENT_GATE_DECLINED}, ${KPI_CONSENT_GATE_DISMISSED})
           AND data->>'surface' = 'signin')
       OR (event = ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}
           AND (data->>'source' = 'mo_signin'
                OR (data->>'source' IS NULL AND data->>'trigger' = 'signin_optin'))))
   GROUP BY session_id
)
SELECT shown, accepted, declined, dismissed, outcomes, count(*)::int AS sessions
  FROM s
 GROUP BY 1, 2, 3, 4, 5
```

Arrays are aggregated distinct and sorted, so the result is a handful of rows and needs no row limit. Each element is `outcome:doiStatus`, for example `doi_required:pending`, `suppressed:confirmed` or `legacy:pending`.

**`capture-funnel.mjs → summariseConsentSessions(rows)`** returns `ConsentSigninSessions`:

| Field | Meaning |
|---|---|
| `shown` | Sessions with a shown event. |
| `accepted` | Sessions with an accept (the widget tap, sent only after a 2xx; 05 §4.6). |
| `declined` | Declined **and not** accepted. |
| `dismissed` | Dismissed and neither accepted nor declined. |
| `acceptedAndDismissed` | Diagnostic for 04 §10.2. |
| `acceptedWithoutShown` | Diagnostic: the shown event was lost. |
| `optedIn` | Sessions with a server opt-in. |
| `optedInAfterShown` | Sessions with shown **and** a server opt-in. This is the chart stage and is ≤ `shown` by construction. |
| `optedInDoi` | Some element maps to `doi_required` (via `eventOutcome`; `legacy:x` is parsed as doiStatus `x`). |
| `optedInAlready` | Not DOI, and some element is `already_*`. |
| `optedInSuppressed` | Not DOI or already, and some element is `suppressed`. F2; shown separately. |
| `optedInUnknown` | The rest (legacy `none`). |
| `alreadyAnswers` | Sessions where some element satisfies `isAlreadyConfirmedAnswer`. These are user item 3's `alreadyConfirmed` answers, including `suppressed:confirmed`. |
| `optedInWithoutAccept` | Server opt-in, but the widget's `_accepted` was lost (keepalive on close). |
| `acceptRate` | `accepted ÷ shown` |
| `optInRate` | `optedInAfterShown ÷ shown` |

Expose it as a new field `ConsentGateFunnel.signinSessions` (additive). `bySurface.signin` stays as event counts for compatibility but is no longer displayed.

**Measurement dependency (§ 25 TDDDG).** The per-session denominator „Angezeigt“, and with it `acceptRate` and `optInRate`, rests on `consent_gate_shown`. That impression is sent without an `analyticsProcessingAllowed()` gate, which is an open legal question (05 §13.3). If the lawyer decides impressions must be gated, the denominator shrinks and both rates jump without any real change in behaviour. In that case:
- add a `KPI_RELEASES` entry on that day;
- base the rate on the decision events (accepted + declined + dismissed) or on the server opt-in.

OI1 itself adds no interaction-free event.

**Tests.**
- Accepted + dismissed counts once, as accepted.
- Declined then accepted (two tabs) counts as accepted.
- A session with only `{outcomes:['already_confirmed:none']}` gives `optedInAlready = 1`, `alreadyAnswers = 1`, `optedInWithoutAccept = 1` and `optedInAfterShown = 0`.
- `['suppressed:confirmed']` gives `optedInSuppressed = 1` and `alreadyAnswers = 1`. `['suppressed:none']` gives `alreadyAnswers = 0`.
- `['legacy:pending']` gives `optedInDoi`.
- Several tab sessions (several `_shown`) under one sid give `shown = 1`.
- `optedInAfterShown ≤ shown` holds for every fixture.

---

## 7. Part F — Dashboard (German, tokens and primitives only) — PR 2

`src/app/admin/KpiTab.tsx`: pass `range` to `EmailCaptureSection`, and pass `captureFunnel?.bySource.mo_signin ?? null` to `ConsentGateSection` as `signinCapture`. No new queries.

Terminology: „angemeldet“ in the KPI tab means signed in („Anmelde-Popup“, „Im Chat angemeldet“). The marketing state is therefore „abonniert“ in both sections and in AD §5.7/§5.8. „angemeldet“ is used for sign-in only, and when quoting the widget's own copy.

### `src/app/admin/kpi/sections/EmailCaptureSection.tsx`

- **Title:** unchanged, „E-Mail-Capture-Funnel“.
- **`StageFunnelChart`:** „Formular gesendet“ → „Marketing-Haken“ → „DOI-Mail fällig“ → „DOI bestätigt“. „Angeboten“ moves out of the chart: header-share submits can exceed asks, so a chart starting at the asks would widen.
- **Stats** (`num`, `ratio` from `admin-format.mjs`):

| Stat | Value | Hint |
|---|---|---|
| „Angeboten“ | `visibleAsks` | `${num(askShownSignedIn)} weitere in angemeldeten Sitzungen (Karte ausgeblendet)`, only when > 0 |
| „Formular gesendet“ | `submitted` | `${num(submittedFromOffer)} nach Angebot (${ratio(submitRate)} der Angebote) · ${num(submittedWithoutOffer)} über „Per E-Mail teilen“` |
| „Marketing-Haken“ | `marketingOptedIn` | `${num(capture.doiRequired)} DOI-Mail fällig · ${num(capture.suppressed)} gesperrt` („gesperrt“ only when > 0) |
| „Bereits abonniert“ | `capture.alreadySubscribed` | „keine DOI-Mail nötig (Shop oder frühere Bestätigung)“ |
| „DOI bestätigt“ | `confirmed` | `${ratio(doiRate)} der fälligen DOI-Mails` |
| „Abgelehnt“ | `declined` | `Sitzungen je Auslöser · ${num(declinedEvents)} Klicks` |

- **`SubHeading` „Nach Auslöser“** (`Table` primitives, as in `LoginGateSection.tsx`).
  - Columns: Auslöser | Angeboten | Gesendet | Quote | Marketing-Haken | Abgelehnt.
  - Keep `TRIGGER_LABELS` and add `none: "Ohne Angebot („Per E-Mail teilen“)"` and `other: "Sonstiger Wert"`. Labels come only from this map; no raw string is rendered.
- **`SubHeading` „DOI-Bestätigungen nach Quelle“** (`StatGrid`).
  - The `SubHeading` InfoTip: „Alle Bestätigungen im Zeitraum: {confirmedTotal}.“
  - Each stat shows its confirmed value with the hint `${ratio(doiRate)} von ${num(doiRequired)} fälligen DOI-Mails`:
    - „E-Mail-Formular“;
    - „Nach der Anmeldung“;
    - „Chat-Gate (eingestellt)“, only if > 0;
    - „Quelle unbekannt“, only if > 0, with the InfoTip: „Bestätigungen ohne Quelle, für die in derselben Sitzung kein Opt-in mit DOI-Mail gefunden wurde.“
- **`INFO`** (`Explain`). The section's explanation belongs in this InfoTip, not in helper paragraphs:
  > Das E-Mail-Formular im Chat (Zusammenfassung per E-Mail): von Mo angeboten → Formular gesendet → Marketing-Haken → DOI-Mail → Double-Opt-in bestätigt. Opt-ins nach der Anmeldung stehen unter „Einwilligung nach der Anmeldung“.
  >
  > „Angeboten“ zählt nur Angebote, die Kund:innen sehen konnten — angemeldeten Sitzungen blendet das Widget die Karte aus, und Mo bietet sie dort seit dem {PR-1-Deploy-Tag} nicht mehr an. „Formular gesendet“ enthält auch „Per E-Mail teilen“ und das Formular nach einer Anmeldung ohne bestätigte Adresse; die Quote zählt nur Formulare nach einem Angebot. „Bereits abonniert“: Haken gesetzt, aber schon für Marketing eingewilligt — keine DOI-Mail. „DOI-Mail fällig“ zählt Opt-ins, für die eine DOI-Mail verschickt werden sollte — auch wenn der Versand fehlschlug; die DOI-Quote bezieht sich darauf.
  >
  > Ereigniszählung im Zeitraum: ein DOI-Klick, der ein Opt-in vom Vortag bestätigt, zählt im Zeitraum des Klicks. Die Quelle einer Bestätigung ist das letzte Opt-in mit DOI-Mail derselben Sitzung (selten falsch, wenn dieselbe Adresse kurz hintereinander über zwei Wege eingewilligt hat). „Abgelehnt“ zählt jede Sitzung einmal je Auslöser (eine gespeicherte Karte kann nach jedem Neuladen erneut abgelehnt werden). Vor dem {PR-2-Deploy-Tag} fehlen Ergebnis und Quelle; sie sind aus dem DOI-Status und dem Opt-in der Sitzung genähert.
- **`notes`:**
  - `releaseNotesFor("capture", range)` (§8);
  - when `legacyEvents > 0`: `${num(legacyEvents)} Events ohne Ergebnis/Quelle (vor dem {PR-2-Deploy-Tag}) — genähert, davon ${num(confirmedLegacyAttributed)} Bestätigungen über das Opt-in der Sitzung zugeordnet.`

### `src/app/admin/kpi/sections/ConsentGateSection.tsx`

- **`StageFunnelChart`:** „Angezeigt“ (`shown`) → „Opt-in gespeichert“ (`optedInAfterShown`) → „DOI bestätigt“ (`min(signinCapture.confirmed, optedInAfterShown)`).
  - The server opt-in is the truth.
  - Stage 2 is ≤ stage 1 by construction.
  - Stage 3 is clamped because it is a different unit (confirmations in the window). The stat shows the unclamped value.
  - „Akzeptiert“ is not a chart stage: every accept already implies a server opt-in (05 §4.6).
- **Stats:**

| Stat | Value | Hint |
|---|---|---|
| „Angezeigt“ | `shown` | „Sitzungen“ |
| „Akzeptiert“ | `accepted` | `${ratio(acceptRate)} Akzeptanzrate (Tipp im Widget)` |
| „Abgelehnt“ | `declined` | – |
| „Weggeklickt“ | `dismissed` | „ohne Zusage“ |
| „Opt-in gespeichert“ | `optedIn` | `${num(optedInDoi)} neue DOI · ${num(optedInAlready)} bereits abonniert` plus `· ${num(optedInSuppressed)} gesperrt` when > 0 |
| „DOI bestätigt“ | `signinCapture.confirmed` | `${ratio(signinCapture.doiRate)} der fälligen DOI-Mails` |

- **`notes`:**
  - `optedInWithoutAccept > 0`: „{n} Sitzungen mit gespeichertem Opt-in ohne „Akzeptiert“-Event (beim Schließen verloren).“
  - `acceptedAndDismissed > 0`: „{n} Sitzungen haben nach dem Akzeptieren weggeklickt — sie zählen als akzeptiert.“
  - `optedInSuppressed > 0`: „{n} Opt-ins für gesperrte Adressen — das Widget zeigte dort „bereits angemeldet“ ({alreadyAnswers − optedInAlready} davon).“
  - The existing release notes and `releaseNotesFor` for the split (§8).
- **`INFO`.** Update the header comment of the file ("measures the UI, not the DOI") to match. The InfoTip should say:
  - Counting is per session. A session counts once, with its final decision (accepted before declined before dismissed).
  - „Opt-in gespeichert“ comes from the server (`/api/account/marketing-opt-in`). „neue DOI“ means a confirmation mail is due. „bereits abonniert“ is the answer `alreadyConfirmed`.
  - The opt-in is effective only with the DOI click. „DOI bestätigt“ counts confirmations in the window, not sessions.
  - „Angezeigt“ rests on the widget's display event. If the legal assessment requires gating it (§ 25 TDDDG, open question), the rates change without any change in behaviour.
  - Keep the paragraph on the retired chat gate.
- **Empty state:**
  - `!funnel` → „Noch keine Daten.“
  - `funnel.total.shown === 0 && funnel.signinSessions.optedIn === 0` → the existing text.
  - Otherwise render the children. The sign-in block (chart + stats) renders only when `signinSessions.shown > 0 || signinSessions.optedIn > 0`. The retired „Chat-Gate (anonym) — eingestellt“ sub-block keeps its `chat.shown > 0` condition (KPI-24, event counts, unchanged), so a period with only `surface: chat` events still shows it.

---

## 8. Part G — Release annotation (`src/lib/kpi-releases.mjs` + test)

Coordinate with the parent's user item 2 edits: add entries, do not rewrite. Both date constants are set **at merge time** to the actual deploy day (YYYY-MM-DD, Europe/Berlin), not when the PR is written.

### G1 (PR 1)

- Export `SIGNEDIN_OFFER_OFF_FROM`.
- `KPI_RELEASES` entry:
  ```
  { date: SIGNEDIN_OFFER_OFF_FROM, key: "signedin-offer-off",
    title: "Keine E-Mail-Zusammenfassung mehr für angemeldete Kund:innen",
    detail: "Mo bietet angemeldeten Kund:innen die Zusammenfassung per E-Mail nicht mehr an (das Widget blendete die Karte ohnehin aus). „Angeboten“ im E-Mail-Capture-Funnel sinkt dadurch, die Quote steigt — kein Verhaltenswechsel der Kund:innen." }
  ```

### G2 (PR 2)

- Export `OPTIN_MEASUREMENT_FROM`.
- `KPI_RELEASES` entry:
  ```
  { date: OPTIN_MEASUREMENT_FROM, key: "optin-measurement",
    title: "Opt-in-Messung nach Quelle und Ergebnis",
    detail: "Opt-ins tragen Quelle und Ergebnis (neue DOI / bereits abonniert / gesperrt), DOI-Bestätigungen ihre Quelle. Der E-Mail-Capture-Funnel zählt nur noch das Formular; die Einwilligung nach der Anmeldung zählt Sitzungen statt Klicks." }
  ```
- New map `SPLIT_FROM = { capture: OPTIN_MEASUREMENT_FROM, consent: OPTIN_MEASUREMENT_FROM }`. When `range.from < SPLIT_FROM[section]`, `releaseNotesFor` adds:
  > „Ergebnis und Quelle der Opt-ins erst ab dem DD.MM.YYYY; ältere Events sind aus dem DOI-Status und dem Opt-in der Sitzung genähert. Zahlen vor und nach diesem Tag sind nicht direkt vergleichbar (Sitzungen statt Klicks, nur sichtbare Angebote).“

  The existing `consent` „Erst ab dem 04.10.2026 aussagekräftig“ note and the outage note stay.

### Tests (`kpi-releases.test.mjs`)

Existing assertions that must be **updated**, because they break once a release after 2026-10-04 exists:
1. „releases are ordered and dated as documented“: the `deepEqual` becomes `["2026-10-01", "2026-10-03", "2026-10-04", SIGNEDIN_OFFER_OFF_FROM]` in PR 1, plus `OPTIN_MEASUREMENT_FROM` in PR 2. The ascending order is asserted generically (`dates` sorted equals `dates`), so equal days in both PRs are fine.
2. „releasesInRange is inclusive“: `releasesInRange({from:'2026-10-05', to:'2026-10-30'})` is no longer `[]`. Replace it with a range starting the day after the latest release (computed from `KPI_RELEASES.at(-1).date`) expecting `[]`. Add a case where the deploy day is inside the range and returns the new key(s).
3. „a period entirely after the releases has no notes“: replace `from: '2026-10-05'` with the day after `OPTIN_MEASUREMENT_FROM` (computed), so the test survives a slipped deploy day. Include `capture` in the section list.

New tests:
- A 30-day range annotates `capture` and `consent` with the split note. For `consent` this means 3 notes in total: meaningful-from, outage and split.
- A range starting on `OPTIN_MEASUREMENT_FROM` has no split note.

---

## 9. Part H — `scripts/verify-live-kpis.mjs` §3 (read-only) — PR 2

Keep the script's own `q()` convention (`$1` = since, extra params from `$2`). Import `SIGNEDIN_OFFER_OFF_FROM` from `src/lib/kpi-releases.mjs`; the script already imports `.mjs` cores. Replace „Opt-ins über /api/account/marketing-opt-in … nach DOI-Status“ with the following.

```sql
-- Opt-ins nach Quelle und Ergebnis (alt = vor dem Deploy, aus doiStatus; trigger nur ohne source)
SELECT event,
       COALESCE(data->>'source', CASE data->>'trigger' WHEN 'signin_optin' THEN 'mo_signin'
                                  WHEN 'chat_gate' THEN 'mo_chat_gate' ELSE 'mo_capture_form' END) AS quelle,
       COALESCE(data->>'outcome', 'alt') || ':' || COALESCE(data->>'doiStatus', '–') AS ergebnis,
       count(*)::int AS events, count(DISTINCT session_id)::int AS sessions
  FROM kpi_events
 WHERE event IN ('email_capture_submitted', 'email_capture_marketing_opted_in') AND created_at >= ${SINCE}
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

-- alreadyConfirmed-Antworten (User-Punkt 3) = already_confirmed ∪ already_subscribed ∪ (suppressed ∧ confirmed)
SELECT COALESCE(data->>'source', CASE data->>'trigger' WHEN 'signin_optin' THEN 'mo_signin' ELSE 'mo_capture_form' END) AS quelle,
       count(*) FILTER (WHERE data->>'outcome' IN ('already_confirmed', 'already_subscribed'))::int AS bereits,
       count(*) FILTER (WHERE data->>'outcome' = 'suppressed' AND data->>'doiStatus' = 'confirmed')::int AS gesperrt_aber_bestaetigt_F2,
       count(*) FILTER (WHERE data->>'outcome' IS NULL)::int AS alt_ohne_ergebnis
  FROM kpi_events
 WHERE event = 'email_capture_marketing_opted_in' AND created_at >= ${SINCE}
 GROUP BY 1 ORDER BY 1;

-- DOI-Bestätigungen: Quelle aus dem Event; ältere über das letzte Opt-in mit DOI-Mail derselben Sitzung
SELECT COALESCE(c.data->>'source', '(ohne)') AS quelle_event,
       COALESCE(o.data->>'source', o.data->>'trigger', '(kein DOI-Opt-in in der Sitzung)') AS opt_in,
       count(*)::int AS events
  FROM kpi_events c
  LEFT JOIN LATERAL (SELECT x.data FROM kpi_events x
                      WHERE x.session_id = c.session_id AND x.event = 'email_capture_marketing_opted_in'
                        AND x.created_at <= c.created_at
                        AND (x.data->>'outcome' = 'doi_required'
                             OR (x.data->>'outcome' IS NULL AND x.data->>'doiStatus' = 'pending'))
                      ORDER BY x.created_at DESC, x.id DESC LIMIT 1) o ON true
 WHERE c.event = 'email_capture_marketing_confirmed' AND c.created_at >= ${SINCE}
 GROUP BY 1, 2 ORDER BY 1, 2;

-- Angebote in angemeldeten Sitzungen — nach dem PR-1-Deploy erwartet 0
SELECT (a.created_at >= (($2::date)::timestamp AT TIME ZONE 'Europe/Berlin')) AS nach_deploy, count(*)::int AS asks
  FROM kpi_events a
 WHERE a.event = 'email_capture_ask_shown' AND a.created_at >= ${SINCE}
   AND EXISTS (SELECT 1 FROM kpi_events s WHERE s.session_id = a.session_id
                 AND s.event = 'account_signin_linked' AND s.created_at <= a.created_at)
 GROUP BY 1;
```

`$2` is `SIGNEDIN_OFFER_OFF_FROM`: `q(text, [SIGNEDIN_OFFER_OFF_FROM])`. The script's default `since` is 2026-10-04, after 0073, so `account_signin_linked` alone suffices here. Also print the read-only counts for F1 and F2 from §1 (counts only, no e-mail).

Update ROLLOUT_TODO 1.11:
- In the open consent-popup item, replace "an opt-in with `doi_status = pending` (→ confirmed after the click)" with: "an opt-in `quelle = mo_signin`, `ergebnis = doi_required:pending` (the opt-in event keeps this; the click writes a separate `email_capture_marketing_confirmed {source: mo_signin}`)".
- Add: "`alreadyConfirmed` answers are counted in §3 „alreadyConfirmed-Antworten“: `bereits` + `gesperrt_aber_bestaetigt_F2`. Old rows (`alt_ohne_ergebnis`) cannot be classified."

---

## 10. Part I — Docs to update

**PR 1:**

| Doc | Change |
|---|---|
| `docs/API_CONTRACT.md` §2 `offer_email_summary` | One line: "Not emitted for a signed-in (tier-3) session since {PR-1 deploy day} (CA §6.0); the widget's own tier-3 suppression stays (stored parts from before a sign-in)." |
| `docs/frontend-handoff/CUSTOMER_ACCOUNT.md` §6.0 (L281-282) | Replace "This is purely a tier-3 frontend gate — the backend's capture flow is untouched" with: "frontend gate **and**, since {PR-1 deploy day}, the backend no longer offers `offer_email_summary` (nor forces the checkout-moment ask) for a live tier-3 session; the capture flow for tiers 1–2 is unchanged; the 422 `no_verified_email` fallback still opens the form." |
| `docs/CUSTOMER_ACCOUNT.md` "Where the opt-in is surfaced for tier 3 — and where it is NOT" (L754-768) and the header note (L11-12) | Same wording as the CA §6.0 change. In the subsection, "This is a **frontend gate on an existing field** — no backend behaviour change" becomes "a frontend gate on an existing field, and since {PR-1 deploy day} the backend also withholds the offer for a live tier-3 session". The header note mentions the server-side withholding in the "tier-3 suppression contract" sentence. |

**PR 2:**

| Doc | Change |
|---|---|
| `docs/API_CONTRACT.md` §5 "Email-capture funnel events" | `_submitted` `{ marketingConsent, source, outcome?, trigger? }`; `_marketing_opted_in` `{ doiStatus, source, outcome, trigger? }`; `_marketing_confirmed` `{ source }` (the session's DOI opt-in → pending consent row → `mo`). Enum tables for `source`/`outcome`, plus the `alreadyConfirmed` equivalence (`isAlreadyConfirmedAnswer`). The paragraph on `chat_gate`/`signin_optin` now says they keep `trigger`, also carry `source`, and that readers use `trigger` only when `source` is missing. Server-only, unchanged. |
| `docs/API_CONTRACT.md` `/api/capture-email` request (L1287) | `trigger`: "optional; echo of the offer's trigger (telemetry only). Values outside the tool enum are accepted but not stored." |
| `docs/ADMIN_DASHBOARD.md` §5.7 | Per session with the final state. Chart: Angezeigt → Opt-in gespeichert → DOI bestätigt; „Akzeptiert“ as a stat. Opt-in split neue DOI / bereits abonniert / gesperrt, `alreadyConfirmed` = „bereits abonniert“ + gesperrt-aber-bestätigt. Notes, the TDDDG dependency, the empty-state rule (the chat-gate block stays). Remove "measures the UI, not the DOI". |
| `docs/ADMIN_DASHBOARD.md` §5.8 | Capture form only; visible asks (incl. the pre-0073 `succeeded` rule); submit rate from offer submits; „Bereits abonniert“; „DOI-Mail fällig“ (send failures included) as the DOI-rate denominator; per-trigger table with normalised triggers; confirmations by source with legacy attribution through the session; decline dedupe; legacy approximation. |
| `docs/FEATURE_INVENTORY.md` KPI-22…29 | "Nachtrag {PR-2 deploy day}" rows: new stages and stats; the per-trigger table replaces the BarList. Nothing is removed: asks by trigger is kept as a column, and KPI-24 is unchanged. |
| `docs/frontend/04` §14 ("counted twice"), §17 ("dedupe accept and dismiss") | Backend status note: the dashboard now counts the sign-in opt-in once (consent section) and dedupes per session. |
| `docs/frontend/05` §4.6, §4.7, §12 (rows „E-Mail-Capture-Funnel“, „Einwilligung…“), §13.2, §13.3 (the consent denominator rests on `consent_gate_shown`), §13.4 ("Measure DOI completion per surface" → done server-side per source; popup vs. card still needs a widget `placement`) | Backend status notes. |
| `docs/frontend/07` §7 D11, D6 | D11: the server no longer creates new offers for tier 3; only restored parts remain. D6: judge it on „Opt-in gespeichert / DOI bestätigt“ in the consent section. |
| `docs/ROLLOUT_TODO.md` 1.11 | As in §9. |

`.env.example` needs nothing: there is no new env var. There is no migration, so there is nothing to tell the maintainer.

---

## 11. Tests and checks

- **New:** `src/lib/capture-funnel.test.mjs`. It covers:
  - `storedOfferTrigger`, `normaliseTrigger`, `optInOutcome`, `isAlreadyConfirmedAnswer`;
  - `eventOutcome`, `eventSource`, `confirmationSource`, `confirmedSourceOf`;
  - `summariseCaptureFunnel`, `summariseConsentSessions`.
- **Extended:**
  - `email-offer-trigger.test.mjs`;
  - `system-prompt-core.test.mjs` (golden unchanged + signed-in cases with exact headings);
  - `kpi-releases.test.mjs` (three existing assertions updated, new cases; §8).
- **Optional:** in `scripts/seed-dev.mjs`, seed `opted_in` with `{source, outcome, doiStatus}` and `confirmed` with `{source}`, plus one legacy `{}` confirmation with a session opt-in, so the local dashboard shows the splits and the attribution.
- **Run, per PR:** `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test`. All must be clean.
- **UI (PR 2):** Playwright/Chromium screenshots of the KPI sections „Einwilligung nach der Anmeldung“ and „E-Mail-Capture-Funnel“ at 1440 px and 1024 px, light and dark, in the PR description. That includes one period with only retired `surface: chat` events, to show the chat-gate block survives the new empty-state rule.

**Commits** (small, in this order):
- **PR 1:**
  1. `chat: no e-mail-summary offer for signed-in sessions (CA §6.0 on the server)` (A1-A5)
  2. `kpi: release note for the signed-in offer change` (G1)
  3. `docs: AC §2, CA §6.0, CUSTOMER_ACCOUNT tier-3 suppression`
- **PR 2:**
  4. `kpi: source + outcome on opt-in events, source on DOI confirmation` (B, C)
  5. `kpi: capture funnel = capture form only, consent funnel per session with DOI stages` (D, E, F)
  6. `kpi: release note for the opt-in measurement` (G2)
  7. `verify:live: opt-ins by source/outcome, alreadyConfirmed answers, signed-in asks, DOI by source` (H)
  8. `docs: AC §5, AD §5.7/§5.8, inventory, frontend 04/05/07 status notes, ROLLOUT_TODO 1.11` (I)

---

## 12. Verify on live (after deploy; read-only except test accounts)

0. **Prerequisite:** `npm run verify:widget` reports the live build `3e87341` and OK. `SIGNEDIN_OFFER_OFF_FROM` / `OPTIN_MEASUREMENT_FROM` are set to the real deploy days.
   - Use a **fresh** plus-address per run (e.g. `name+oi1-<n>@…`). An address opted out in step 8 is suppressed and would produce `outcome:'suppressed'` (the F2 path) on reuse.
   - Note every test sid for step 7.
1. **Signed-in, no dead ask** (PR 1). Use the chat sign-in with a test account and a thread from „Neue Beratung“, so it has a `conversationKey`.
   - Get a recommendation and say „Das nehme ich“. Expect the `add_to_cart` card and no capture card.
   - This query must show no `email_capture_ask_shown` after the linked event: `SELECT event, data, created_at FROM kpi_events WHERE session_id = '<sid>' AND event IN ('account_signin_linked','email_capture_ask_shown','add_to_cart_clicked') ORDER BY created_at;`
   - Gespräche inspector: the turn's tool calls contain no `offer_email_summary`.
   - Ask „Kannst du mir das per Mail schicken?“. Mo must point to the download icon (PDF) and must not promise a mail or ask for an address.
   - Ask „Meldest du mich für den Newsletter an?“. Mo must not sign up, promise or collect consent.
   - Ask about a sold-out item's restock. Mo offers the contact form, not an e-mail.
2. **Anonymous regression** (private window, same flow): the capture card appears, and `email_capture_ask_shown {trigger:'checkout_intent', askNumber}` is recorded.
3. **Capture form outcomes** (PR 2).
   - New address with the marketing tick: `_submitted` and `_opted_in` carry `{source:'mo_capture_form', outcome:'doi_required', trigger}`. After the DOI click, `_confirmed {source:'mo_capture_form'}`.
   - The same address again with the tick: `outcome:'already_confirmed'`, and the widget shows its „Du bist bereits für unsere Angebote angemeldet“ copy.
4. **Sign-in opt-in (user item 3).**
   - Test account without a decision: accepting in the popup or card gives:
     - `_opted_in {source:'mo_signin', outcome:'doi_required', trigger:'signin_optin'}`;
     - `consent_gate_accepted {surface:'signin'}` in the same session;
     - after the DOI click, `_confirmed {source:'mo_signin'}`.
   - `alreadyConfirmed` path: open a second tab before deciding, accept and confirm in tab 1, then accept in tab 2. Expect `outcome:'already_confirmed'`, counted in `verify:live` §3 „alreadyConfirmed-Antworten“ → `bereits`.
   - If tab 2 shows no popup because its probe was fresh, that is correct behaviour (`optInActionable:false`). Use step 3's second submit instead.
5. **Script:** `npm run verify:live -- --since <PR-2 deploy day>`.
   - §3 shows the source × outcome table and the alreadyConfirmed counts. Read `gesperrt_aber_bestaetigt_F2` with the F2 count.
   - DOI confirmations by source.
   - „Angebote in angemeldeten Sitzungen“ with `nach_deploy = true` is 0. A few are fail-open turns: check Sentry for `lib/customer-memory` / `resolveSignedInMemory`.
   - Read the F1/F2 counts.
6. **Dashboard:** KPI tab with „Zeitraum…“ from the PR 2 deploy day.
   - The numbers match step 5.
   - „Änderungen im Zeitraum“ lists the release(s).
   - A 30-day range shows the split note in both sections, and „DOI-Bestätigungen nach Quelle“ shows older confirmations under their source, not as „Quelle unbekannt“.
7. **Watch for 7 days** (the DOI expiry window), excluding the test sids from step 0:
   - DOI rate per source (capture form vs. sign-in).
   - The `optedInWithoutAccept` share (widget event loss).
   - The „bereits abonniert“ share in the sign-in stage. A high value means `optInActionable` is stale; investigate in `resolveMarketingOptInState`.
   - `optedInSuppressed` (F2).
   - Signed-in asks stay at about 0.
8. **Cleanup of test consent** (right after steps 3-4, before any campaign send). A confirmed DOI subscribes the test customer and, with write-back on, pushes it to Shopify (`recordDoiConfirmed` → `runOutboxInline`). It would then match campaign audiences (`subscribed` and not blocked).
   - For each test address use Kunden → „Abmelden“ (`OptOutControl` → `/api/admin/customers/marketing-optout` → `optOutManually` → `recordMoWithdrawal` reason `manual`). That writes the suppression and the withdrawal and pushes it to Shopify.
   - Check the customer shows `unsubscribed` and has left any pending campaign queue.
   - Record the test sids in ROLLOUT_TODO 1.11.

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Periods spanning the deploys mix event shapes, and consent and decline numbers drop (sessions instead of clicks, visible asks only). | Two release entries, a split note per section and the `legacyEvents` note. The legacy mapping via `doiStatus`/`trigger` and the session-based attribution of old confirmations live in the tested core. |
| Old `{}` confirmations would read as „Quelle unbekannt“ and per-source DOI rates near 0 for about 30 days. | Read-time attribution through the session's latest DOI opt-in (§5 c). The rest is shown separately, and `confirmedTotal` stays visible. |
| Wrong confirmation source when one address opts in on two surfaces within the DOI window | Session-first attribution at confirm time (§4). The remaining edge cases are documented in the core and the InfoTip. |
| Client-controlled `trigger` (forged values, unbounded groups, a forged `signin_optin`) | The write side stores enums only. The read side bounds values in SQL and normalises them in the core. `source` wins over `trigger`, and `trigger` is only used for legacy rows. |
| „DOI-Mail fällig“ includes failed or skipped sends | Named and explained in the InfoTip. F3 is a follow-up. |
| Consent rates depend on an ungated impression (§ 25 TDDDG, 05 §13.3) | Stated in the plan and the InfoTip. If gated later: a release entry, and rates based on decisions or the server opt-in. |
| Transient sign-in lookup failure | Fail-open: the offer stays available (today's behaviour). A failure after the token check still reports `signedIn: true`. No extra lookups, because the existing resolution is reused. |
| Stored `offer_email_summary` parts from before a mid-conversation sign-in still render a card after reload (04 §18 item 2) | Widget fix D11, unchanged here. The server no longer creates new ones for tier 3. |
| Tier-3 customer without a verified e-mail | No loss: the widget already hid the card for tier 3. The 422 `no_verified_email` fallback still opens the capture form, and those submits count under the capture form without a trigger (noted in the InfoTip). |
| A pre-0073 or revoked-token session misclassifies asks as signed-in or visible | The `succeeded`-before-2026-10-03 clause covers the first case. The revoked-token case is documented in a code comment; its effect is small. |
| Legacy `doiStatus:'pending'` with `subscribedElsewhere` is classified as `doi_required` | Rare, documented in `eventOutcome`. Only affects data before the deploy. |
| Windowed counting: a confirmation can belong to an opt-in outside the window | Same caveat as today, stated in both InfoTips. The consent chart clamps stage 3. |
| Golden prompt regression | The explicit `emailOffer.signedIn` flag keeps fixture case 3 byte-identical, and the existing golden test pins it. |
| Live test consent leaks into audiences and KPIs | Step 8 cleanup, fresh addresses, and test sids excluded from the 7-day watch. |
| Accidental change to P0.6 | `getCoreMetrics` is not touched. All changes are confined to the two funnels, their sections and the chat offer gate. |

**Legal.** Nothing beyond the KPI privacy rules.
- The new keys are enums, and the stored capture `trigger` is now an enum too. The confirmed event stays keyed to the capture's pseudonymous session, as today.
- No consent path is removed: signed-in customers keep the sign-in popup/card, and the 422 fallback keeps the capture form.
- The prompt keeps marketing asks on backend-served, `lawyerApproved` surfaces, even when the customer asks in the chat.
- No interaction-free event is added. The existing impression dependency is documented (§6).
- No widget change, so no theme upload is needed.

**Dependencies.** None. This is a prerequisite for judging D6, OI3 and the App Proxy's opt-in effect on DOI-confirmed opt-ins.

Ranked follow-ups:
1. **F1** (lost pending DOI): directly lowers the DOI completion rate this item starts measuring.
2. **F2** (answer `status:'none', alreadyConfirmed:false` for suppressed addresses): backend-only, same shape, with a test.
3. **F3** (record the DOI mail actually sent).
4. Popup vs. card placement: a widget task, 05 §13.4.

---

## Verifier notes

I checked every finding against the cited code and docs. All are correct and applied. Points where the evidence differs slightly from the finding, or where an alternative was chosen:

- **DOI attribution of old confirmations (major).** I applied the LATERAL attribution in `getEmailCaptureFunnel` (§5 c), restricted to opt-ins with a DOI mail, the same filter as the confirm-time lookup. I also kept the total visible (`confirmedTotal`) instead of hiding per-source rates while `legacyEvents > 0`.
- **F2 follow-up.** "The widget's `other` branch then shows nothing" holds only for the capture form (04 L565). The sign-in popup and card show the neutral „Danke! / Wir haben deine Anmeldung erhalten.“ for `other` (04 §10.6, L583). That is still better than the false „bereits angemeldet“, so the follow-up stands and §1 F2 states the exact widget behaviour.
- **Duplicate finding.** The two findings on the `alreadyConfirmed` equivalence (Part B / §9 / §12, and §3 B3 / §6) are the same issue. Both are covered by `isAlreadyConfirmedAnswer`, the `alreadyAnswers` / `optedInSuppressed` buckets and the verify-script query.
- **Legacy trigger comment.** I reworded it as the finding asked. Separately, the optional write-side hardening from the trigger finding is applied to `/api/capture-email` only. The retired chat gate keeps its echo, bounded on the read side.
- **Effort.** Applied both options: re-estimated as M, and split into PR 1 (Part A + G1) and PR 2. Part G is therefore split into G1 and G2, with two date constants.
- **My own correction.** §1 row 10 of the previous draft misquoted ROLLOUT_TODO 1.11. It does not equate `doi_status confirmed` with `alreadyConfirmed`. It expects "an opt-in with `doi_status = pending` (→ confirmed after the click)", which is also inaccurate because the opt-in event never changes. Corrected in §1 and §9.