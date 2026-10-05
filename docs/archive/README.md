# docs/archive — historical documents

Everything in this folder describes a **past state** of the project: one-off
audits, feasibility spikes, change reports, finished plans and hand-off notes. They are kept for
context (decisions, evidence, rollback maps) and are **not maintained**. Do not
treat anything here as the current behaviour — the living documentation is listed in
[`docs/README.md`](../README.md) (backend docs in `docs/`, the widget contract and as-built chapters
in [`docs/frontend/`](../frontend/README.md)), and the conventions are in the root
[`CLAUDE.md`](../../CLAUDE.md).

## Audits, spikes, change reports

| File | Date | What it was | Superseded by |
| --- | --- | --- | --- |
| [`REPO_AUDIT.md`](./REPO_AUDIT.md) | 2026 Q1 | Audit of the one-time conversion to a headless backend ("two endpoints"). | `frontend/API_CONTRACT.md`, `README.md` |
| [`AUDIT_BACKEND.md`](./AUDIT_BACKEND.md) | 2026-06-12 | Contract audit: every endpoint/tool/doc claim traced to code; SSE wire format verified. | `frontend/API_CONTRACT.md` |
| [`COMPLETENESS_AUDIT.md`](./COMPLETENESS_AUDIT.md) | 2026-06-16 | "Is every intended feature wired?" audit over seven capability clusters. | `FEATURE_INVENTORY.md` |
| [`BUNDLES_SPIKE.md`](./BUNDLES_SPIKE.md) | 2026-06-13 | Feasibility spike for personalised bundle offers (Shopify API research). | `BUNDLES.md` |
| [`CUSTOMER_ACCOUNT_SPIKE.md`](./CUSTOMER_ACCOUNT_SPIKE.md) | 2026-06-14 | Feasibility spike for Shopify Customer Account sign-in (tier 3). | `CUSTOMER_ACCOUNT.md`, `frontend/ACCOUNT_CONTRACT.md` |
| [`EMAIL_SUBSYSTEM_SPIKE.md`](./EMAIL_SUBSYSTEM_SPIKE.md) | 2026-06-14 | Feasibility spike for inbound mail, the per-customer mail store and physical letters. Code comments still cite its §4/§5. | `CAMPAIGNS.md`, `EMAIL_DESIGNS.md`, `DATA_RETENTION.md` |
| [`CATALOG_SYNC_DIAGNOSIS.md`](./CATALOG_SYNC_DIAGNOSIS.md) | 2026-06-18 | Incident diagnosis of the catalog-sync 503. | `CATALOG_SYNC.md` |
| [`CHANGE_REPORT_10E-1.md`](./CHANGE_REPORT_10E-1.md) | 2026-06 | Change report: sign-in detection, lost-conversation fix, history performance, PDF summary. | — |
| [`CHANGE_REPORT_I18N_EN.md`](./CHANGE_REPORT_I18N_EN.md) | 2026-06 | Change report: English language support. | `frontend/API_CONTRACT.md` §12 |
| [`CHANGE_REPORT_ROUND9.md`](./CHANGE_REPORT_ROUND9.md) | 2026-06 | Change report + rollback map of the pre-launch clean-up (welcome discount removed). | — |
| [`LEGAL_READINESS_REPORT.md`](./LEGAL_READINESS_REPORT.md) | 2026-06-16 | DSGVO/GDPR readiness report for counsel (OQ-xx references; code comments cite them). | `ANWALTSDOSSIER.md` |
| [`GDPR_REMEDIATION_HANDOFF.md`](./GDPR_REMEDIATION_HANDOFF.md) | 2026-06 | Action items after the legal report. | `ANWALTSDOSSIER.md` |
| [`CUSTOMER_ACCOUNT_THEME_NOTES.md`](./CUSTOMER_ACCOUNT_THEME_NOTES.md) | 2026-06 | Notes from the Shopify theme side while wiring tier-3 sign-in. | `frontend/ACCOUNT_CONTRACT.md` |
| [`PRODUCT_VARIANTS_PLAN.md`](./PRODUCT_VARIANTS_PLAN.md) | 2026-08 | Implementation plan for variant-granular selection (marked implemented). | `frontend/API_CONTRACT.md` |
| [`CLEANUP_AUDIT.md`](./CLEANUP_AUDIT.md) | 2026-09 | Project clean-up audit (UX- / TECH- findings, decisions D-1…D-9 in Part 5), marked implemented. | `ADMIN_DASHBOARD.md` §2, `CLAUDE.md` |
| [`FEATURE_INVENTORY_STATUS.md`](./FEATURE_INVENTORY_STATUS.md) | 2026-09 … 10-03 | Phase-3 verification log of the capability inventory (stops at the letters addendum). | `FEATURE_INVENTORY.md` |
| [`FEATURE_INVENTORY_AUDIT_2026-09.md`](./FEATURE_INVENTORY_AUDIT_2026-09.md) | 2026-09 | The 2026-09 audit findings and baseline file:line columns taken out of the inventory. | `FEATURE_INVENTORY.md` |
| [`KAMPAGNE_REDESIGN.md`](./KAMPAGNE_REDESIGN.md) | 2026-09-13 | Proposal for the Kampagne review desk (implemented; `migrations/0072` cites its §9). | `CAMPAIGNS.md` §5, `ADMIN_DASHBOARD.md` §3.2 |
| [`CUSTOMER_PLATFORM_PLAN.md`](./CUSTOMER_PLATFORM_PLAN.md) | 2026-10-01 | The customer-platform plan (mirror, ledger, one consent, campaigns, erasure, Eingang), built 2026-10; many code comments cite its sections as design rationale. | `CUSTOMERS.md` (incl. „Design decisions“), `CONSENT_FLOW.md`, `CAMPAIGNS.md`, `ADMIN_DASHBOARD.md` |

