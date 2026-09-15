// State rules of the Kampagne review desk — pure, no I/O (plain .mjs so the
// selection, filter and estimate logic is unit-tested with node:test). The
// React side (src/app/admin/kampagne/) owns the state; this module owns the
// rules it applies.

/** The three views of the screen (`?view=`). */
export const DESK_VIEWS = Object.freeze(["pruefen", "liste", "gesendet"]);

/**
 * @param {unknown} value
 * @returns {"pruefen" | "liste" | "gesendet"}
 */
export function parseDeskView(value) {
  return typeof value === "string" && DESK_VIEWS.includes(value)
    ? /** @type {"pruefen" | "liste" | "gesendet"} */ (value)
    : "pruefen";
}

/**
 * Queue filter chips (`?filter=`). Single-choice: the chips are a quick way
 * to work the queue in batches of similar mails, not a query builder.
 */
export const QUEUE_FILTERS = Object.freeze([
  { key: "all", label: "Alle" },
  { key: "doi", label: "DOI" },
  { key: "soi", label: "Single/Unbekannt" },
  { key: "en", label: "EN" },
  { key: "discount", label: "Rabatt" },
  { key: "set", label: "Set" },
  { key: "hints", label: "Hinweise" },
  { key: "blocked", label: "Blockiert" },
]);

/** @type {readonly string[]} */
export const QUEUE_FILTER_KEYS = Object.freeze(QUEUE_FILTERS.map((f) => f.key));

/**
 * @param {unknown} value
 * @returns {string} a valid filter key ("all" when unknown)
 */
export function parseQueueFilter(value) {
  return typeof value === "string" && QUEUE_FILTER_KEYS.includes(value) ? value : "all";
}

/**
 * Whether a queue item belongs to a filter.
 * @param {{ optInLevel?: string | null, language?: string, discountPercent?: number, bundle?: unknown }} item
 * @param {string} filter
 * @param {"blocked" | "hints" | "ready"} verdict the item's review verdict
 * @returns {boolean}
 */
export function matchesQueueFilter(item, filter, verdict) {
  switch (filter) {
    case "doi":
      return item.optInLevel === "CONFIRMED_OPT_IN";
    case "soi":
      return item.optInLevel !== "CONFIRMED_OPT_IN";
    case "en":
      return item.language === "en";
    case "discount":
      return Number(item.discountPercent) > 0;
    case "set":
      return item.bundle != null;
    case "hints":
      return verdict === "hints" || verdict === "blocked";
    case "blocked":
      return verdict === "blocked";
    default:
      return true;
  }
}

/**
 * Per-filter counts for the chips.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => "blocked" | "hints" | "ready"} verdictOf
 * @returns {Record<string, number>}
 */
export function queueFilterCounts(items, verdictOf) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const key of QUEUE_FILTER_KEYS) counts[key] = 0;
  for (const item of items) {
    const verdict = verdictOf(item);
    for (const key of QUEUE_FILTER_KEYS) {
      if (matchesQueueFilter(/** @type {never} */ (item), key, verdict)) counts[key] += 1;
    }
  }
  return counts;
}

/**
 * Which card to show after the current one leaves the visible list (sent,
 * skipped, filtered away): the card that took its position, else the one
 * before it, else nothing.
 * @param {number[]} visibleIdsBefore ids in display order BEFORE the removal
 * @param {number} removedId
 * @returns {number | null}
 */
export function nextSelectionAfterRemoval(visibleIdsBefore, removedId) {
  const index = visibleIdsBefore.indexOf(removedId);
  const remaining = visibleIdsBefore.filter((id) => id !== removedId);
  if (remaining.length === 0) return null;
  if (index < 0) return remaining[0];
  return remaining[Math.min(index, remaining.length - 1)];
}

/**
 * Keep the current card when it is still visible, else fall back to the
 * first visible one (used when the filter or the server queue changes).
 * @param {number[]} visibleIds
 * @param {number | null} currentId
 * @returns {number | null}
 */
export function selectionAfterListChange(visibleIds, currentId) {
  if (currentId !== null && visibleIds.includes(currentId)) return currentId;
  return visibleIds[0] ?? null;
}

