# Widget spec — motionsports.de Shopify chat widget

The deliverable: a **floating chat widget** for the motionsports.de
Shopify storefront. It talks to the headless chat backend documented in
`API_CONTRACT.md` and renders exactly the behavior documented in
`BEHAVIOR_REFERENCE.md`.

You do **not** have the backend repo. Everything you need about the wire
protocol is in `API_CONTRACT.md`; everything you need about rendering is
in `BEHAVIOR_REFERENCE.md`. This file specifies the *shipping form* of
the widget and the requirements it must meet.

---

## 1. Form factor & constraints

- **A Shopify theme snippet.** Ship a single Liquid snippet (e.g.
  `snippets/ms-chat-widget.liquid`) that the theme includes near the end
  of `theme.liquid` (before `</body>`), gated by an `ai_advisor_enabled`
  theme setting so it can be toggled without code changes. It contains
  the widget's markup root, its CSS, and its JS — or links to asset files
  (see below).
- **Page exclusions.** The widget MUST NOT render on `/cart` or any
  `/checkout` route. Gate this in the snippet via Liquid (e.g.
  `{% unless template contains 'cart' %}…{% endunless %}`). Additionally,
  expose a theme setting for an **excluded-templates list** so the
  operator can hide the widget from further templates (e.g. specific
  landing or contact pages) without code changes. Note that Shopify's
  checkout is not a normal theme template on most plans and the widget
  cannot reach it anyway; the meaningful exclusion is `/cart`.
- **Vanilla JS + CSS. No framework, no build step.** No React, no Vue, no
  bundler, no npm. Plain ES modules / a single IIFE script and hand-written
  CSS. It must run by dropping the snippet into a theme — nothing to
  compile.
- **Self-contained & isolated.** The widget must not collide with theme
  styles. Scope every selector under a single root (e.g. `.ms-chat`
  prefix on all classes) — or, preferably, render inside a **Shadow DOM**
  root so storefront CSS can't leak in and the widget CSS can't leak out.
  All injected DOM lives under one container element appended to
  `<body>`.
- **Asset layout** (recommended): keep CSS and JS in
  `assets/ms-chat-widget.css` and `assets/ms-chat-widget.js`, and have
  the snippet `{{ 'ms-chat-widget.css' | asset_url | stylesheet_tag }}` /
  `<script src="{{ 'ms-chat-widget.js' | asset_url }}" defer>`. The only
  thing that *must* live in the Liquid snippet itself is the injected
  config (§2). Inlining everything in the snippet is acceptable too.
- **No external runtime dependencies.** No CDN libraries. The SSE parsing,
  markdown subset, and DOM building are all hand-rolled. (The icons in the
  old UI came from `lucide-react`; reproduce them as small inline SVGs or
  a lightweight unicode/emoji fallback.)

---

## 2. Configuration injected via Liquid

The snippet reads settings from Liquid and hands them to the JS. At
minimum:

```liquid
<script>
  window.MS_CHAT_CONFIG = {
    apiBase: "https://chat.motionsports.de",
    chatKey: {{ settings.ms_chat_shared_secret | json }},
    // optional overrides:
    allowedFromTheme: true
  };
</script>
```

- `apiBase` — the backend origin (`https://chat.motionsports.de`).
- `chatKey` — the shared secret, read from a **theme/app setting**
  (`settings.ms_chat_shared_secret`, configured in `settings_schema.json`
  so a non-developer can paste it in the theme editor). This becomes the
  `x-ms-chat-key` header on every `/api/chat` and `/api/contact` request.
  See the security note in §9.

The JS must fail gracefully (log a warning, not throw, don't render the
launcher) if `chatKey` is empty.

---

## 3. Session id and conversation persistence

On first interaction, generate and persist a stable session id, exactly
as in `API_CONTRACT.md` §5:

```js
let sid = localStorage.getItem("ms-chat-sid");
if (!sid) { sid = crypto.randomUUID(); localStorage.setItem("ms-chat-sid", sid); }
```

Send it as the `x-ms-session` header on **every** request to `/api/chat`,
`/api/contact`, and `/api/products`. (Products doesn't require the chat
key but should still carry the session id for rate-limit keying.)

Conversation state lives **only** in the widget (the backend persists
nothing). **The widget MUST persist the message history to
`localStorage`** keyed by session id, so the conversation survives page
navigation across the storefront. Shoppers routinely navigate between
product pages mid-conversation; a chat that resets on every nav is a
poor experience and not acceptable.

Persistence rules:

- Restore the message list from `localStorage` on widget init; if a
  history exists, skip the welcome state and show the messages.
