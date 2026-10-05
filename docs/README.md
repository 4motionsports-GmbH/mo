# docs — where everything is

All documentation of Mo lives in this folder. Each fact is written down **once**; other documents
link to it. Three places, nothing else:

| Place | What | Who reads it |
| --- | --- | --- |
| `docs/*.md` | The backend: how Mo works inside, how to operate it, what the lawyer reviews. | backend agents, the operator, the lawyer |
| [`docs/frontend/`](./frontend/README.md) | Everything about the Shopify theme and the chat widget: the **widget contract** (what the widget sends, receives and renders), the as-built description of the widget and theme (which build is live: `ROLLOUT_TODO.md`), and the current frontend tasks. | the frontend agent (contract + tasks), backend agents (all of it) |
| [`docs/archive/`](./archive/README.md) | Past states: finished plans and hand-offs, audits, spikes, change reports. Never the current state. | context only |

**Live status** — what is uploaded, migrated or switched on in production — is kept in one place
only: [`ROLLOUT_TODO.md`](./ROLLOUT_TODO.md). Every other document describes behaviour and code
defaults („default off in code“), never what is currently live. Screenshots referenced by these documents are in
`docs/screenshots/`.

## Backend (`docs/`)

| Document | What it covers |
| --- | --- |
| [`ROLLOUT_TODO.md`](./ROLLOUT_TODO.md) | The operator's open list (top box „Open for M“), step-by-step procedures, live status, Claude's open items. |
| [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) | The admin dashboard: screens, URL contract, KPI sections (§5), admin API routes (§11). |
| [`FEATURE_INVENTORY.md`](./FEATURE_INVENTORY.md) | Every capability with its id; nothing is removed without the maintainer's decision. |
| [`CUSTOMERS.md`](./CUSTOMERS.md) | The customer entity, Shopify mirror, order ledger, nightly facts, webhooks, erasure, and the design decisions of the customer platform. |
| [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) | The one marketing consent (shared with Shopify), double opt-in, suppression, audit trail, erasure — backend and legal mechanics. |
| [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) | Sign-in internals: Customer Account OAuth, App Proxy shop recognition, one-time link codes, tokens, merge rule, history storage. |
| [`CAMPAIGNS.md`](./CAMPAIGNS.md) | Campaigns, audiences, the review desk, sends, letters (Pingen), Einzelansprache, discount codes. |
| [`EMAIL_DESIGNS.md`](./EMAIL_DESIGNS.md) | E-mail designs and hero images. |
| [`ORDER_ATTRIBUTION.md`](./ORDER_ATTRIBUTION.md) | Which orders count as Mo's: tiers, window and session anchor, the `_mo` marker. |
| [`DATA_RETENTION.md`](./DATA_RETENTION.md) | Every retention window, its default and env var (0 disables). |
| [`DATABASE.md`](./DATABASE.md) | Migrations, schema notes, the local database, seed and reset scripts. |
| [`AI_MODELS.md`](./AI_MODELS.md) | Which model does what, voice (TTS), costs. |
| [`PROMPT_CACHING.md`](./PROMPT_CACHING.md) | Prompt caching of the chat. |
| [`CATALOG_SYNC.md`](./CATALOG_SYNC.md) | Product catalog sync, Shopify app access and webhook registration. |
| [`BUNDLES.md`](./BUNDLES.md), [`DISCOUNTS.md`](./DISCOUNTS.md) | Personalised bundle offers; discount codes and their expiry. |
| [`QA_KNOWLEDGE.md`](./QA_KNOWLEDGE.md), [`IMPROVEMENT_LOOP.md`](./IMPROVEMENT_LOOP.md) | „Wissen“ (Q&A from conversations); „Verbesserung“ (the improvement loop). |
| [`REPURCHASE_ANALYSIS.md`](./REPURCHASE_ANALYSIS.md) | The repurchase analysis behind the lifecycle segments. |
| [`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md) | The dossier for the lawyer (German): data flows, decisions, open questions F-xx. |

## Frontend (`docs/frontend/`)

| Document | What it covers |
| --- | --- |
| [`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md) | **The widget contract**: rules for every widget change (§0), every endpoint the widget calls, stream parts, KPI events (§5), consent endpoints (§7), locale (§12), changes since 2026-10-01. |
| [`frontend/ACCOUNT_CONTRACT.md`](./frontend/ACCOUNT_CONTRACT.md) | Sign-in, App Proxy recognition, `/api/auth/me`, logout, conversation history, export, erase, the post-sign-in opt-in (gating §6.1, request §6.2). |
| [`frontend/CONSENT_CONTRACT.md`](./frontend/CONSENT_CONTRACT.md) | How the widget shows and renders the consent surfaces. |
| [`frontend/README.md`](./frontend/README.md) + `01`–`07` | The as-built description of the theme and widget at the build named in `frontend/README.md` (written by the frontend agent, maintained here). |
| [`frontend/tasks/`](./frontend/tasks/README.md) | The current frontend prompt and its tasks, with the exact list of files to attach. |