/**
 * The neighbour of the current card in the visible list.
 * @param {number[]} visibleIds
 * @param {number | null} currentId
 * @param {1 | -1} direction
 * @returns {number | null} the neighbour, or the current id at the ends
 */
export function stepSelection(visibleIds, currentId, direction) {
  if (visibleIds.length === 0) return null;
  const index = currentId === null ? -1 : visibleIds.indexOf(currentId);
  if (index < 0) return visibleIds[0];
  const next = Math.min(visibleIds.length - 1, Math.max(0, index + direction));
  return visibleIds[next];
}

/** Seconds a draft resp. a hero render typically takes, for the estimate. */
export const SECONDS_PER_DRAFT = 8;
export const SECONDS_PER_HERO = 90;

/**
 * What a "Vorbereiten" run will do, before it is started: how many drafts can
 * actually be prepared (the pending contacts inside the send window cap the
 * request), how many heroes the A group needs, and the money and time that
 * costs based on the recorded averages (null when nothing was recorded yet).
 *
 * @param {{
 *   count: number,
 *   pendingSendable: number,
 *   draftCostEur: number | null,
 *   heroCostEur: number | null,
 *   withHero: boolean,
 * }} input
 * @returns {{ drafts: number, heroes: number, costEur: number | null, seconds: number }}
 */
export function prepareEstimate(input) {
  const drafts = Math.max(0, Math.min(Math.floor(input.count) || 0, Math.floor(input.pendingSendable) || 0));
  // Half of the prepared contacts land in the A group (even ids) on average.
  const heroes = input.withHero ? Math.ceil(drafts / 2) : 0;
  const draftCost = typeof input.draftCostEur === "number" ? input.draftCostEur * drafts : null;
  const heroCost =
    heroes > 0 ? (typeof input.heroCostEur === "number" ? input.heroCostEur * heroes : null) : 0;
  const costEur = draftCost === null || heroCost === null ? null : draftCost + heroCost;
  return {
    drafts,
    heroes,
    costEur,
    seconds: drafts * SECONDS_PER_DRAFT + heroes * SECONDS_PER_HERO,
  };
}

/**
 * Today's progress for the header bar: sends so far against the day's queue.
 * @param {number} sentToday
 * @param {number} toReview
 * @returns {{ done: number, total: number, ratio: number }}
 */
export function deskProgress(sentToday, toReview) {
  const done = Math.max(0, Math.floor(sentToday) || 0);
  const total = done + Math.max(0, Math.floor(toReview) || 0);
  return { done, total, ratio: total > 0 ? done / total : 0 };
}

/** Postausgang entries kept on screen (newest first). */
export const OUTBOX_MAX = 8;

/**
 * Insert or update an outbox entry (keyed by contactId); newest first, capped.
 * @template {{ contactId: number }} E
 * @param {E[]} outbox
 * @param {E} entry
 * @param {number} [max]
 * @returns {E[]}
 */
export function upsertOutbox(outbox, entry, max = OUTBOX_MAX) {
  const rest = outbox.filter((e) => e.contactId !== entry.contactId);
  return [entry, ...rest].slice(0, max);
}

/** Delivery-state filters of the „Gesendet“ view. */
export const HISTORY_DELIVERY_FILTERS = Object.freeze([
  { key: "all", label: "Alle" },
  { key: "delivered", label: "Zugestellt" },
  { key: "clicked", label: "Geklickt" },
  { key: "bounced", label: "Bounce" },
  { key: "complained", label: "Beschwerde" },
  { key: "copy", label: "Kopiert" },
  { key: "expiring", label: "Läuft bald ab" },
]);

/**
 * @param {unknown} value
 * @returns {"all" | "delivered" | "clicked" | "bounced" | "complained" | "copy" | "expiring"}
 */
export function parseDeliveryFilter(value) {
  return typeof value === "string" && HISTORY_DELIVERY_FILTERS.some((f) => f.key === value)
    ? /** @type {"all" | "delivered" | "clicked" | "bounced" | "complained" | "copy" | "expiring"} */ (value)
    : "all";
}

