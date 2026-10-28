// Showroom availability — the I/O half (parser, state and refresh flow live in
// the pure, tested showroom-core.mjs). admin_settings key 'showroom' (migration
// 0078 — no new migration) keeps the last good list read from the live theme,
// the admin's manual fallback list, the last refresh and its error. Read with a
// short in-memory TTL by the chat (prompt, suggest_showroom), GET /api/products
// and the configurator cards; refreshed daily by the catalog sync cron and on
// demand from the admin („Jetzt aktualisieren“). Fail-soft throughout: without
// a database the showroom is unknown, a failed refresh keeps the last good
// list, nothing here can break a chat response. docs/CONFIGURATOR.md §4b.
//
// Reading the theme needs the Admin API scope `read_themes` (the live state and
// how it is added: docs/ROLLOUT_TODO.md item 16.3); without it the refresh
// records „Berechtigung read_themes fehlt …“ and only the manual list applies.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { adminGraphql, isShopifyConfigured } from "./shopify";
import { loadProductCatalog } from "./catalog-store";
import {
  SHOWROOM_SETTINGS_KEY,
  applyThemeResult,
  emptyShowroomState,
  loadShowroomFromTheme,
  parseShowroomState,
  serializeShowroomState,
  showroomThemeFile,
  showroomView,
  type ShowroomState,
} from "./showroom-core.mjs";

export type { ShowroomState };
export type ShowroomView = ReturnType<typeof showroomView>;

/** SQLSTATE 42P01 (undefined_table) on the error or one level down. */
function isMissingTable(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
}

/** The stored state (empty: no database, no row, before 0078) — null on a read error. */
async function readShowroomState(sql: Sql | null): Promise<ShowroomState | null> {
  if (!sql) return emptyShowroomState();
  try {
    const rows = (await sql`
      SELECT value FROM admin_settings WHERE key = ${SHOWROOM_SETTINGS_KEY}
    `) as Array<{ value: unknown }>;
    return parseShowroomState(rows[0]?.value ?? null);
  } catch (err) {
    if (isMissingTable(err)) return emptyShowroomState();
    reportError(err, { route: "lib/showroom-store", phase: "getShowroomState" });
    return null;
  }
}

/** The stored state, or the empty one (no database, no row, before 0078, read error). */
export async function getShowroomState(sql: Sql | null = getSql()): Promise<ShowroomState> {
  return (await readShowroomState(sql)) ?? emptyShowroomState();
}

type WriteResult = { ok: true; state: ShowroomState } | { ok: false; reason: "no_db" | "missing_table" | "failed" };

async function writeShowroomState(state: ShowroomState, sql: Sql | null): Promise<WriteResult> {
  if (!sql) return { ok: false, reason: "no_db" };
  const value = serializeShowroomState(state);
  try {
    const rows = (await sql`
      INSERT INTO admin_settings (key, value, updated_at)
      VALUES (${SHOWROOM_SETTINGS_KEY}, ${value}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      RETURNING value
    `) as Array<{ value: unknown }>;
    dropShowroomCache();
    return { ok: true, state: parseShowroomState(rows[0]?.value ?? value) };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "missing_table" };
    reportError(err, { route: "lib/showroom-store", phase: "writeShowroomState" });
    return { ok: false, reason: "failed" };
  }
}

// Per-instance cache for the chat path and the public endpoints: one read per
// instance and five minutes at most. A save or refresh here drops it; other
// warm instances follow within the TTL.
const VIEW_TTL_MS = 5 * 60_000;
let viewCache: { at: number; view: ShowroomView } | null = null;

export function dropShowroomCache(): void {
  viewCache = null;
}

/** The products on display and whether the showroom is known at all (cached). Never throws. */
export async function getCachedShowroom(): Promise<ShowroomView> {
  if (viewCache && Date.now() - viewCache.at < VIEW_TTL_MS) return viewCache.view;
  const view = showroomView(await getShowroomState());
  viewCache = { at: Date.now(), view };
  return view;
}

/** Store the admin's manual fallback list (validated by the caller: validateManualShowroomInput). */
export async function saveManualShowroomHandles(handles: string[], sql: Sql | null = getSql()): Promise<WriteResult> {
  if (!sql) return { ok: false, reason: "no_db" };
  const current = await getShowroomState(sql);
  return writeShowroomState({ ...current, manualHandles: handles }, sql);
}

export interface ShowroomRefreshResult {
  ok: boolean;
  /** Products read from the theme this time (0 on failure). */
  count: number;
  error: string | null;
  /** disabled = SHOWROOM_THEME_FILE is "off"; no_db = nothing could be stored. */
  skipped?: "disabled" | "no_db";
  state: ShowroomState;
}

