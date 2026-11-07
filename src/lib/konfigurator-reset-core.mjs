// Konfigurator go-live reset — the pure rules (tested in
// konfigurator-reset-core.test.mjs). The I/O is scripts/reset-konfigurator-data.mjs;
// what it deletes and why: docs/CONFIGURATOR.md „Go-live: Testdaten löschen“.
//
// The Home-Gym-Konfigurator has no table of its own. Its traces sit in shared
// tables, so every rule here is about recognising them exactly — and about
// never touching anything else:
//
//   * kpi_events whose name starts with „configurator_“ (16 page events + 3
//     server-only events, configurator-core.mjs — no other event name starts
//     with that prefix);
//   * the configurator CHATS: a thread with one of Mo's configurator tools
//     (suggest_replies, show_gym_plan, offer_plan_options — only active with a
//     configurator context), a thread whose persona is one only the configurator
//     sets, or the thread a „configurator_chat_started“ opened (greeting-only
//     handovers carry no tool row);
//   * the ordinary widget events of those chats (chat_opened, message_sent,
//     product clicks, popups …): all events of a session that only ever held
//     configurator chats (an anonymous visitor gets a fresh session at the
//     handover), and for a shared session (signed in, or other chats) only the
//     events inside the configurator chat's time window.
//
// Everything is bounded by a FIXED cutoff the owner types (`--before`), never
// by the time the script happens to run — a re-run after the launch can only
// reach data from before that cutoff.

import { CONFIGURATOR_TOOLS, CONFIGURATOR_FIELDS, KPI_CONFIGURATOR_CHAT_STARTED } from "./configurator-core.mjs";
import { KPI_RELEASES } from "./kpi-releases.mjs";

/** Every configurator event name starts with this (configurator-core.mjs). */
export const CONFIGURATOR_EVENT_PREFIX = "configurator_";

/** Mo's configurator tools — a thread with one of them is a configurator thread. */
export const RESET_CONFIGURATOR_TOOLS = Object.freeze([...CONFIGURATOR_TOOLS]);

/**
 * Personas only the configurator's „Trainingsfokus“ card sets on a chat
 * (persona.ts deriveArchetype never returns them).
 */
export const CONFIGURATOR_ONLY_PERSONAS = Object.freeze(["design_lifestyle", "weight_loss"]);

/** The audit action written to admin_access_log by an applied reset (the re-run guard reads it). */
export const RESET_AUDIT_ACTION = "konfigurator.reset";

/** How long after a „configurator_chat_started“ its greeting thread can be created. */
export const HANDOVER_THREAD_WINDOW_MS = 5 * 60_000;

/** Padding around a configurator chat in a shared session (events just before the first row, after the last). */
export const SHARED_WINDOW_PAD_MS = 5 * 60_000;

/** A cutoff may lie at most this far in the future (clock skew), never more. */
export const CUTOFF_FUTURE_TOLERANCE_MS = 5 * 60_000;

function releaseDate(key) {
  const r = KPI_RELEASES.find((x) => x.key === key);
  if (!r) throw new Error(`konfigurator-reset-core: no release "${key}"`);
  return r.date;
}

/**
 * The lower bound of every delete: the day before the configurator's first
 * release (no configurator data can be older; the extra day absorbs time
 * zones). Nothing older is ever touched, whatever a predicate matches.
 */
