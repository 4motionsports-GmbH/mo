#!/usr/bin/env node
// Lightweight forward-only SQL migration runner.
//
// No ORM. Migrations are plain `.sql` files in ./migrations, applied in
// filename order. Applied migrations are recorded in a `_migrations` table so
// re-running is a no-op. Each file is run statement-by-statement over the Neon
// HTTP driver (which executes one statement per round-trip).
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/migrate.mjs
//   npm run db:migrate            (loads .env via --env-file)
//
// We connect via the *direct* (unpooled) connection string when available —
// DDL through the pooler can behave oddly — falling back to the pooled URL.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

function connectionString() {
  return (
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL
  );
}

// Split a SQL file into individual statements. Handles `--` line comments and
// ignores semicolons inside single/double-quoted strings. Our migrations are
// plain DDL (no dollar-quoted function bodies), which keeps this simple and
// reliable.
function splitStatements(sql) {
  const statements = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      else continue;
    }

    if (!inSingle && !inDouble && ch === "-" && next === "-") {
      inLineComment = true;
      i++;
      continue;
    }

    if (!inDouble && ch === "'" && !inLineComment) {
      // Handle escaped '' by toggling; a doubled quote nets to no change.
      inSingle = !inSingle;
    } else if (!inSingle && ch === '"' && !inLineComment) {
      inDouble = !inDouble;
    }

    if (ch === ";" && !inSingle && !inDouble) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

async function main() {
  const cs = connectionString();
  if (!cs) {
    console.error(
      "[migrate] No connection string set. Provide DATABASE_URL (or POSTGRES_URL / *_UNPOOLED)."
    );
    process.exit(1);
  }

  const sql = neon(cs);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const appliedRows = await sql.query("SELECT name FROM _migrations");
  const applied = new Set(appliedRows.map((r) => r.name));

  let files;
  try {
    files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    console.error(`[migrate] No migrations directory at ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    console.log(`[migrate] Up to date (${files.length} migration(s) applied).`);
    return;
  }

  for (const file of pending) {
    const fullPath = join(MIGRATIONS_DIR, file);
    const contents = readFileSync(fullPath, "utf8");
    const statements = splitStatements(contents);
    console.log(`[migrate] Applying ${file} (${statements.length} statement(s))…`);
    for (const stmt of statements) {
      await sql.query(stmt);
    }
    await sql.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    console.log(`[migrate] ✓ ${file}`);
  }

  console.log(`[migrate] Done. Applied ${pending.length} new migration(s).`);
}

main().catch((err) => {
  console.error("[migrate] Failed:", err);
  process.exit(1);
});
