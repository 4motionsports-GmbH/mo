# CLAUDE.md — conventions for working in this repository

Read this before changing anything. It is short on purpose; the living design docs are in `docs/`
(start with `docs/README`-level files: `ADMIN_DASHBOARD.md`, `CAMPAIGNS.md`, `API_CONTRACT.md`,
`DATABASE.md`, `DATA_RETENTION.md`, `EMAIL_DESIGNS.md`). `docs/FEATURE_INVENTORY.md` lists every
capability; do not remove one without an explicit decision by the maintainer.

## What this is
Next.js 16 App Router on Vercel (`fra1`), Neon Postgres, TypeScript + a set of pure `.mjs` cores.
Three products in one repo: the chat API for the external Shopify widget (`/api/chat` and friends),
the German admin dashboard (`/admin`), and the e-mail subsystem (marketing, campaign, transactional,
inbound, physical letters). The widget is **not** in this repo — keep `docs/API_CONTRACT.md` backward
compatible.

## Hard rules
- **Neon `sql` tagged templates are not composable.** Never nest a fragment inside another template or
  build SQL from strings. Spell queries out, even if that means repeating a WHERE clause.
- **`getSql()` may return `null`** (no database configured). Every store function takes
  `sql: Sql | null = getSql()` last, returns a null-safe fallback, wraps its work in `try/catch` and
  reports via `reportError(err, { route, phase })`. A database problem must never break a chat response
  or an e-mail send that already passed its gates.
- **Migrations are forward-only.** Never edit a file in `migrations/`; add `00NN_<name>.sql` with the
  next number. Migrations are run manually by the maintainer — say so in the PR when one is needed.
- **Pure logic lives in `.mjs` cores, I/O in TypeScript.** Unit tests are `*.test.mjs` next to the core
  and run with `node --test` (`npm test`). Tests cannot import TypeScript, so anything you want to test
  goes into a `.mjs` file. Add tests for logic you rewrite.
- **Every `/api/admin/*` handler calls `guardAdminPost(req)` or `guardAdminGet()`** in addition to the
  Edge proxy. Public widget routes use `guardRequest` (secret + origin) or `guardOriginOnly`; crons use
  `requireCronAuth`; webhooks verify the signature over the raw body before parsing.
- **Dates in the admin go through `src/lib/admin-datetime.mjs`** (`formatAdmin(value, ADMIN_*)`,
  Europe/Berlin). A bare `toLocale*String` on a `Date` in `src/app/admin` is a lint error (hydration).
- **Numbers in the admin go through `src/lib/admin-format.mjs`** (`num`, `eur`, `eurFromCents`, `pct`,
  `ratio`, `hours`, `plural`, `relativeTime`, `truncate`) — no per-file `toLocaleString` helpers.
- **Client calls to `/api/admin/*` go through `adminFetch()`** (`src/app/admin/lib/admin-fetch.ts`):
  JSON in/out, `AdminApiError` with status + code + German message, 401 → login and back. Button
  pending/error state comes from `useAsyncAction()` next to it; confirmations from `useConfirm()`.
- **Env vars are documented in `.env.example`** the moment code reads them, with default and purpose.
  Legal send gates default to `false` in code (`CAMPAIGN_SENDS_APPROVED`, `CAMPAIGN_ALLOW_SINGLE_OPT_IN`,
  `PHYSICAL_MAIL_SENDS_APPROVED`).
- **The admin UI is German.** Keep the existing terminology (Kunden, Kampagne, Gespräche, Wissen, …).
  Explanations belong behind `InfoTip`, not in helper paragraphs.
- **Admin styling uses the design tokens** in `src/app/admin/theme.css` and the primitives in
  `src/app/admin/ui`. No hard-coded colours, no ad-hoc pixel font sizes; everything must work in light
  and dark mode.
- **Fail-soft is the house style** for background and best-effort work (log + continue); the legal
  gates in the send paths fail **closed**.

## Before you push
`npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test` — all clean. UI changes: screenshots
of the affected screens in light and dark in the PR description. Commit in small, descriptive commits.

## Local development
`cp .env.example .env.local` and fill in the keys you need. Without `DATABASE_URL` the admin renders
empty states. For a local database see `docs/DATABASE.md` (local Postgres behind a Neon-protocol proxy
via `NEON_FETCH_ENDPOINT`, seed data with `scripts/seed-dev.mjs`).

## Where things are
- `src/app/api/**/route.ts` — HTTP routes (thin: validate → call a lib function → JSON envelope).
- `src/lib/*-store.ts` — database access per table group; `src/lib/*.mjs` — pure cores + tests.
- `src/lib/campaign-*.ts`, `marketing-*.ts`, `email-*.ts`, `email-designs/` — the e-mail subsystem;
  `approveAndSendCampaign` / `approveAndSend` are the only paths that deliver marketing mail.
- `src/app/admin/` — the dashboard: `page.tsx` (server data), `AdminShell.tsx` (navigation),
  one workspace per screen, `ui/` primitives.
- `scripts/` — operational scripts (see `package.json` for the npm aliases).
