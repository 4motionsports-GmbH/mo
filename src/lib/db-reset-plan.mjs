// What `npm run db:reset` (scripts/reset-test-data.mjs) may wipe — the pure half.
//
// The reset used to carry a hand-maintained table list that stopped at
// migration 0031, so its completeness guard aborted on every newer database.
// Now the data tables are DERIVED from the repository's migrations/ folder
// (every table a migration creates and no later one drops or renames) and
// cross-checked against the live schema:
//
//   · a live table no migration creates (and not preserved) → ABORT — the
//     connection points at a foreign database, or someone created a table by
//     hand; the reset never wipes what it does not know.
//   · no `_migrations` table → ABORT — not a database migrate.mjs has run on.
//   · a kept table (preserved, or outside `public`) with a foreign key to a
//     wiped table → ABORT — TRUNCATE would refuse (or, with CASCADE, silently
//     wipe the kept table too).
//
// Everything else that is live and created by a migration is truncated;
// RESET_PRESERVE_TABLES lists the configuration / reference tables that
// survive. Pure and fs-free — the script passes the migration files in, and
// node:test covers it (db-reset-plan.test.mjs).

/**
 * Tables a reset keeps, with the reason. Only tables whose loss breaks the
 * app or throws away configuration the shop goes live with — not data.
 */
export const RESET_PRESERVE_TABLES = Object.freeze({
  _migrations: "schema version tracker (scripts/migrate.mjs)",
  campaigns:
    "campaign definitions — incl. the built-in Einzelansprache and Lebenszyklus, which only migration 0066 creates (1:1 mails and the Eingang need them)",
  email_design_selections: "which e-mail design each mail type uses (configuration, 0049)",
});

// A table name as migrations write it: optionally `public.`, optionally quoted.
const NAME = String.raw`(?:"?public"?\s*\.\s*)?"?[A-Za-z_][A-Za-z0-9_]*"?`;
// Groups: 1 CREATE, 2 its table · 3 DROP, 4 its table list · 5 ALTER, 6 old, 7 new name.
const TABLE_DDL = new RegExp(
  String.raw`\b(?:(CREATE)\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${NAME})` +
    String.raw`|(DROP)\s+TABLE\s+(?:IF\s+EXISTS\s+)?(${NAME}(?:\s*,\s*${NAME})*)` +
    String.raw`|(ALTER)\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${NAME})\s+RENAME\s+TO\s+(${NAME}))`,
  "gi"
);

/**
 * Strip `-- …` line comments and `/* … *\/` block comments in one pass, so a
 * comment marker inside a '…' string or the other comment kind is not misread
 * (DDL detection only — the result is never executed).
 */
export function stripSqlComments(sql) {
  const s = String(sql);
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const next = s[i + 1];
    if (c === "-" && next === "-") {
      const end = s.indexOf("\n", i);
      i = end === -1 ? s.length : end;
      out += " ";
    } else if (c === "/" && next === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end === -1 ? s.length : end + 2;
      out += " ";
    } else if (c === "'") {
      // '' inside a literal simply closes and reopens it — same result.
      const end = s.indexOf("'", i + 1);
      const stop = end === -1 ? s.length : end + 1;
      out += s.slice(i, stop);
      i = stop;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

function bareName(raw) {
  return raw.replace(/"/g, "").trim().replace(/^public\s*\.\s*/i, "").toLowerCase();
}

/**
 * The tables the migrations leave behind, applied in filename order (like
 * scripts/migrate.mjs): CREATE TABLE adds, DROP TABLE removes, ALTER TABLE …
 * RENAME TO moves. Temporary tables are not matched.
 * @param {Array<{ name: string, sql: string }>} files
 * @returns {string[]} sorted table names
 */
export function tablesFromMigrations(files) {
  const tables = new Set();
  const ordered = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const file of ordered) {
    const sql = stripSqlComments(file.sql);
    for (const m of sql.matchAll(TABLE_DDL)) {
      if (m[1]) tables.add(bareName(m[2]));
      else if (m[3]) for (const t of m[4].split(",")) tables.delete(bareName(t));
      else if (m[5]) {
        tables.delete(bareName(m[6]));
        tables.add(bareName(m[7]));
      }
    }
  }
  return [...tables].sort();
}

/**
 * Decide what a reset truncates.
 * @param {{
 *   liveTables: string[],                       // public base tables
 *   migrationTables: string[],                  // tablesFromMigrations(...)
 *   foreignKeys: Array<{ from: string, to: string }>, // FKs INTO public tables; `from` schema-qualified unless public
 *   preserve?: string[],
 * }} input
 * @returns {{ truncate: string[], preserved: string[], errors: string[] }}
 */
export function planReset({ liveTables, migrationTables, foreignKeys = [], preserve = Object.keys(RESET_PRESERVE_TABLES) }) {
  const live = [...new Set(liveTables)].sort();
  const known = new Set(migrationTables);
  const keep = new Set(preserve);
  const errors = [];

  if (!live.includes("_migrations")) {
    errors.push("no _migrations table — not a database scripts/migrate.mjs has run on (wrong connection?)");
  }
  const unknown = live.filter((t) => !known.has(t) && !keep.has(t));
  if (unknown.length > 0) {
    errors.push(
      `live table(s) no migration in migrations/ creates: ${unknown.join(", ")} — a foreign database, a table made by hand, or a checkout older than the database`
    );
  }

  const truncate = live.filter((t) => known.has(t) && !keep.has(t));
  const preserved = live.filter((t) => keep.has(t));
  const wiped = new Set(truncate);
  const blocking = foreignKeys.filter((fk) => wiped.has(fk.to) && !wiped.has(fk.from));
  for (const fk of blocking) {
    errors.push(`kept table ${fk.from} has a foreign key to ${fk.to}, which the reset wipes — preserve both or neither`);
  }
  return { truncate, preserved, errors };
}

/** Double-quote an identifier for a statement built from catalog names. */
export function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}