export const KONFIGURATOR_RESET_SINCE = (() => {
  const d = new Date(`${releaseDate("home-gym-konfigurator")}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString();
})();

/** ISO 8601 with a time and an explicit zone (Z or ±hh:mm) — no ambiguous local times. */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Parse the command line.
 *   --before <ISO with zone | now>   required: everything configurator-made BEFORE this instant goes
 *   --apply                           delete (without it: preview only)
 *   --orders "#1001,#1002"            test orders to delete from the ledger (names or Shopify ids)
 *   --keep-orders                     keep every candidate order (they become ordinary „Umsatz durch Mo“)
 *   --again                           allow a second applied run
 * @param {string[]} argv  process.argv.slice(2)
 * @param {number} nowMs
 */
export function parseResetArgs(argv, nowMs) {
  /** @type {string[]} */
  const errors = [];
  const out = {
    help: false,
    apply: false,
    again: false,
    keepOrders: false,
    /** @type {string[]} */
    orders: [],
    /** @type {string | null} */
    before: null,
    /** @type {number | null} */
    beforeMs: null,
    beforeWasNow: false,
  };
  const args = [...argv];
  while (args.length > 0) {
    const a = String(args.shift());
    const [flag, inline] = a.startsWith("--") && a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, null];
    const value = () => (inline != null ? inline : args.length > 0 && !String(args[0]).startsWith("--") ? String(args.shift()) : null);
    switch (flag) {
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--apply":
        out.apply = true;
        break;
      case "--again":
        out.again = true;
        break;
      case "--keep-orders":
        out.keepOrders = true;
        break;
      case "--orders": {
        const v = value();
        if (v == null) errors.push("--orders braucht eine Liste, z. B. --orders \"#1001,#1002\".");
        else out.orders.push(...parseOrderList(v));
        break;
      }
      case "--before": {
        const v = value();
        if (v == null) {
          errors.push("--before braucht einen Zeitpunkt, z. B. --before 2026-11-08T09:00:00+01:00 oder --before now.");
          break;
        }
        if (v.trim().toLowerCase() === "now") {
          out.beforeMs = nowMs;
          out.beforeWasNow = true;
        } else if (!ISO_WITH_ZONE.test(v.trim())) {
          errors.push(
            `--before „${v}“: bitte mit Datum, Uhrzeit und Zeitzone angeben, z. B. 2026-11-08T09:00:00+01:00 (Winterzeit Berlin) — oder „now“.`
          );
        } else {
          const ms = Date.parse(v.trim());
          if (!Number.isFinite(ms)) errors.push(`--before „${v}“ ist kein gültiger Zeitpunkt.`);
          else out.beforeMs = ms;
        }
        break;
      }
      default:
        errors.push(`Unbekannte Option „${a}“ (--help zeigt alle).`);
    }
  }
  if (!out.help) {
    if (out.beforeMs == null && !errors.some((e) => e.startsWith("--before"))) {
      errors.push("--before fehlt: der Zeitpunkt, bis zu dem alles Konfigurator-Bezogene gelöscht wird (z. B. der Go-live), oder „now“.");
    }
    if (out.beforeMs != null) {
      if (out.beforeMs <= Date.parse(KONFIGURATOR_RESET_SINCE)) {
        errors.push(`--before liegt vor dem ersten Konfigurator-Release (${KONFIGURATOR_RESET_SINCE.slice(0, 10)}) — da gibt es nichts zu löschen.`);
      } else if (out.beforeMs > nowMs + CUTOFF_FUTURE_TOLERANCE_MS) {
        errors.push("--before liegt in der Zukunft — erlaubt sind nur Zeitpunkte bis jetzt (sonst würde ein späterer Lauf echte Daten treffen).");
      }
    }
    if (out.keepOrders && out.orders.length > 0) errors.push("--orders und --keep-orders schließen sich aus.");
  }
  if (out.beforeMs != null && errors.length === 0) out.before = new Date(out.beforeMs).toISOString();
  return { ok: errors.length === 0, errors, ...out };
}

/** "#1001, 1002 #1003" → ["1001","1002","1003"] (the leading # is optional everywhere). */
export function parseOrderList(raw) {
  return String(raw ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().replace(/^#/, ""))
    .filter((s) => /^[A-Za-z0-9._-]{1,64}$/.test(s));
}

/**
 * @typedef {{
 *   id: number,
 *   sessionId: string | null,
 *   conversationKey: string | null,
 *   customerId: number | null,
 *   createdAt: string,
 *   lastAt: string,
 *   hasConfiguratorTool: boolean,
 *   personaLabel: string | null,
 * }} CandidateConversation
 * @typedef {{ sessionId: string, at: string }} ChatStart
 */

/**
 * Which candidate conversations are configurator chats, with the reason(s).
 *   „werkzeug“  a configurator tool row (exact — the tools exist only with a configurator context)
 *   „persona“   a persona only the configurator sets
 *   „übergabe“  the thread a configurator_chat_started opened: the first thread of that session created
 *               within HANDOVER_THREAD_WINDOW_MS after the event, a configurator thread preferred
 *               (catches greeting-only handovers, which carry no tool row)
 * @param {{ conversations: CandidateConversation[], chatStarts: ChatStart[], windowMs?: number }} input
 * @returns {Map<number, string[]>}
 */
export function selectConfiguratorConversations({ conversations, chatStarts, windowMs = HANDOVER_THREAD_WINDOW_MS }) {
  /** @type {Map<number, string[]>} */
  const picked = new Map();
  const add = (id, reason) => {
    const r = picked.get(id) ?? [];
    if (!r.includes(reason)) r.push(reason);
    picked.set(id, r);
  };
  for (const c of conversations) {
    if (c.hasConfiguratorTool) add(c.id, "werkzeug");
    if (c.personaLabel && CONFIGURATOR_ONLY_PERSONAS.includes(c.personaLabel)) add(c.id, "persona");
  }
  /** @type {Map<string, CandidateConversation[]>} */
  const bySession = new Map();
  for (const c of conversations) {
    if (!c.sessionId) continue;
    const list = bySession.get(c.sessionId) ?? [];
    list.push(c);
    bySession.set(c.sessionId, list);
  }
  for (const start of chatStarts) {
    const t = Date.parse(start.at);
    if (!start.sessionId || !Number.isFinite(t)) continue;
    const inWindow = (bySession.get(start.sessionId) ?? [])
      .filter((c) => {
        const ct = Date.parse(c.createdAt);
        return Number.isFinite(ct) && ct >= t && ct <= t + windowMs;
      })
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id);
    const chosen = inWindow.find((c) => c.hasConfiguratorTool) ?? inWindow[0];
    if (chosen) add(chosen.id, "übergabe");
  }
  return picked;
}

/**
 * Split the sessions of the configurator chats.
 *   exclusive — every conversation the session ever held is a configurator chat and nobody is signed in
 *               on it (an anonymous visitor gets a fresh session at the handover): ALL its events in the
 *               reset window go;
 *   shared    — signed in (the session id never rotates) or other chats on it: only the events inside the
 *               configurator chats' time windows (± SHARED_WINDOW_PAD_MS) go.
 * @param {{
 *   configuratorConversations: Array<{ id: number, sessionId: string | null, createdAt: string, lastAt: string }>,
 *   writerSessions: Map<number, string[]>,          conversation id → messages.session_id values (other devices)
 *   conversationCounts: Map<string, number>,        session → number of conversations it ever held
 *   signedInSessions: Set<string>,                  sessions linked by a real sign-in (customer_account / app_proxy)
 *   padMs?: number,
 * }} input
 * @returns {{ exclusive: string[], shared: Array<{ sessionId: string, windows: Array<{ from: string, to: string }> }> }}
 */
export function classifySessions({ configuratorConversations, writerSessions, conversationCounts, signedInSessions, padMs = SHARED_WINDOW_PAD_MS }) {
  /** @type {Map<string, Array<{ id: number, createdAt: string, lastAt: string }>>} */
  const convsBySession = new Map();
  /** @type {Map<string, number>} configurator conversations whose OWN session is s */
  const ownCount = new Map();
  for (const c of configuratorConversations) {
    const sessions = new Set([c.sessionId, ...(writerSessions.get(c.id) ?? [])].filter((s) => typeof s === "string" && s.length > 0));
    for (const s of sessions) {
      const list = convsBySession.get(s) ?? [];
      list.push(c);
      convsBySession.set(s, list);
    }
    if (c.sessionId) ownCount.set(c.sessionId, (ownCount.get(c.sessionId) ?? 0) + 1);
  }
  /** @type {string[]} */
  const exclusive = [];
  /** @type {Array<{ sessionId: string, windows: Array<{ from: string, to: string }> }>} */
  const shared = [];
  for (const [s, convs] of [...convsBySession.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const total = conversationCounts.get(s) ?? 0;
    const own = ownCount.get(s) ?? 0;
    // A session that is only a WRITER (another device) of a configurator chat holds own === 0 → shared.
    const isExclusive = own > 0 && total === own && !signedInSessions.has(s);
    if (isExclusive) {
      exclusive.push(s);
      continue;
    }
    shared.push({ sessionId: s, windows: mergeWindows(convs.map((c) => ({ from: Date.parse(c.createdAt) - padMs, to: Date.parse(c.lastAt) + padMs }))) });
  }
  return { exclusive, shared };
}

/** Merge overlapping [from, to] millisecond windows → sorted ISO windows. */
export function mergeWindows(windows) {
  const valid = windows
    .filter((w) => Number.isFinite(w.from) && Number.isFinite(w.to) && w.to >= w.from)
    .sort((a, b) => a.from - b.from);
  /** @type {Array<{ from: number, to: number }>} */
  const merged = [];
  for (const w of valid) {
    const last = merged[merged.length - 1];
    if (last && w.from <= last.to) last.to = Math.max(last.to, w.to);
    else merged.push({ ...w });
  }
  return merged.map((w) => ({ from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString() }));
}

/**
 * The test orders: the ledger rows the reset deletes. Candidates are the
 * orders „über den Konfigurator“ and the orders with the Konfigurator-Rabatt
 * code before the cutoff; the owner names the ones to delete (`--orders`) or
 * keeps all (`--keep-orders`). Without a decision the apply refuses — after the
 * configurator chats are gone a kept test order silently turns into ordinary
 * „Umsatz durch Mo“.
 * @param {{
 *   candidates: Array<{ id: number, orderName: string | null, shopifyOrderId: string | null }>,
 *   named: Array<{ id: number, orderName: string | null, shopifyOrderId: string | null }>,  rows found for --orders
 *   requested: string[],                                                                      the --orders values
 *   keepOrders: boolean,
 * }} input
 */
export function decideOrders({ candidates, named, requested, keepOrders }) {
  const norm = (v) => String(v ?? "").trim().replace(/^#/, "");
  const deleteIds = [...new Set(named.map((o) => o.id))].sort((a, b) => a - b);
  const found = new Set(named.flatMap((o) => [norm(o.orderName), norm(o.shopifyOrderId)]).filter(Boolean));
  const missing = requested.filter((r) => !found.has(norm(r)));
  const undecided = keepOrders ? [] : candidates.filter((c) => !deleteIds.includes(c.id));
  return { deleteIds, missing, undecided, ok: missing.length === 0 && undecided.length === 0 };
}

/** The `configurator_` prefix check exactly as SQL's starts_with — for tests and the report. */
export function isConfiguratorEvent(name) {
  return typeof name === "string" && name.startsWith(CONFIGURATOR_EVENT_PREFIX);
}

/** The event that opens a configurator chat (re-exported for the script). */
export const RESET_CHAT_STARTED_EVENT = KPI_CONFIGURATOR_CHAT_STARTED;

/** The persona choices of the configurator page (to keep CONFIGURATOR_ONLY_PERSONAS honest — tested). */
export function configuratorPersonaChoices() {
  const field = CONFIGURATOR_FIELDS.find((f) => f.key === "persona");
  return field && Array.isArray(field.options) ? field.options.map((o) => o.id) : [];
}
