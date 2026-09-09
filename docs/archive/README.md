# docs/archive — historical documents

Everything in this folder describes a **past state** of the project: one-off
audits, feasibility spikes, change reports and hand-off notes. They are kept for
context (decisions, evidence, rollback maps) and are **not maintained**. Do not
treat anything here as the current behaviour — the living documentation is one
level up in [`docs/`](../) (start with [`ADMIN_DASHBOARD.md`](../ADMIN_DASHBOARD.md),
[`CAMPAIGNS.md`](../CAMPAIGNS.md), [`API_CONTRACT.md`](../API_CONTRACT.md),
[`DATABASE.md`](../DATABASE.md), [`DATA_RETENTION.md`](../DATA_RETENTION.md)) and
in the root [`CLAUDE.md`](../../CLAUDE.md).

| File | Date | What it was | Superseded by |
| --- | --- | --- | --- |
| [`REPO_AUDIT.md`](./REPO_AUDIT.md) | 2026 Q1 | Audit of the one-time conversion to a headless backend ("two endpoints"). | `API_CONTRACT.md`, `README.md` |
| [`AUDIT_BACKEND.md`](./AUDIT_BACKEND.md) | 2026-06-12 | Contract audit: every endpoint/tool/doc claim traced to code; SSE wire format verified. | `API_CONTRACT.md` |
| [`COMPLETENESS_AUDIT.md`](./COMPLETENESS_AUDIT.md) | 2026-06-16 | "Is every intended feature wired?" audit over seven capability clusters. | `FEATURE_INVENTORY.md` |
| [`BUNDLES_SPIKE.md`](./BUNDLES_SPIKE.md) | 2026-06-13 | Feasibility spike for personalised bundle offers (Shopify API research). | `BUNDLES.md` |
| [`CUSTOMER_ACCOUNT_SPIKE.md`](./CUSTOMER_ACCOUNT_SPIKE.md) | 2026-06-14 | Feasibility spike for Shopify Customer Account sign-in (tier 3). | `CUSTOMER_ACCOUNT.md` |
| [`EMAIL_SUBSYSTEM_SPIKE.md`](./EMAIL_SUBSYSTEM_SPIKE.md) | 2026-06-14 | Feasibility spike for inbound mail, the per-customer mail store and physical letters. Code comments still cite its §4/§5. | `CAMPAIGNS.md`, `EMAIL_DESIGNS.md`, `DATA_RETENTION.md` |
| [`CATALOG_SYNC_DIAGNOSIS.md`](./CATALOG_SYNC_DIAGNOSIS.md) | 2026-06-18 | Incident diagnosis of the catalog-sync 503. | `CATALOG_SYNC.md` |
| [`CHANGE_REPORT_10E-1.md`](./CHANGE_REPORT_10E-1.md) | 2026-06 | Change report: sign-in detection, lost-conversation fix, history performance, PDF summary. | — |
| [`CHANGE_REPORT_I18N_EN.md`](./CHANGE_REPORT_I18N_EN.md) | 2026-06 | Change report: English language support. | `frontend-handoff/LOCALE.md` |
| [`CHANGE_REPORT_ROUND9.md`](./CHANGE_REPORT_ROUND9.md) | 2026-06 | Change report + rollback map of the pre-launch clean-up (welcome discount removed). | — |
| [`LEGAL_READINESS_REPORT.md`](./LEGAL_READINESS_REPORT.md) | 2026-06-16 | DSGVO/GDPR readiness report for counsel (OQ-xx references). | `ANWALTSDOSSIER.md` |
| [`GDPR_REMEDIATION_HANDOFF.md`](./GDPR_REMEDIATION_HANDOFF.md) | 2026-06 | Action items after the legal report. | `ANWALTSDOSSIER.md` |
| [`CUSTOMER_ACCOUNT_THEME_NOTES.md`](./CUSTOMER_ACCOUNT_THEME_NOTES.md) | 2026-06 | Notes from the Shopify theme side while wiring tier-3 sign-in. | `frontend-handoff/CUSTOMER_ACCOUNT.md` |
| [`PRODUCT_VARIANTS_PLAN.md`](./PRODUCT_VARIANTS_PLAN.md) | 2026-08 | Implementation plan for variant-granular selection (marked implemented). | `API_CONTRACT.md` |

Relative links inside these files were rewritten when they moved here, so
they still resolve; their *content* was left untouched.