/**
 * A sent offer (discount code, set) counts as „läuft bald ab" within this
 * window — the moment to send a reminder. The „Gesendet" filter of the same
 * name and the badge use it; the store's SQL gets the same number.
 */
export const OFFER_EXPIRING_SOON_HOURS = 48;

/**
 * How long what a send carried is still valid: the EARLIER of the discount
 * code's expiry (only with a code) and the attached set's expiry. `none`
 * when the send carried nothing that expires.
 *
 * @param {{ discountCode?: string | null, discountExpiresAt?: string | null, bundleExpiresAt?: string | null }} send
 * @param {number | Date} [now]
 * @returns {{
 *   state: "none" | "expired" | "soon" | "valid",
 *   expiresAt: string | null,
 *   hoursLeft: number | null,
 *   kinds: Array<"discount" | "bundle">,
 * }}
 */
export function offerValidity(send, now = Date.now()) {
  const ref = now instanceof Date ? now.getTime() : now;
  /** @type {Array<{ kind: "discount" | "bundle", at: number }>} */
  const deadlines = [];
  const push = (kind, value) => {
    if (!value) return;
    const t = new Date(value).getTime();
    if (Number.isFinite(t)) deadlines.push({ kind, at: t });
  };
  if (send.discountCode) push("discount", send.discountExpiresAt);
  push("bundle", send.bundleExpiresAt);
  if (deadlines.length === 0) return { state: "none", expiresAt: null, hoursLeft: null, kinds: [] };
  const earliest = Math.min(...deadlines.map((d) => d.at));
  const hoursLeft = (earliest - ref) / 3_600_000;
  const state = hoursLeft <= 0 ? "expired" : hoursLeft <= OFFER_EXPIRING_SOON_HOURS ? "soon" : "valid";
  return {
    state,
    expiresAt: new Date(earliest).toISOString(),
    hoursLeft,
    kinds: deadlines.map((d) => d.kind),
  };
}

/**
 * The short German label of an offer's validity for the „Gesendet" list:
 * „Abgelaufen", „noch 5 Std." within the reminder window, „noch 6 Tage" beyond
 * it (whole days, rounded down — never promises more than there is).
 * @param {ReturnType<typeof offerValidity>} validity
 * @returns {string}
 */
export function offerValidityLabel(validity) {
  if (validity.state === "none" || validity.hoursLeft === null) return "—";
  if (validity.state === "expired") return "Abgelaufen";
  if (validity.state === "soon") {
    const h = Math.floor(validity.hoursLeft);
    return h < 1 ? "unter 1 Std." : `noch ${h} Std.`;
  }
  const days = Math.floor(validity.hoursLeft / 24);
  return `noch ${days} ${days === 1 ? "Tag" : "Tage"}`;
}

/**
 * Fingerprint of everything the rendered e-mail depends on beyond the prose.
 * The mail column re-renders its preview whenever it changes, so a new
 * KI-Hero, a swapped product, an attached Set, a changed Rabatt or a switched
 * language shows up at once — without a browser reload. `previewVersion` is
 * the desk's client-only nudge for changes the fields cannot express (a
 * regenerate that produced the same text, a hero replaced under the same URL).
 * @param {{
 *   subject: string, body: string, language?: string | null,
 *   discountPercent?: number, discountExpiresAt?: string | null,
 *   recommendations?: Array<{ id: string }>,
 *   bundle?: { id: number, bundlePrice?: string, expiresAt?: string | null } | null,
 *   heroUrl?: string | null, heroHeadline?: string | null,
 *   draftUpdatedAt?: string | null, previewVersion?: number
 * }} item
 * @returns {string}
 */
export function previewSignature(item) {
  return JSON.stringify([
    item.subject,
    item.body,
    item.language ?? null,
    item.discountPercent ?? 0,
    item.discountExpiresAt ?? null,
    (item.recommendations ?? []).map((r) => r.id),
    item.bundle ? [item.bundle.id, item.bundle.bundlePrice ?? null, item.bundle.expiresAt ?? null] : null,
    item.heroUrl ?? null,
    item.heroHeadline ?? null,
    item.draftUpdatedAt ?? null,
    item.previewVersion ?? 0,
  ]);
}