/**
 * Read the showroom from the live theme and store it (a failure keeps the last
 * good list and records the error). Without SHOWROOM_SECTION_ID a section whose
 * heading no longer says „Showroom“ is found by the id of the last good read
 * (showroom-core loadShowroomFromTheme `fallbackSectionIds`). The state is read
 * again right before writing and only the theme part is applied to it — a
 * manual list saved meanwhile (another tab or admin, a save during the cron's
 * Admin API call) is kept; when that read fails nothing is written.
 * `background`: the cron rides out Shopify throttles; the admin button gives up
 * at once instead. Never throws.
 */
export async function refreshShowroomFromTheme(
  opts: { background?: boolean } = {},
  sql: Sql | null = getSql()
): Promise<ShowroomRefreshResult> {
  const file = showroomThemeFile(process.env.SHOWROOM_THEME_FILE);
  const current = await getShowroomState(sql);
  if (!file) return { ok: false, count: 0, error: null, skipped: "disabled", state: current };
  try {
    const result = isShopifyConfigured()
      ? await loadShowroomFromTheme({
          graphql: (query, variables) =>
            adminGraphql(query, variables, { timeoutMs: 20_000, retry: opts.background === true }),
          fetchText: async (url) => {
            const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
            if (!res.ok) throw new Error(`HTTP ${res.status} for the theme file`);
            return res.text();
          },
          file,
          sectionId: process.env.SHOWROOM_SECTION_ID?.trim() || null,
          // A renamed heading: the section of the last good read, by id (only without a pin).
          fallbackSectionIds: current.theme.sections.map((s) => s.id),
        })
      : ({ ok: false, error: "Shopify ist nicht konfiguriert (SHOPIFY_*).", file } as const);
    // Re-read right before writing (the Admin API call can take seconds) and apply only the theme part.
    const latest = await readShowroomState(sql);
    if (!latest) {
      return { ok: false, count: 0, error: "Der Showroom konnte nicht gespeichert werden.", state: current };
    }
    const next = applyThemeResult(latest, result);
    const written = await writeShowroomState(next, sql);
    const count = result.ok ? next.theme.handles.length : 0;
    const error = result.ok ? null : result.error;
    if (!written.ok) {
      return { ok: false, count, error: error ?? "Der Showroom konnte nicht gespeichert werden.", skipped: written.reason === "no_db" ? "no_db" : undefined, state: next };
    }
    return { ok: result.ok, count, error, state: written.state };
  } catch (err) {
    reportError(err, { route: "lib/showroom-store", phase: "refreshShowroomFromTheme" });
    return { ok: false, count: 0, error: "Der Showroom konnte nicht aktualisiert werden.", state: current };
  }
}

/** What the admin card „Showroom“ shows (Konfigurator → „Sortiment“) — plain props. */
export interface ShowroomCardData {
  known: boolean;
  source: ShowroomView["source"];
  /** Products on display (theme list ∪ manual list). */
  count: number;
  themeCount: number;
  manualCount: number;
  /** The theme file read; null while SHOWROOM_THEME_FILE is "off". */
  file: string | null;
  sections: Array<{ id: string; heading: string }>;
  /** Collections a showroom section points to (their products count as on display). */
  collections: string[];
  themeName: string;
  /** The last good read of the theme (ISO) — null: never read. */
  fetchedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  manual: Array<{ id: string; title: string | null }>;
  /** Every product on display (sorted by title) and where it comes from. */
  displayed: Array<{ id: string; title: string | null; theme: boolean; manual: boolean }>;
  /** Products on display the catalog does not know (renamed / deleted handles). */
  unknownHandles: string[];
  shopifyConfigured: boolean;
}

/** The admin card's props for a state (product titles from the catalog; fail-soft). */
export async function showroomCardData(state: ShowroomState): Promise<ShowroomCardData> {
  const view = showroomView(state);
  let byId = new Map<string, string>();
  try {
    byId = new Map((await loadProductCatalog()).map((p) => [p.id, p.name]));
  } catch (err) {
    reportError(err, { route: "lib/showroom-store", phase: "showroomCardData.catalog" });
  }
  return {
    known: view.known,
    source: view.source,
    count: view.ids.size,
    themeCount: view.themeCount,
    manualCount: view.manualCount,
    file: showroomThemeFile(process.env.SHOWROOM_THEME_FILE),
    sections: state.theme.sections,
    collections: state.theme.collections,
    themeName: state.theme.themeName,
    fetchedAt: state.theme.fetchedAt,
    lastAttemptAt: state.lastAttemptAt,
    lastError: state.lastError,
    manual: state.manualHandles.map((id) => ({ id, title: byId.get(id) ?? null })),
    displayed: [...view.ids]
      .map((id) => ({
        id,
        title: byId.get(id) ?? null,
        theme: state.theme.handles.includes(id),
        manual: state.manualHandles.includes(id),
      }))
      .sort((a, b) => (a.title ?? a.id).localeCompare(b.title ?? b.id, "de")),
    unknownHandles: byId.size ? [...view.ids].filter((id) => !byId.has(id)) : [],
    shopifyConfigured: isShopifyConfigured(),
  };
}