## Passages taken out of living docs on 2026-10-05

| File | What it holds | Living doc |
| --- | --- | --- |
| [`ADMIN_DASHBOARD_HISTORY.md`](./ADMIN_DASHBOARD_HISTORY.md) | Retired admin paths, the early migration narrative, the old runbook, old token kinds. | `ADMIN_DASHBOARD.md` |
| [`BACKEND_REFERENCE_HISTORY_2026-10.md`](./BACKEND_REFERENCE_HISTORY_2026-10.md) | Retired notes from DATA_RETENTION, DISCOUNTS, BUNDLES, REPURCHASE_ANALYSIS and CUSTOMERS. | those docs |
| [`CAMPAIGNS_HISTORY_2026-10.md`](./CAMPAIGNS_HISTORY_2026-10.md) | Retired campaign paths (newsletter sync, the single-campaign era). | `CAMPAIGNS.md` |
| [`EMAIL_DESIGNS_HISTORY_2026-10.md`](./EMAIL_DESIGNS_HISTORY_2026-10.md) | Design history notes and the original default-hero prompt. | `EMAIL_DESIGNS.md` |
| [`CONSENT_SIGNOFF_HISTORY.md`](./CONSENT_SIGNOFF_HISTORY.md) | The finished lawyer sign-off checklists of the consent copy versions v2–v4, the §7(3) UWG removal, the welcome-discount note and the retired descriptions of the at-sign-in and chat-gate surfaces. | `CONSENT_FLOW.md`, `ANWALTSDOSSIER.md` |
| [`CUSTOMERS_HISTORY_2026-10.md`](./CUSTOMERS_HISTORY_2026-10.md) | Retired passages of the customer doc (old GDPR box, welcome discount, pre-platform notes). | `CUSTOMERS.md` |
| [`CUSTOMER_ACCOUNT_HISTORY_2026-10.md`](./CUSTOMER_ACCOUNT_HISTORY_2026-10.md) | Retired sign-in passages (old store-setup box, live-token-only rules, old endpoint tables). | `CUSTOMER_ACCOUNT.md`, `frontend/ACCOUNT_CONTRACT.md` |
| [`ORDER_ATTRIBUTION_HISTORY_2026-10.md`](./ORDER_ATTRIBUTION_HISTORY_2026-10.md) | Retired attribution passages (manual webhook setup, the old widget section). | `ORDER_ATTRIBUTION.md`, `frontend/API_CONTRACT.md` §10 |
| [`FRONTEND_STATUS_2026-10-04.md`](./FRONTEND_STATUS_2026-10-04.md) | The dated status notes of the as-built widget chapters (README, 01–07) as of 04./05.10. | `ROLLOUT_TODO.md`, `npm run verify:widget`, `frontend/01`–`07` |