- Persist after every user send and after every completed assistant
  message (don't write on every streamed token — too noisy).
- Clear the persisted history when the user **explicitly starts a new
  chat** (e.g. via the start-new-chat affordance after the 40-message
  cap, §8). Rotate the session id at the same time so rate-limit windows
  reset cleanly.
- Cap the persisted payload (e.g. trim to the last 40 messages, matching
  the backend's cap) to keep `localStorage` writes cheap.
- If `localStorage` is unavailable (private browsing, quota exceeded),
  fall back silently to in-memory state for the page session — never
  throw.

---

## 4. UI structure & states

### 4.1 Launcher button

- A floating circular button, fixed to a bottom corner (bottom-right by
  default), above storefront content (high `z-index`, but below modals if
  the theme has any). It is styled as a **liquid-glass button**: a thin
  light keyline over a barely-there translucent fill with a strong frosted
  `backdrop-filter: blur + saturate` (degrading to the faint translucent
  fill alone where unsupported). The **animated brand mark** (§4.1a) in
  its **full-motion** variant fills it edge-to-edge, so the button IS the
  clear glass sphere with the light-strands floating inside, plus a soft
  pulsing halo. The launcher is the prime place where drawing the eye is
  the goal.
- Clicking it toggles the panel open/closed. While the panel is open the
  launcher is hidden (the close (×) lives in the panel header).
- **Beta badge (feature 10):** a small, subtle "Beta" pill sits on the
  launcher's top edge (accent fill, uppercase, ~0.6rem) so users know the
  advisor is in development. It lives *inside* the launcher button
  (decorative, `aria-hidden`; the launcher's `aria-label` is
  "Chat öffnen (Beta)"), so it hides with the launcher while the panel is
  open, never blocks the click, and stays within the launcher's safe-area
  offsets on mobile.

### 4.1a The animated brand mark (`.ms-chat-logo`)

- The Mo logo is **no longer an image asset**: it is a self-contained,
  Siri-style **liquid-glass sphere** — a CLEAR frosted bubble (no dark
  fill) with a **chromatic rim light** (mint at the top, red bottom-left,
  blue bottom-right, via layered inset shadows) and a bundle of **true
  sine waves** flowing left-to-right inside. Implementation: the
  `.ms-chat-logo` root span carries the glass in pure CSS (a faint
  translucent fill + `backdrop-filter: blur + saturate` frost + the rim,
  `overflow: hidden`, pill radius); the waves are a tiny **inline SVG**
  (`LOGO_WAVES` in the JS — injected by `logoEl()` and, for the
  server-rendered product-CTA span, at `init()`): cubic-bézier
  **S-curves** that all start at `(0, 50)` and end at `(100, 50)` — the
  **same two anchor points** on the bubble's midline — and crest/trough
  in between with different amplitudes and phases. The cool bundle
  (blue → cyan → mint, 3 strands + a wide faint glow copy) crests left
  and troughs right; the warm bundle (cream → amber → orange → red,
  2 strands + glow) is mirrored, so the bundles cross like the reference.
  Strokes are painted by horizontal gradients that fade out at both ends
  (the bundle converges and dissolves at its shared origins); only a
  sub-pixel `blur(...)` is applied, so the strands stay **distinct**.
  No image file, no external request, no library.
- **Pinned-anchor motion / seamless loop:** the two `<g>` bundles are
  animated with CSS keyframes; the animation reads as the waves flowing
  left-to-right while staying attached at both ends. Only `scaleY`
  (amplitude breathing) and `skewX` (crest lean) are animated, about the
  viewBox centre (`transform-box: view-box`) — both transforms leave the
  midline, and therefore both anchor points, mathematically fixed. Three
  unevenly spaced keyframe stops per loop, two different bundle speeds
  and an offset phase make the wavelength/amplitude/phase drift feel
  random and organic, while symmetric keyframes (0% == 100%) keep each
  loop seamless; a `hue-rotate` swing shifts the colors as they move.
- **Crisp at any size:** everything is vector- and gradient-based (the
  SVG scales with its span; stroke widths are viewBox-relative), so the
  mark scales
  from the 96px welcome hero down to the 36px avatar/CTA. Custom
  properties tune it per context: `--msc-logo-dur` (wave cycle; longer =
  calmer), `--msc-logo-blur` (strand softness — keep small),
  `--msc-logo-rim` (rim-light thickness — scale roughly with rendered
  size) and `--msc-logo-base` (the translucent glass fill). The component
  intentionally does not depend on the `--msc-*` theme tokens, so it also
  works outside `.ms-chat-root` (the product-page CTA, which re-asserts
  the rim `box-shadow` past the kurzinfo block's reset).
- **Placement rules — animated where it helps, calm where it doesn't:**
  - **Launcher:** full motion (~7s base cycle) + a soft pulsing outer halo.
  - **Welcome state (empty chat):** a 96px full-motion orb is the hero of
    the panel — there is nothing to read yet, so motion is welcome here.
  - **Product-page CTA:** the same orb slowed to a gentle ~22s cycle, so it
    reads as alive without being noisy next to body copy.
  - **In-chat assistant avatar:** **static** — animation disabled, leaving
    a still gradient frame. A constantly-moving element next to every
    message would hurt readability. (One exception: while a reply is
    *generating*, the pending row's avatar animates as the loading
    indicator — see §4.2 "Generating indicator".)
- **Reduced motion:** under `prefers-reduced-motion: reduce` **all**
  variants (launcher, halo, welcome, CTA) freeze to the static frame.
- The previous artwork (`assets/ms-chat-logo-v2.svg`) is no longer
  referenced by the widget or the product template.

### 4.2 Expandable panel

- An anchored panel that expands from the launcher: a header, a scrollable
  message area, and an input row — i.e. the same three-part chat layout
  the old full-page UI had, shrunk into a panel.
- **Header**: the chatbot's name "**Mo**" (feature 11 — same wordmark type
  treatment, bold accent; replaces the "**motion**sports" wordmark) +
  header buttons: a **"Per E-Mail teilen"
  text button** (feature 7 — opens the email-summary capture form on demand,
  see §6a; hidden until the first user message, see below), a
  **layout-mode toggle** (desktop only — switches sidebar ⇄ centered modal,
  see §4.4; hidden on mobile), a new-chat button, and a close button.
- **Share button visibility (feature 7):** in a new conversation with no
  message sent the share button is **hidden**. As soon as the first user
  message is sent (and whenever a non-empty history is restored from
  `localStorage`), it appears in the header with a subtle fade/scale
  blend-in (~420ms, disabled under `prefers-reduced-motion`) and stays
  available for the rest of the conversation. It is a real `<button>`,
  keyboard-focusable, with an `aria-label`; clicking it does exactly what
  the old share icon did (`openCaptureForm()`).
- **Message area**: shows the **welcome state** until the first message
  **and** when no persisted history exists. The welcome state is the
  **96px animated brand orb** (§4.1a, full motion) — no wordmark; the prompt
  ("Wie kann ich dir helfen?") lives in the
  composer's placeholder instead (visual replacement for the
  `BEHAVIOR_REFERENCE` §4 text-based welcome). Beneath the orb, **2-3
  context-seeded tappable starter prompts** render (§9c — this deliberately
  supersedes the earlier "no copy at all" welcome rule; the orb stays the
  hero, the chips are quiet bordered pills). If a history was restored
  from `localStorage`,
  render it directly and skip the welcome state.
- **Message styling — borderless / document style** (supersedes BOTH earlier
  designs: the bordered-assistant bubbles and the later filled light-blue
  bubbles): **assistant (Mo)** messages render as plain flowing text directly
  on the panel surface — **no bubble, no fill, no border** — like a modern AI
  UI's responses, preceded by the small **static logo avatar** (§4.1a) as the
  speaker marker. **User** messages keep only a **very light, low-contrast
  fill** (foreground token at low alpha, soft radius, right-aligned, no
  corner "tail") — enough to mark the turn, never a heavy colored bubble.
  The asymmetry (assistant = plain text, user = lightly marked) is
  intentional. Generous vertical spacing between turns and a slightly airier
  line-height keep it calm and readable; identical in sidebar, modal and
  mobile fullscreen. Tool cards sit inline in this borderless flow as
  monochrome hairline-bordered blocks (see §6 card styling).
- **Input area — unified composer** (supersedes the earlier "input row"
  and the compressed-view input tweak; identical in sidebar, modal and
  mobile fullscreen):
  - **One unified container:** the textarea and the action buttons live
    inside a SINGLE rounded surface with ONE shared border
    (`.ms-chat-composer`) — not a bordered textarea plus separate buttons.
    The textarea itself is **borderless and transparent** on the
    container's light surface; the focus ring is on the container
    (`:focus-within` accent border + soft glow), not the field. Clicking
    the container's padding focuses the textarea.
  - **Two-row internal layout:** the text sits on top (full width); a
    bottom control row holds the right-aligned actions — the mic
    (when Web Speech is supported) and the send button. The bottom row
    keeps a stable height whether or not send is shown.
  - **Soft large radius + generous padding:** corner radius is the block
    radius token + 8px (≈24px — soft, not a pill, not sharp) with
    comfortable internal padding; light theme tokens throughout (no dark
    input).
  - **Send appears on typing:** with an EMPTY input there is no visible
    send button (the mic is the persistent action). As soon as the input
    has ≥1 non-whitespace character the send button blends in (subtle
    fade/scale, ~160ms, collapsed-width so the mic glides over); emptying
    the input hides it again. Toggled centrally in `autoGrow()`
    (`.ms-chat-send--hidden`), so typing, voice dictation, send-clear and
    error-restore all stay in sync. Hidden = `visibility:hidden`, so it
    also leaves the tab order. Transition disabled under
    `prefers-reduced-motion`.
  - **Capped auto-grow + internal scroll:** the textarea auto-grows with
    typed lines up to a max height (120px ≈ 5 lines, the JS cap matches
    the CSS `max-height`), after which the container STOPS growing and
    the textarea scrolls internally (`overflow-y: auto`). It never grows
    unbounded and never pushes the panel layout.
  - **Quiet chrome:** muted placeholder ("Wie kann ich dir helfen?" — it
    doubles as the welcome prompt), **no scrollbar UI** inside the field
    (`scrollbar-width: none` / hidden `::-webkit-scrollbar`; past the cap
    it still scrolls via wheel/touch/caret), low-contrast ghost mic
    (accent fill + pulse only while recording), the dark accent send
    circle (↑) as the single strong element. On open the field is
    re-measured (`autoGrow()`) because the init-time measurement ran on a
    hidden panel.
  - Enter sends, Shift+Enter inserts a newline; the whole composer is
    disabled while a response streams. The
    `"KI-Fitnessberater – Antworten können Fehler enthalten"` disclaimer
    sits centered directly beneath the container.
- **Voice input** (Web Speech API): a mic button left of send dictates German
  (`de-DE`) speech into the textarea, with live interim text and append-to-typed
  behaviour; tap again (or send) to stop. It is **feature-detected** — only
  rendered where `SpeechRecognition`/`webkitSpeechRecognition` exists
  (Chrome/Edge/Android); on unsupported browsers (Firefox, some iOS) the button
  is simply absent and typing is unaffected. The mic shows a recording state
  (accent fill + pulse) and is disabled alongside the rest of the composer while
  streaming/rate-limited. Audio is processed by the browser's own speech service
  — **no audio reaches our backend**. Mic-permission denial surfaces an inline
  notice.
- **Generating indicator** (supersedes the three-dot bounce): while a
  message is submitted but no assistant content is visible yet, the
  assistant-slot **avatar itself animates** — the brand orb's waves run at a
  calm pace with a gentle breathing (scale/opacity) pulse, tying the loading
  state to the brand. The first streamed tokens replace it in place with the
  regular static-avatar message row, so the animation transitions smoothly
  into the text. Under `prefers-reduced-motion: reduce` it freezes to the
  static orb.

### 4.3 Desktop vs mobile (see §7).

### 4.4 Desktop layout modes (feature 6, reworked)

> Supersedes the earlier enlarge/expand spec (410px × `66dvh` default,
> 560px enlarged, `ms-chat-expanded` key). The desktop panel now has two
> **layout modes** instead of two sizes.

- **MODE 1 — COMPACT = docked sidebar** (the default for new users): the
  panel docks to the **right edge**, **full viewport height**, compact
  width (410px). **No backdrop, no blur** — the storefront stays visible
  and interactive. The **page makes room**: while the sidebar is open the
  JS puts `ms-chat-page-shift` on `<html>` (`margin-right: 410px` +
  `overflow-x: hidden`), so the storefront reflows next to the chat with a
  smooth margin transition (an `ms-chat-page-anim` class is present only
  around the change, so a closed chat leaves `<html>` untouched). Sticky
  elements (the theme's desktop header is `position: sticky`) reflow with
  the layout; in the 641–749px band, where the theme switches its header
  to `position: fixed`, a companion rule pins the header's right edge to
  the sidebar so it shifts too. *(Fallback: if page reflow ever causes
  unresolvable layout breakage on the live theme, drop the page-shift
  rules and let the sidebar float over the right edge as an overlay.)*
- **MODE 2 — FULL = centered modal**: centered, near-fullscreen with a
  generous margin (`min(900px, 100vw - 128px)` × `calc(100dvh - 112px)`)
  so the **blurred + dimmed backdrop** (§4.5) shows at the edges and is
  **click-to-close**. The site is not interactive behind it.
- The header **mode toggle** switches sidebar ⇄ modal; its icon shows the
  *target* layout (a centered-window glyph in sidebar mode, a docked-panel
  glyph in modal mode), so it reads as a mode switch, not a zoom.
- The chosen mode is **persisted** (`localStorage` key
  `ms-chat-view-mode`, values `sidebar` | `modal`; a legacy
  `ms-chat-expanded=1` migrates to `modal`) and the launcher reopens the
  chat in the last-used mode. Toggling mid-conversation preserves the
  message-list scroll position (distance from the bottom is kept across
  the relayout).
- In both modes the message area scrolls inside the panel and the input
  row stays pinned. **No effect on mobile** (mode classes are scoped to a
  ≥641px media query and the toggle button is hidden on mobile).

### 4.5 Backdrop (feature 8, reworked)

- The backdrop (`rgba(0,0,0,0.4)` + `backdrop-filter: blur(6px)` as a
  progressive enhancement, degrading to just-dim) now appears **only
  behind the desktop centered modal** (§4.4 MODE 2). Clicking it closes
  the panel.
- The **sidebar mode renders no backdrop** — the storefront must stay
  interactive next to the docked panel.
- **Mobile renders no backdrop** — the fullscreen panel (§7) covers the
  site completely, so dim/blur would be invisible work and tap-outside
  cannot exist (close = the header X).
- **z-index ordering** unchanged: storefront < backdrop < panel; the
  launcher is hidden while open.

---

## 5. Chat flow (SSE consumption of `/api/chat`)

For each user send:

1. Append the user message to local state and render it.
2. POST to `${apiBase}/api/chat` with:
   - headers: `Content-Type: application/json`, `x-ms-chat-key: <chatKey>`,
     `x-ms-session: <sid>`.
   - body: `{ messages: UIMessage[] }` — the **entire** conversation so
     far (the backend reconstructs the customer profile from full history
     each turn; see `API_CONTRACT.md` §2). Each message is
     `{ id, role, parts: [{ type: "text", text }] }`.
3. Read the response as a **stream** and parse the AI SDK UI-message
   stream (SSE). Use `fetch` + `response.body.getReader()` +
   `TextDecoder`, buffering by lines. Each `data:` line carries a JSON
   **chunk** — the wire protocol streams chunks, NOT assembled message
   parts (see `API_CONTRACT.md` §2) — and the stream ends with the
   literal `data: [DONE]`. (Do **not** use `EventSource` — it can't send
   custom headers or a POST body.)
4. Maintain a "current assistant message" and dispatch on each chunk's
   `type`:
   - `text-start` / `text-delta` / `text-end` — one text run per visible
     bubble: `text-start` opens a fresh bubble, each `text-delta` appends
     its `delta` (re-rendering the markdown subset, `BEHAVIOR_REFERENCE`
     §3), `text-end` closes the run.
   - `tool-input-start` — record `toolCallId → toolName`;
     `tool-input-delta` (partial args) can be ignored.
   - `tool-input-available` — the tool call's full `input`: render the
     tool card per `BEHAVIOR_REFERENCE` §2, keyed by `toolCallId`
     (duplicate chunks update in place; the two silent tools are skipped).
   - `tool-output-available` — the tool's `output`. Consumed without
     rendering (the `offer_email_summary` result seeds the consent-copy
     cache, §6a) and persisted onto the accumulated history part
     (`state: "output-available"`, `input`, `output`).
   - `error` — show the friendly retry message. If partial content was
     already rendered, the notice is appended **after** it; the partial
     answer is kept, never discarded.
   - `finish` (and the `[DONE]` terminator / socket close) — finalize the
     assistant message, idempotently. `start` / `start-step` /
     `finish-step` and unknown chunk types are ignored defensively.
5. On stream end, finalize the assistant message, persist the updated
   history to `localStorage` (§3), and re-enable input.

Treat malformed/partial JSON lines defensively (buffer until a full line
arrives; ignore keep-alive/empty lines).

---

## 6. Product hydration & tool cards

Tool cards reference products by id only; the widget hydrates them from
`GET ${apiBase}/api/products` (`API_CONTRACT.md` §3):

- `show_product`, `add_to_cart` → `?id=<id>` (single).
- `compare_products`, `suggest_showroom`, `show_contact_form` (when
  `productIds` present) → `?ids=a,b,c`.
- Cap **10 ids/request**; unknown ids come back as `null` at their index
  — render partial results, never abort.
- Response is cacheable (60s); a small in-memory cache keyed by id avoids
  refetching the same product within a session.
- **Stock status:** when a product comes back with `inStock: false`, the
  product card shows a subtle **"Ausverkauft"** badge on the image, and
  quick-checkout rows mark the item ("Ausverkauft — nicht im Warenkorb")
  because the server-built `cartUrl` excludes sold-out products
  (`API_CONTRACT.md` §3) — the listed rows must match what the checkout
  click actually contains.
- Render each card exactly per `BEHAVIOR_REFERENCE` §2, including the
  "render nothing" guards (missing product → no card; compare needs ≥2;
  showroom needs ≥1). Remember the comparison table **omits**
  dimensions/weight/target-group rows (not in the public response).
- **Card styling.** All five tool cards (product, compare, quick-checkout/
  add-to-cart, showroom, contact/email-capture) are **monochrome**,
  matching the borderless document style of §4.2 (supersedes the earlier
  light-blue accent background): a clean **white surface with a hairline
  neutral border**, black text, neutral grey accents (table header row,
  image-area separator), and the **dark accent pill** as the single strong
  element per card. The hairline border is what separates a card from the
  plain-text flow around it — calm, never a colored panel. Card body text
  uses the **same font size as the chat messages** (the reduced chat body
  size); the secondary button stays a distinct bordered control.

Cart action: the `add_to_cart` card's checkout button is a **link to the
TOP-LEVEL `cartUrl`** of its `/api/products` response — one combined
multi-product cart permalink covering every resolved in-stock product in
the call (never stitched client-side) — opening in a new tab; it does
not call any API. When `cartUrl` is `null` the card **degrades** to
per-product `shopifyUrl` links instead of a broken checkout link.
Product/showroom links go to `shopifyUrl` /
`https://motionsports.de/pages/showroom-munchen-grobenzell`, new tab,
`rel="noopener noreferrer"`.

**Prominent in-chat CTAs (feature 2 / KPI driver).** The primary action
in each tool card is a clearly styled **primary button** (theme pill,
brand color, prominent/full-width), not a subtle text link — these are the
highest-value clicks and must look tappable. Labels: `"Zum Produkt"`
(product card + each comparison column), `"In den Warenkorb"` — or
`"Alle in den Warenkorb"` when the card covers several products —
(add-to-cart, links to the top-level `cartUrl`), `"Showroom ansehen"`
(showroom).
The render-nothing guards and link targets from `BEHAVIOR_REFERENCE` are
unchanged — only the visual prominence.

---

## 6a. Email-summary capture form (GDPR double opt-in)

The widget can email the shopper a summary of the conversation plus a
prefilled cart, gated behind a GDPR-compliant consent flow. The wire
protocol is `API_CONTRACT.md` §7 (`POST /api/capture-email` +
`GET /api/confirm-marketing`). All UI lives in
`assets/ms-chat-widget.{js,css}` (every selector prefixed `.ms-chat*`).

### Two entry points, one form

The **same** capture card is rendered from two places:

1. **Assistant offer** — when the chat stream contains the
   `offer_email_summary` tool part (`API_CONTRACT.md` §2), the widget renders
   the card inline in the assistant message, using the tool's `message` as the
   intro and its advisory `productIds` as a cart preview. It is added to
   `VISIBLE_TOOLS` and keyed by `toolCallId` like the other tool cards.
2. **"Per E-Mail teilen" header button** — the text button in the panel
   header (`§4.2`; visible once the first user message is sent) calls
   `openCaptureForm()`, which opens the panel and drops the same card into the
   message area with a default intro, so the user can request the summary at
   any time. A not-yet-submitted card already on screen is reused rather than
   stacked. Also exposed as `window.MS_CHAT.openEmailSummary()`.

### Card contents

- An **email** input (real `<label for>` + `<input type="email">`),
  client-side validated with `^[^@\s]+@[^@\s]+\.[^@\s]+$` before sending.
- A **transactional** consent checkbox — *required* to submit; you can't email
  a summary without consent to email it. The user can submit with **only** this
  box ticked (get the summary without opting into marketing). It renders
  **PRE-CHECKED by default** — permitted (`API_CONTRACT.md` §2,
  `CONSENT_FLOW.md`): it is the requested service itself (Art. 6(1)(b), not
  marketing); submitting the form is the affirmative request.
- A **separate marketing** consent checkbox — **UNCHECKED by default**, never
  pre-ticked, never bundled into the transactional control. It is rendered
  **prominently** (own highlighted block: surface tint, accent left edge,
  bolder label — `.ms-chat-consent--marketing`) with the **marketing benefit
  hint** as a small supporting line directly beneath the label
  (`.ms-chat-consent-hint`), part of the same consent block. Never pre-checking
  it is a **deliberate, documented legal decision** (GDPR clear affirmative
  act, CJEU C-673/17 *Planet49*; German UWG Abmahnung risk) — the opt-in is
  won through placement and copy, never a pre-tick.
- A submit button, an inline error line, and a privacy caption.
- **Imprint + Privacy links** (`Impressum` / `Datenschutz`,
  `.ms-chat-legal-links`) next to the form, targeting the backend-served
  `imprintUrl` / `privacyUrl` (`target="_blank" rel="noopener noreferrer"`).

**Legal copy comes from the backend — never hard-coded.** The widget's
`CONSENT_COPY` object holds UI chrome only (title, intro, button labels,
error strings). The canonical consent strings (`transactionalLabel`,
`marketingLabel`, `marketingBenefitHint`, `imprintUrl`/`privacyUrl`, and the
pre-composed `consentTextShown` audit string) are served by the backend:
attached to every `offer_email_summary` tool **result** (which seeds an
in-memory cache when it streams in) and fetched fresh via
`GET /api/consent-copy` (`API_CONTRACT.md` §7.4; in-memory cache TTL 60s,
matching the endpoint's `Cache-Control`; never persisted). While the copy
loads, the card shows a placeholder and the **submit button stays disabled**;
a load failure shows an inline error with a retry button — the form can never
be submitted with fallback or stale-snapshot consent text. This keeps the
stored Art. 7 audit record byte-identical to what the user saw, and lets a
lawyer copy change ship as a backend deploy with no widget release.

### Accessibility

- Each checkbox is a real `<label>` wrapping a real `<input type="checkbox">`
  (clicking the text toggles it), keyboard-operable with a visible focus ring.
- The marketing consent text wraps freely and is **never truncated**
  (`overflow-wrap: anywhere`), so the full legal text is always readable.
- Tap targets and inputs are sized for mobile; the card flows within the panel.

### Submit behaviour

On submit the widget POSTs to `${apiBase}/api/capture-email` with headers
`Content-Type`, `x-ms-chat-key`, `x-ms-session`, and body:

```jsonc
{ "sessionId", "email", "transactionalConsent": true, "marketingConsent", "consentTextShown", "trigger"? }
```

- `consentTextShown` is the **backend-provided** pre-composed audit string,
  echoed back **verbatim** (never recomposed client-side) — it equals exactly
  the labels + benefit hint the form rendered.
- `trigger` is included when the form came from an `offer_email_summary` tool
  call (echo of the offer's value moment; telemetry only).

- On **success** (`200`): replace the form with a success state — *"Wir
  haben dir die Zusammenfassung geschickt."*, appending *"Bitte bestätige
  noch die Anmeldung über den Link in der E-Mail."* **only** when the
  response's `marketing.status === "pending"` (`API_CONTRACT.md` §7.1).
  Success also unlocks **returning-customer memory** for the rest of this
  page's session: the widget attaches `customer: { email }` to subsequent
  `/api/chat` requests — held **in memory only**, never persisted, never
  auto-attached on a fresh open (the §2 privacy gate; the backend verifies
  the capture came from the same `x-ms-session` anyway).
- A quiet **decline link** (*"Nein danke, vielleicht später"*) sits under
  the form: clicking it collapses the card to a short note, fires ONE
  `email_capture_declined` KPI event (`trigger` only — the backend cannot
  observe a dismissal), and releases the header entry point so a new form
  can be opened later.
- On **error**: show an inline message and **keep the form populated for
  retry** (re-enable the submit button). `429 rate_limited` →
  *"Zu viele Anfragen — bitte kurz warten."*; `502/503 upstream_unavailable`
  and network failures → *"Senden gerade nicht möglich — bitte später erneut
  versuchen."*; otherwise the backend's user-safe message or a generic fallback.
- The widget emits **no** "submitted" KPI event — `email_capture_submitted`
  is recorded server-side by `/api/capture-email` (`API_CONTRACT.md` §5).

---

## 7. Mobile responsiveness

> Supersedes the earlier "near-full-screen with a small inset" spec: on
> mobile the panel is now **true fullscreen** with visual-viewport
> keyboard handling.

- On narrow viewports (≤ 640px) the panel is **TRUE fullscreen**: edge to
  edge, **no margin, no rounded corner, no visible storefront behind, no
  backdrop/blur** (§4.5). Close only via the header **X**. While open,
  `ms-chat-mobile-open` on `<html>` freezes page scrolling behind the
  chat (scoped to the mobile media query).
- **Keyboard handling (visual viewport):** the panel's height tracks the
  **visual viewport** — `100vh` → `100dvh` as CSS fallbacks, and while
  open the JS pins an inline px height from the `visualViewport` API
  (listening to its `resize`/`scroll` events) plus a
  `translateY(visualViewport.offsetTop)` re-pin for iOS's
  focus-auto-scroll. When the on-screen keyboard opens, the **input row
  stays just above the keyboard and the message list shrinks** and
  remains scrollable — the panel is never pushed up with the site showing
  through. If the user was reading the bottom, the list re-pins so the
  latest message + input stay in view (sending keeps both visible).
- **Safe areas:** the header keeps its `env(safe-area-inset-top)` padding
  (notch), the input bar its `env(safe-area-inset-bottom)` padding (home
  bar), and the fullscreen panel pads `env(safe-area-inset-left/right)`
  for landscape notches — nothing is clipped or hidden.
- **UX tuning:** tap targets ≥ 44px (header icon buttons are enlarged to
  44px on mobile), momentum scrolling in the message list
  (`-webkit-overflow-scrolling: touch`) with `overscroll-behavior:
  contain` so scrolling never chains to the page.
- The launcher stays out of the way of Shopify's own sticky elements
  (cart drawer, mobile nav). Respect safe-area insets
  (`env(safe-area-inset-*)`) so it isn't hidden behind the iOS home bar.
- The comparison table scrolls horizontally inside the panel rather than
  overflowing it; all tool cards, the capture form and the share button
  work unchanged in fullscreen.

---

## 8. Error & edge-case handling

The backend uses a stable error envelope
(`{ "error": { "code, message } }`); handle these gracefully:

- **429 `rate_limited`** (chat bucket 20/60s, products 60/60s). Read the
  `Retry-After` header (seconds), **disable the input** for that long,
  and show the hint *"Zu viele Anfragen — bitte kurz warten."* Re-enable
  when the window passes.
- **401 `unauthorized`** — wrong/missing `x-ms-chat-key`. This is a
  **misconfiguration** (the theme setting is wrong), not a user error.
  Show a generic *"Chat ist gerade nicht verfügbar."* to the shopper and
  `console.error` the real cause for the operator. Don't retry in a loop.
- **403 `forbidden`** — origin not allowlisted. Same treatment as 401
  (config/deploy issue): generic unavailable message + console error.
- **400 `payload_too_large`** on `/api/chat` — the 40-message cap was
  hit. Surface a **"start a new chat"** affordance: a message explaining
  the chat got long, and a button that clears the local conversation
  (clearing the persisted history per §3 and rotating the session id) so
  the user can continue fresh.
- **400 `bad_request`** — shouldn't happen with correct payloads; show
  the generic unavailable message and log.
- **5xx / `upstream_unavailable` / `internal_error`** and **network
  errors / fetch rejection / aborted stream** — show a friendly
  *"Es gab ein Problem. Bitte versuch es gleich nochmal."* in the message
  area, re-enable input so the user can retry. Don't lose what the user
  typed.
- **Contact form** errors (`/api/contact`, `API_CONTRACT.md` §4): show
  the inline error, keep the form populated for retry; on `502
  upstream_unavailable` use *"Senden gerade nicht möglich — bitte später
  erneut versuchen."*

For non-streaming responses, detect errors by `!response.ok` and parse
the JSON envelope to branch on `error.code`. For the chat stream, a
non-200 status returns the JSON envelope (not a stream) — check status
before starting to read the body as a stream.

---

## 9. Security note (must be honored)

The `x-ms-chat-key` shared secret is injected into the storefront via
Liquid and is therefore **visible to anyone who views the page source or
network traffic**. This is **expected and acceptable** for a public
storefront widget — but only because the backend pairs the secret with
two other controls that are already implemented server-side
(`API_CONTRACT.md` §1):

- an **origin allowlist** (requests are only honored from
  `https://www.motionsports.de` / `https://motionsports.de`), and
- **rate limiting** (sliding window keyed by `x-ms-session`/IP), plus
  hard spend caps.

So the secret is **not** an authentication boundary; it's one factor that
— combined with the origin check and rate limit — forces an abuser to
forge the Origin **and** know the key **and** distribute across IPs.
**The widget MUST therefore be deployed only on the allowlisted
storefront origin, and the shared secret MUST never be presented as
real auth.** Do not add client-side "hiding" of the key (obfuscation
gives false assurance); rely on the documented server-side controls. If
the storefront origin ever changes, the backend's `ALLOWED_ORIGINS` must
be updated in lockstep or the widget will get `403 forbidden`.

`GET /api/products` deliberately does **not** require the secret (it
exposes only storefront-visible fields), so product hydration works even
where the key isn't sent.

---

## 9a. Product-page CTA & public API (feature 2)

The widget exposes a global so a storefront template can open the chat
primed about a specific product:

```js
window.MS_CHAT.openWithProduct(productId, productTitle)
```

- It **opens the panel** and sends a short **product-primed user message**
  (e.g. *"Ich interessiere mich für „<Titel>". Kannst du mich zu diesem
  Produkt beraten?"*) so the assistant advises about that product. This is
  a normal chat turn, so it works whether the conversation is **fresh or
  already going** and **never wipes existing history**. The request also
  carries a `context: { type: "product", productId, productTitle,
  recentlyViewed? }` field (`API_CONTRACT.md` §2; invalid parts are
  dropped gracefully server-side). *(Deliberately a primer, NOT the
  contract's `messages: []` fresh-open greeting: the theme CTA passes the
  NUMERIC Shopify `product.id`, whose validity against the catalog's
  slug-shaped ids is unconfirmed — the primer carries the title in text,
  so the consultation works even if the context id is dropped. The nudge
  (§9c), which has the product handle, does use the greeting flow.)*
- It fires `track('product_cta_opened', { productId })` (see §9b).
- The product detail template (`templates/product.json`, the "USPs" /
  Kurzinfo block) renders an **outlined/bordered** button immediately
  **below the product bullet points**: the animated brand mark (the
  slow ~22s orb variant, §4.1a — gently alive, never noisy) + the
  text *"Detaillierte Beratung zu diesem Produkt"*, calling
  `openWithProduct(product.id, product.title)`. It is gated by
  `settings.ai_advisor_enabled` and styled distinct from (secondary to)
  the black Add-to-cart button above it.

## 9b. Telemetry (Phase 3 prep)

A tiny **fail-silent** helper `track(event, data)` sends a fire-and-forget
POST of `{ event, sessionId, timestamp, data }` to `${apiBase}/api/kpi`,
**contract-exact** per `API_CONTRACT.md` §5: `Content-Type:
application/json` + the `x-ms-session` header, via `fetch` with
`keepalive: true` so events survive page unloads (exit-intent, outbound CTA
clicks); errors are swallowed and the response is never read
(`navigator.sendBeacon` remains only as a last-resort fallback — it can set
neither the content type nor the session header). It sends
**event names + ids only — never message text**. Events: `chat_opened`,
`chat_closed`, `message_sent`, `product_cta_clicked` (`productId`),
`add_to_cart_clicked` (`productId`), `showroom_clicked` (`productIds`),
`product_cta_opened` (`productId`). The engagement layer (§9c) adds:
`nudge_shown` (`pageType`, `contextual` true/false, `trigger`
dwell/scroll/exit), `nudge_dismissed` (`pageType`, `contextual`),
`nudge_clicked` (`pageType`, `contextual`), `starter_shown` (`variant`
product/category/generic + `count`), `starter_clicked` (`variant` +
`index` — which starter), `launcher_attention_played`. The capture form
additionally emits `email_capture_declined` (`trigger` only) when its
decline link is clicked — the one funnel event the contract assigns to
the widget (`API_CONTRACT.md` §5; shown/submitted/opted-in/confirmed are
all recorded server-side and MUST NOT be duplicated). All are
session-keyed and carry **no personal data and no browsed product names**
(page type + variant flags only). This is pseudonymous analytics keyed
by the random session id.

## 9c. Context-aware engagement layer (BE-NUDGE client side)

A set of ambient, client-side features that make opening Mo more likely —
**without a classic interrupting popup**. Implemented entirely in
`assets/ms-chat-widget.{js,css}` plus a `pageContext` object the snippet
injects into `window.MS_CHAT_CONFIG`.

**Privacy posture (load-bearing):** everything is gathered client-side and
used only in-session. The browsing trail lives **only** in the user's
`localStorage`, is capped and pruned, and is **never transmitted in the
background** — KPI events carry page type + variant flags only, never
browsed product names, never message text. Context (product and/or the
trail as `context.recentlyViewed`, `API_CONTRACT.md` §2) leaves the
browser **only inside a chat request the user initiates** — opening the
chat via the nudge, tapping a starter, or the product CTA — as
conversation input, never as a per-turn heartbeat. The wire shape is the
contract's: `{ type: "product" | "browsing", productId?, productTitle?,
recentlyViewed?: [{ type: "product", id, name } | { type: "category",
id?, name }] }`, pre-capped client-side to the server's own cap
(3 products + 2 categories); the backend validates everything against the
catalog and drops mismatches gracefully.

**Tone rule:** copy references the **page/category** ("Fragen zum Produkt
…?"), never the user's behavior ("ich habe gesehen, dass du …"). Helpful
salesperson, not creepy watcher. The nudge and the starters **never ask
for an email or push marketing** — their only job is to start the
conversation; the email ask stays where it is (§6a, after value).

### Page context + browsing trail

- The snippet injects `pageContext` (server-rendered page facts only):
  `pageType` (`request.page_type`), plus `productId`/`productTitle`/
  `productType` on product pages and `collectionTitle`/`collectionHandle`
  on collection pages. The JS normalizes this to
  product / collection / cart / home / other, with `category` = the
  product's type or the collection's title.
- A lightweight **browsing trail** in `localStorage` (`ms-chat-trail`):
  the last **5** products/collections viewed as
  `{ id, name, type, category, ts }`, deduped per page, entries pruned
  after ~3 days. Recorded on init of product/collection pages.

### Contextual proactive nudge

- A small **dismissible speech bubble** (`.ms-chat-nudge`) anchored above
  the launcher — never a blocking overlay, no backdrop. The message body
  is one tappable button that **opens the chat**; a small **x** dismisses.
- **Copy priority** (grammar-safe — names are quoted, no gender/number
  agreement): product page → *"Fragen zum Produkt „X“? Ich helf dir gern
  weiter."*; collection page → *"Unsicher, was aus „X“ zu dir passt? Lass
  es uns klären."*; ≥2 trail products in one category → *"Du schaust dir
  ein paar Produkte aus „X“ an — soll ich beim Vergleich helfen?"*;
  otherwise the friendly generic *"Hi, ich bin Mo! Wenn du Fragen hast,
  helfe ich dir gern bei der Auswahl."*
- **Triggers** (first applicable fires, then all tear down): **dwell**
  ~24s on a product/collection page, OR **scroll** past ~85% of a product
  page, OR **exit intent** on desktop only (pointer leaving toward the
  top/URL bar). Mobile degrades to dwell/scroll only.
- **Frequency:** at most **once per session** (`sessionStorage`); once
  dismissed, a `localStorage` flag (`ms-chat-nudge-dismissed`) suppresses
  it **forever**; never shown if the chat was already opened this session;
  removed the moment the panel opens.
- **Click → contextual greeting:** clicking the bubble opens the chat;
  with a **fresh** conversation and usable context it POSTs
  `messages: []` + `context` (product on product pages, else
  `type: "browsing"` with the trail) and renders the backend's streamed
  greeting (`API_CONTRACT.md` §2 fresh-open) — no fake user primer enters
  the history. With existing history (or no context) it just opens.

### Context-seeded starter prompts (welcome state)

- The welcome state shows **3 tappable starters** (`.ms-chat-starter`)
  beneath the orb, seeded in priority order: **current/last product**
  (e.g. *"Ist „X“ gut für Zuhause geeignet?"*, *"Gibt es eine günstigere
  Alternative zu „X“?"*, *"Wie groß und wie laut ist „X“?"*) → **current
  collection or a trail category streak** (e.g. *"Worauf sollte ich bei
  „X“ achten?"*) → **strong general starters** (*"Hilf mir, das richtige
  Trainingsgerät zu finden."* …).
- Tapping one **sends it as the first user message**, carrying a
  contract-valid `context` (`API_CONTRACT.md` §2): product starters send
  `{ type: "product", productId, productTitle, recentlyViewed? }` (the id
  is the **product handle** — the slug-shaped form matching the catalog's
  ids); category starters send `{ type: "browsing", recentlyViewed }` with
  the seeding category leading the list (a bare `type: "category"` does
  not exist in the contract and would be ignored whole); generic starters
  send none. Disabled while streaming/rate-locked, exactly like the
  composer.

### One-time launcher attention animation

- Shortly after load the launcher plays **one** gentle bounce
  (`.ms-chat-launcher--attn`, ~1.1s), then rests. Played at most **once
  per session** (`sessionStorage`), so in-session navigation never
  replays it. Skipped entirely under `prefers-reduced-motion` (JS check
  + CSS freeze), and skipped while the panel is open.

## 10. Acceptance checklist

- [ ] Drops into a Shopify theme as a snippet; no build step; works with
      JS-only + CSS-only assets.
- [ ] Snippet is gated by an `ai_advisor_enabled` theme setting and is
      not rendered on `/cart` or `/checkout`; an excluded-templates
      theme setting lets the operator hide it on further templates.
- [ ] Brand colors come from theme tokens, not hardcoded hexes.
- [ ] Launcher + expandable panel; welcome state on first open with no
      persisted history.
- [ ] Animated CSS logo orb (§4.1a): full motion + halo on the launcher,
      slow variant on the product CTA, static avatar in chat; all variants
      freeze under `prefers-reduced-motion: reduce`.
- [ ] Generates/persists `x-ms-session`; sends it + `x-ms-chat-key` on
      the right requests.
- [ ] Conversation history is persisted to `localStorage` and restored
      on init so the chat survives page navigation across the
      storefront; cleared on "start new chat" with a session-id
      rotation; falls back to in-memory if `localStorage` is unavailable.
- [ ] Streams `/api/chat` over SSE via fetch+reader (not `EventSource`);
      concatenates text, renders the markdown subset safely (no
      innerHTML on untrusted strings).
- [ ] Renders all five tool cards per `BEHAVIOR_REFERENCE`, keyed by
      `toolCallId`, with the render-nothing guards; silently consumes
      `search_products` + `update_customer_profile`.
- [ ] Hydrates products via `GET /api/products`; the add-to-cart checkout
      button links to the response's **top-level `cartUrl`** (the
      multi-product cart permalink), degrading to product-page links when
      `cartUrl` is `null`.
- [ ] Inline contact form posts to `/api/contact`; success + error +
      retry states.
- [ ] Email-summary capture form (§6a) renders from both the
      `offer_email_summary` tool part and the header "Per E-Mail teilen"
      button (hidden until the first user message); consent copy is the
      CANONICAL backend-served text (tool result / `GET /api/consent-copy`),
      never hard-coded, with submit disabled until it loads; two SEPARATE
      consents — transactional pre-checked, marketing prominent + benefit
      hint but UNCHECKED; imprint/privacy links shown; posts to
      `/api/capture-email` echoing the served `consentTextShown` verbatim
      (+ `trigger` when tool-initiated); success + error + retry states.
- [ ] Mobile full-screen behavior; safe-area aware; horizontal-scroll
      comparison table.
- [ ] Handles 429 (Retry-After), 401/403 (config), 400 payload_too_large
      (start-new-chat clears persisted history), 5xx + network errors —
      all without throwing.
- [ ] Secret only ever shipped to the allowlisted storefront origin;
      no false-auth claims; relies on backend origin allowlist + rate
      limit.
- [ ] Engagement layer (§9c): browsing trail stays in `localStorage`
      (capped 5, pruned, never transmitted); contextual nudge shows the
      right copy per page type, fires on dwell/scroll/exit-intent
      (desktop) with mobile degrading to dwell/scroll, at most once per
      session, never after dismiss or an opened chat; welcome state shows
      2-3 context-seeded tappable starters that send as the first user
      message with the existing context shape; launcher attention motion
      plays once per session and respects reduced motion; the new KPI
      events fire fail-silently; neither the nudge nor the starters ever
      ask for an email.