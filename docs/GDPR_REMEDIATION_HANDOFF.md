# GDPR Remediation — Handoff & Action Items

**Companion to:** [`docs/LEGAL_READINESS_REPORT.md`](./LEGAL_READINESS_REPORT.md) (full findings).
**Status:** the privacy/security hardening (WS1) is merged and the build is green. **No feature flags were flipped.**

> **Note:** the §7(3) UWG "Bestandskunden" (existing-customer marketing) feature
> was **removed entirely** on 2026-06-16 per client decision — it is no longer in
> the codebase, so the §7(3) action items and the §7(3) frontend task from earlier
> drafts of this file are gone. The frontend is removing its §7(3) bits in parallel.

This file lists everything that still needs a human/external action, and ends with a copy-paste prompt for the frontend (Shopify) Claude Code session.

---

## 1. Action items that need YOU (not code)

### A. Before production — contractual / configuration (P1)
- [ ] **Sign a DPA / AVV** with every processor: Anthropic, OpenAI, Resend, Shopify, Vercel, Neon, Upstash, Sentry, Pingen. *(None is evidenced in the repo.)*
- [ ] **Pin EU data residency** for: **Neon** (holds all PII), **Vercel**, **Upstash**, **Resend** (incl. **inbound** — flagged "legal-blocking"), and use an **EU Sentry DSN**. *(No region is configured in code — it's account/project setup.)*
- [ ] **Anthropic & OpenAI**: confirm **no-training + zero/short data-retention** terms, and that the US transfer is covered (**EU–US DPF** certification or **SCCs**).
- [ ] **DPIA**: produce/confirm a Data Protection Impact Assessment for the AI profiling.
- [ ] **Privacy policy text**: ensure it describes the AI profiling (from past chats + purchases), all processors, the third-country transfers, and the retention windows. Confirm `https://motionsports.de/policies/privacy-policy` resolves.

### B. Deployment / ops
- [ ] **Run the new migrations** (`npm run db:migrate`) before/at deploy — `0028_admin_access_log.sql` (else the admin-access audit writes silently no-op) and `0029_drop_bestandskunden.sql` (drops the now-unused §7(3) schema).
- [ ] Set the new env vars in the Vercel project (defaults shown in `.env.example`).

### C. Policy knobs I defaulted — confirm or tune (in env)
- [ ] `CUSTOMER_INACTIVITY_RETENTION_DAYS=1095` (3 y) — dormant **identified** customers are deleted after this (confirmed-consent customers always kept). **This deletes data** once 3-year-old inactive records exist. Confirm the window or set your own. `0` disables.
- [ ] `MARKETING_MIN_SEND_INTERVAL_DAYS=0` (off) — set e.g. `14` for a per-recipient send-frequency cap.
- [ ] `FEEDBACK_RETENTION_DAYS=365`, `ADMIN_ACCESS_LOG_RETENTION_DAYS=730` — confirm.

### D. Two design choices to sanity-check (already accepted, recorded for the file)
- [ ] **Single-chat delete leaves the derived AI profile** in place; only full "delete my account" clears it (Art. 17 partial-erasure model).
- [ ] **Inactivity deletion excludes `confirmed`/`pending` marketing consent** (a live basis to retain).

---

## 2. Remaining code work in THIS (backend) repo — optional / on request
- [ ] Ensure the admin marketing-send UI surfaces the new **`429 too_soon`** message (likely already handled by the generic error display).
- [ ] Add the new `GET /api/account/export` endpoint to `docs/frontend-handoff/API_CONTRACT.md`.

*(Say the word and I'll do these.)*

---

## 3. Prompt for the frontend (Shopify) Claude Code session

> Paste everything in the box below into your frontend session (the one with the Shopify storefront/theme repo in context).

```text
You are working in the motion sports SHOPIFY STOREFRONT repo (the chat-widget theme).
The BACKEND (a separate repo) just shipped GDPR remediation; one storefront-side
change is needed to complete it. Do NOT change backend code — only the storefront here.

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
  and saves the returned bytes as a Blob. FIND that code first — the task below
  mirrors its fetch + download + error-handling pattern.

TASK — "Meine Daten herunterladen" (data export button) [GDPR Art. 15/20]
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

NOTE: the §7(3) "Bestandskunden" existing-customer marketing feature was removed
entirely from the backend (client decision) — if your storefront has any §7(3) /
"ähnliche Produkte" objection notice or related UI tied to that feature, remove it too.

OUT OF SCOPE here (handled in the backend repo): the export/erase endpoints
themselves, the admin dashboard, retention, Sentry.

WHEN DONE: summarize what you changed and name the file(s).
```

---

*Keep this file with the legal report; the lawyer can tick §1 item by item.*