## Finished frontend hand-offs — [`frontend-handoff/`](./frontend-handoff/)

The folder that held the widget contract copies until 2026-10-05. Its contract content now lives in
[`docs/frontend/`](../frontend/README.md) (`API_CONTRACT.md`, `ACCOUNT_CONTRACT.md`,
`CONSENT_CONTRACT.md`); what is left here is history.

| File | What it was | Superseded by |
| --- | --- | --- |
| [`WIDGET_SPEC.md`](./frontend-handoff/WIDGET_SPEC.md) | The original 2026-06 deliverable spec for building the widget. | `frontend/API_CONTRACT.md` §0 (rules) and the as-built chapters `frontend/01`–`07` |
| [`BEHAVIOR_REFERENCE.md`](./frontend-handoff/BEHAVIOR_REFERENCE.md) | How the old React chat UI rendered the stream. | `frontend/API_CONTRACT.md` §2, `frontend/03` |
| [`LOCALE.md`](./frontend-handoff/LOCALE.md) | The locale contract (synced copy). | `frontend/API_CONTRACT.md` §12 |
| [`FRONTEND_PROMPT_2026-10.md`](./frontend-handoff/FRONTEND_PROMPT_2026-10.md) | The frontend prompt of 2026-10-03 (implemented by the widget of 2026-10-04). | `frontend/tasks/` |
| [`CHAT_ORDER_STATUS.md`](./frontend-handoff/CHAT_ORDER_STATUS.md) | Hand-off for the silent `get_order_status` tool (shipped). | `frontend/API_CONTRACT.md` §2, `frontend/ACCOUNT_CONTRACT.md` §3a / §5.1 |
| [`CONTACT_FORM_ORDER_SUPPORT.md`](./frontend-handoff/CONTACT_FORM_ORDER_SUPPORT.md) | Hand-off for the `order_support` contact reason (shipped). | `frontend/API_CONTRACT.md` §2 / §4 |

## Finished plans of 2026-10-04 — [`plans-2026-10-04/`](./plans-2026-10-04/README.md)

The five plans behind the 2026-10-05 backend round, all built (code comments still use their ids as
labels): **P0.3** shop-login recognition via the App Proxy, **OI1** opt-in measurement and the
signed-in summary offer, **OI3** served consent benefits and sign-in variants, **A3** page context
on typed product-page messages, **ATTR-TOKEN-LIFETIME** the session-anchored attribution window.
Decisions D-AP1…D-AP4 and the lawyer questions F-36…F-38 are referenced there. Their open
follow-ups are tracked in [`docs/ROLLOUT_TODO.md`](../ROLLOUT_TODO.md) C.26; the as-built facts live
in `CUSTOMER_ACCOUNT.md` §2, `frontend/ACCOUNT_CONTRACT.md` §3a, `CONSENT_FLOW.md`,
`frontend/API_CONTRACT.md` §2 / §5 / §7.4 / §10, `ORDER_ATTRIBUTION.md` and `ADMIN_DASHBOARD.md` §5.

Relative links inside these files were rewritten when they moved here, so
they still resolve; their *content* was left untouched.
