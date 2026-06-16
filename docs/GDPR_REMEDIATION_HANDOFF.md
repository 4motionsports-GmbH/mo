# GDPR Remediation — Handoff & Action Items

**Companion to:** [`docs/LEGAL_READINESS_REPORT.md`](./LEGAL_READINESS_REPORT.md) (full findings) and PR #101 (the code changes — WS1 privacy/security + WS2 §7(3) build).
**Status:** all agreed code changes are merged into the PR and the build is green. **No feature flags were flipped.** This file lists everything that still needs a human/external action, and ends with a copy-paste prompt for the frontend (Shopify) Claude Code session.

---

## 1. Action items that need YOU (not code)

### A. Before production — contractual / configuration (P1)
- [ ] **Sign a DPA / AVV** with every processor: Anthropic, OpenAI, Resend, Shopify, Vercel, Neon, Upstash, Sentry, Pingen. *(None is evidenced in the repo.)*
- [ ] **Pin EU data residency** for: **Neon** (holds all PII), **Vercel**, **Upstash**, **Resend** (incl. **inbound** — flagged "legal-blocking"), and use an **EU Sentry DSN**. *(No region is configured in code — it's account/project setup.)*
- [ ] **Anthropic & OpenAI**: confirm **no-training + zero/short data-retention** terms, and that the US transfer is covered (**EU–US DPF** certification or **SCCs**).
- [ ] **DPIA**: produce/confirm a Data Protection Impact Assessment for the AI profiling.
- [ ] **Privacy policy text**: ensure it describes the AI profiling (from past chats + purchases), all processors, the third-country transfers, the retention windows, **and** the new §7(3) existing-customer (legitimate-interest) use + the Art. 21 objection right. Confirm `https://motionsports.de/policies/privacy-policy` resolves.

### B. §7(3) Bestandskunden — the one gate left before flipping it on
- [ ] **Add the §7(3) Nr. 4 "at the time the address is collected" objection notice** to the Shopify checkout / order-confirmation (store-side — see the frontend prompt in §3, Task 2).
- [ ] **Only then** set `BESTANDSKUNDE_SENDS_APPROVED=true`. *(The boundary + in-email copy are already built, enforced, and lawyer-approved; the at-collection notice is the missing limb.)*

### C. Deployment / ops
- [ ] **Run the new migration** `migrations/0028_admin_access_log.sql` (`npm run db:migrate`) before/at deploy — otherwise the admin-access audit writes silently no-op.
- [ ] Set the new env vars in the Vercel project (defaults shown in `.env.example`).

### D. Policy knobs I defaulted — confirm or tune (in env)
- [ ] `CUSTOMER_INACTIVITY_RETENTION_DAYS=1095` (3 y) — dormant **identified** customers are deleted after this (confirmed-consent customers always kept). **This deletes data** once 3-year-old inactive records exist. Confirm the window or set your own. `0` disables.
- [ ] `MARKETING_MIN_SEND_INTERVAL_DAYS=0` (off) — set e.g. `14` for a per-recipient send-frequency cap.
- [ ] `FEEDBACK_RETENTION_DAYS=365`, `ADMIN_ACCESS_LOG_RETENTION_DAYS=730` — confirm.
- [ ] `BESTANDSKUNDE_TEST_RECIPIENTS=` — set an internal allow-list before any §7(3) test send.

### E. Two design choices to sanity-check (already accepted, recorded for the file)
- [ ] **Single-chat delete leaves the derived AI profile** in place; only full "delete my account" clears it (Art. 17 partial-erasure model).
- [ ] **Inactivity deletion excludes `confirmed`/`pending` marketing consent** (a live basis to retain).

---

## 2. Remaining code work in THIS (backend) repo — optional / on request
- [ ] **Admin dashboard §7(3) "Senden" control** (`src/app/admin/*`) wired to `POST /api/admin/bestandskunden/send` (with an `includeChatbotIntro` toggle) on eligible existing customers. The backend route + test-send exist; there's no production-send button yet. Only needed once the flag is flipped.
- [ ] Ensure the admin marketing-send UI surfaces the new **`429 too_soon`** message (likely already handled by the generic error display).
- [ ] Add the two new endpoints to `docs/frontend-handoff/API_CONTRACT.md`.

*(Say the word and I'll do these.)*

---

## 3. Prompt for the frontend (Shopify) Claude Code session

> Paste everything in the box below into your frontend session (the one with the Shopify storefront/theme repo in context).

```text
You are working in the motion sports SHOPIFY STOREFRONT repo (the chat-widget theme
and any checkout/notification customizations). The BACKEND (a separate repo) just
shipped GDPR remediation; two storefront-side changes are needed to complete it.
Do NOT change backend code — only the storefront/theme/checkout here.

BACKGROUND — how the widget talks to the backend
- The chat widget calls the backend at the same origin it already uses for chat
  (e.g. https://chat.motionsports.de). Widget→backend requests are guarded by:
    * the Origin allowlist (automatic in the browser),
    * a shared-secret header  x-ms-chat-key: <CHAT_SHARED_SECRET>  (the widget
      already attaches this on every call), and
    * a session reference: header  x-ms-session: <sessionId>  OR query  ?session=<sessionId>.
- The signed-in (tier-3) account features already use this exact pattern. In
  particular there is an existing "Zusammenfassung herunterladen" (summary) download
  that fetches  GET /api/account/summary?conversationKey=...  with the guard headers
  and saves the returned bytes as a Blob. FIND that code first — both tasks below
  mirror its fetch + download + error-handling pattern.

TASK 1 — "Meine Daten herunterladen" (data export button) [GDPR Art. 15/20]
- New backend endpoint:  GET /api/account/export  (signed-in customers only).
- Send the SAME guard headers as the summary download (Origin auto, x-ms-chat-key,
  and the session via x-ms-session header or ?session=).
- Success: HTTP 200, Content-Type: application/json, Content-Disposition:
  attachment; filename="motionsports-meine-daten.json"  — the full JSON of all data
  the backend holds about the customer. Errors: 401 (not signed in), 503 (transient).
- UI: in the signed-in account/menu area (alongside the history list, the existing
  summary-download, and log-out), add a button "Meine Daten herunterladen". On click:
  XHR the endpoint with the guard headers, read the response as a Blob, and trigger a
  browser download (URL.createObjectURL → a temporary <a download="motionsports-meine-daten.json">
  click → URL.revokeObjectURL). Show a small loading state; on a non-200 show a
  friendly German error ("Download fehlgeschlagen — bitte später erneut versuchen.").
  Only render the button for a signed-in customer (same gate as the history drawer).
- Also make sure a "Meine Daten löschen" (delete-my-data) affordance exists for
  signed-in customers — it POSTs to  /api/account/erase  with the same guard headers,
  behind a confirm step. If it already exists, leave it; if not, add it next to the
  export button.

TASK 2 — §7(3) "at the time of collection" objection notice [§7 Abs. 3 Nr. 4 UWG]
- German law requires that, AT THE MOMENT the customer's email/postal address is
  collected in connection with a purchase, they are told — clearly and free of charge
  — that motion sports may later contact them about its OWN SIMILAR products, and that
  they may object at any time. (The notice inside each §7(3) email already exists on
  the backend; this is the mandatory SECOND limb, shown at collection.)
- Add this notice at the point of purchase. Identify the right Shopify surface in this
  repo: if you use Checkout Extensibility, a Checkout UI extension near the
  contact/email step is ideal; the order-confirmation notification template is the
  other required surface. If checkout is NOT customizable from this repo, say so
  explicitly and produce the copy + exact placement so the operator can add it via
  Shopify Admin → Settings → Notifications (order confirmation) and the checkout editor.
- Suggested German copy (⚠ the lawyer MUST confirm this exact wording before launch):
  "Wir verwenden deine E-Mail-Adresse ggf. auch, um dich über eigene, ähnliche Produkte
   von motion sports zu informieren (§ 7 Abs. 3 UWG). Du kannst dieser Nutzung jederzeit
   kostenlos widersprechen — eine formlose Nachricht an widerspruch@motionsports.de
   genügt."
  Place it visibly near the email field / order summary, not buried in a collapsed
  section or the general T&Cs.
- IMPORTANT: this notice is a launch gate — the backend keeps §7(3) sends DISABLED
  until it is live. Do not present existing-customer marketing as active.

OUT OF SCOPE here (handled in the backend repo): the export/erase endpoints
themselves, the admin dashboard, the §7(3) email content/sending, retention, Sentry.

WHEN DONE: summarize what you changed, name the file(s) and the surface where the
§7(3) notice lives, and call out anything that must be done via a Shopify Admin
setting rather than repo code.
```

---

*Generated alongside PR #101. Keep this file with the legal report; the lawyer can tick §1 item by item.*
