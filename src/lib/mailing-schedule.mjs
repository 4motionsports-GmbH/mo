// Rundmail — the schedule (pure, tested: mailing-schedule.test.mjs). The I/O
// is mailing-send.ts (release, runner) and mailing-store.ts; the behaviour
// docs/CAMPAIGNS.md §9.
//
//   * Duration — how long a send takes at its pace. Measured on the runner:
//     about 80 % of the tempo label (the per-minute cron uses ~47 of its 60
//     seconds, plus the Resend round trips), so „Normal“ (300) sends ≈ 240
//     per minute.
//   * Start — when „Planen“ may start (not in the past, at most 60 days
//     ahead, before the campaign's end).
//   * State — what a released Rundmail is doing (geplant, startet, Start
//     überfällig, läuft, pausiert, fertig): ONE rule for the workspace header,
//     the Versand tab and the Kampagnen card.
//   * Refresh at the start — a Rundmail planned ahead is rendered again from
//     the SAME content version with the CURRENT catalog (prices,
//     availability; sold-out products drop out) when its first step runs,
//     before the audience is matched — nothing has been sent, so the link
//     table may be rebuilt. The marker is the release time itself: frozen_at
//     clearly before starts_at = not refreshed yet; the refresh sets
//     frozen_at to the moment it ran (≥ starts_at). A refresh that fails or
//     whose render fails a hard release check keeps the release version
//     with a note; it never blocks the send.

/** Real speed of the runner as a share of the tempo label (measured). */
export const MAILING_REAL_RATE_FACTOR = 0.8;

/** „Planen“: at most this many days ahead. */
export const MAILING_PLAN_MAX_DAYS = 60;

/**
 * A planned start up to this far in the past is taken as „now“ (clocks of
 * browser and server differ a little); anything older is refused — a typo
 * in the date must never send at once.
 */
export const MAILING_PLAN_PAST_TOLERANCE_MS = 5 * 60_000;

/** The cron runs every minute: a start not begun after this is overdue. */
export const MAILING_START_GRACE_MS = 3 * 60_000;

/**
 * The refresh at the start is due only when the start lies at least this far
 * after the release — „Jetzt senden“ freezes and starts in the same moment.
 */
export const MAILING_REFRESH_MIN_LEAD_MS = 60_000;

const ms = (v) => {
  if (v === null || v === undefined || v === "") return NaN;
  return v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(String(v));
};

// ── duration ─────────────────────────────────────────────────────────────────

/**
 * Mails per minute the runner really sends at a tempo label.
 * @param {number} perMinute  the label (MAILING_RATES)
 */
export function realMailingRate(perMinute) {
  const label = Number.isFinite(perMinute) && perMinute > 0 ? perMinute : 1;
  return Math.max(1, Math.round(label * MAILING_REAL_RATE_FACTOR));
}

/**
 * Minutes a send to `recipients` takes at a tempo label (rounded up; 0 for
 * nobody).
 * @param {number} recipients
 * @param {number} perMinute  the label
 */
export function mailingDurationMinutes(recipients, perMinute) {
  const n = Number.isFinite(recipients) ? Math.max(0, Math.floor(recipients)) : 0;
  if (n === 0) return 0;
  return Math.max(1, Math.ceil(n / realMailingRate(perMinute)));
}

/**
 * „etwa 45 Min.“, „etwa 1 Std. 20 Min.“, „etwa 2 Std.“, „etwa 1 Tag 3 Std.“.
 * @param {number} minutes
 */
export function formatMailingDuration(minutes) {
  const m = Number.isFinite(minutes) ? Math.max(0, Math.ceil(minutes)) : 0;
  if (m < 60) return `etwa ${Math.max(1, m)} Min.`;
  if (m < 24 * 60) {
    // Above two hours the minutes are noise — round to the quarter hour.
    const h = Math.floor(m / 60);
    const rest = m - h * 60;
    if (h >= 2) {
      const q = Math.round(rest / 15) * 15;
      if (q === 60) return `etwa ${h + 1} Std.`;
      return q === 0 ? `etwa ${h} Std.` : `etwa ${h} Std. ${q} Min.`;
    }
    return rest === 0 ? `etwa ${h} Std.` : `etwa ${h} Std. ${rest} Min.`;
  }
  const d = Math.floor(m / (24 * 60));
  const h = Math.round((m - d * 24 * 60) / 60);
  const days = `${d} ${d === 1 ? "Tag" : "Tage"}`;
  return h === 0 ? `etwa ${days}` : h === 24 ? `etwa ${d + 1} Tage` : `etwa ${days} ${h} Std.`;
}

// ── start ────────────────────────────────────────────────────────────────────

/**
 * The start of a release. Empty = now („Jetzt senden“); a planned start must
 * be a real instant, not in the past (beyond a small tolerance, which counts
 * as now), at most MAILING_PLAN_MAX_DAYS ahead and before the campaign's
 * end.
 * @param {unknown} input  ISO instant or empty
 * @param {{ now?: number | Date, endsAt?: string | null }} [opts]
 * @returns {{ ok: true, startsAt: string, planned: boolean } | { ok: false, message: string }}
 */
export function validateMailingStart(input, opts = {}) {
  const now = Number.isFinite(ms(opts.now)) ? ms(opts.now) : Date.now();
  if (input === null || input === undefined || input === "") {
    return { ok: true, startsAt: new Date(now).toISOString(), planned: false };
  }
  const t = ms(input);
  if (!Number.isFinite(t)) return { ok: false, message: "Ungültiger Zeitpunkt." };
  if (t < now - MAILING_PLAN_PAST_TOLERANCE_MS) {
    return { ok: false, message: "Der geplante Start liegt in der Vergangenheit — bitte einen späteren Zeitpunkt wählen." };
  }
  if (t > now + MAILING_PLAN_MAX_DAYS * 86_400_000) {
    return { ok: false, message: `Höchstens ${MAILING_PLAN_MAX_DAYS} Tage im Voraus planen.` };
  }
  const end = ms(opts.endsAt);
  if (Number.isFinite(end) && t >= end) {
    return { ok: false, message: "Der Versand-Start liegt nach dem Ende der Kampagne („Versand spätestens bis“)." };
  }
  return { ok: true, startsAt: new Date(Math.max(t, now)).toISOString(), planned: t > now };
}

// ── state ────────────────────────────────────────────────────────────────────

/**
 * @typedef {"entwurf" | "geplant" | "startet" | "ueberfaellig" | "laeuft" | "pausiert" | "fertig" | "beendet"} MailingScheduleKind
 */

/**
 * What a Rundmail is doing right now.
 *   entwurf       not released
 *   geplant       released, the start lies ahead (untilMs: how long)
 *   startet       the start has come, the first step has not run yet
 *   ueberfaellig  … for longer than MAILING_START_GRACE_MS — the runner did
 *                 not start it (cron down, an error) — the operator must look
 *   laeuft        sending
 *   pausiert      paused (by the operator or by an error the runner hit)
 *   fertig        nothing left to send
 *   beendet       cancelled / ended / archived
 * @param {{
 *   status: string,
 *   frozen: boolean,
 *   startsAt: string | null | undefined,
 *   started: boolean,
 *   finished: boolean,
 *   now?: number | Date,
 * }} input  `started`: the first step ran (audience matched) or a mail went out
 * @returns {{ kind: MailingScheduleKind, untilMs: number | null, overdueMs: number | null }}
 */
export function mailingScheduleState(input) {
  const now = Number.isFinite(ms(input.now)) ? ms(input.now) : Date.now();
  const start = ms(input.startsAt);
  const none = { untilMs: null, overdueMs: null };
  if (input.status === "entwurf" || !input.frozen) return { kind: "entwurf", ...none };
  if (input.finished) return { kind: "fertig", ...none };
  if (input.status === "beendet" || input.status === "archiviert") return { kind: "beendet", ...none };
  if (input.status === "pausiert") return { kind: "pausiert", ...none };
  if (input.status !== "aktiv") return { kind: "beendet", ...none };
  if (Number.isFinite(start) && start > now) return { kind: "geplant", untilMs: start - now, overdueMs: null };
  if (input.started) return { kind: "laeuft", ...none };
  const overdue = Number.isFinite(start) ? now - start : 0;
  return overdue > MAILING_START_GRACE_MS
    ? { kind: "ueberfaellig", untilMs: null, overdueMs: overdue }
    : { kind: "startet", untilMs: null, overdueMs: null };
}

/**
 * Before the first batch a planned release can be taken back („Planung
 * zurücknehmen“; the store refuses once any recipient was claimed).
 * @param {{ kind: MailingScheduleKind }} state
 * @param {number} sent
 */
export function mailingCanUnschedule(state, sent) {
  return (state.kind === "geplant" || state.kind === "startet" || state.kind === "ueberfaellig") && !(sent > 0);
}

// ── refresh at the start ─────────────────────────────────────────────────────

/**
 * Is the refresh of the frozen content due now? Only at the first step (the
 * audience not matched yet, nothing sent) of a Rundmail whose start lies at
 * least MAILING_REFRESH_MIN_LEAD_MS after its release — i.e. one that was
 * planned. After the refresh frozen_at is the moment it ran (≥ the start),
 * so it is never due twice.
 * @param {{ frozenAt: string | null | undefined, startsAt: string | null | undefined, materializedAt: string | null | undefined, finishedAt: string | null | undefined }} m
 */
export function mailingRefreshDue(m) {
  if (!m || m.materializedAt || m.finishedAt) return false;
  const frozen = ms(m.frozenAt);
  const start = ms(m.startsAt);
  if (!Number.isFinite(frozen) || !Number.isFinite(start)) return false;
  return start - frozen >= MAILING_REFRESH_MIN_LEAD_MS;
}

/**
 * @typedef {"aktualisiert" | "unveraendert" | "behalten"} MailingRefreshOutcome
 */

/**
 * What to do with the content rendered again at the start.
 *
 * Keep the release version (with a German note) when
 *   * the render failed (`renderFailed`),
 *   * the catalog could not be read (`productsShown` null),
 *   * the new render fails a hard release check (`problems`),
 *   * the content names products but the catalog can show none of them now
 *     — sold out every one, or a catalog that came back empty: a Black Week
 *     mail must not go out without its products because of an outage.
 * Otherwise take the new render: „unveraendert“ when it is byte-identical,
 * else „aktualisiert“ (the note names what is no longer available).
 *
 * @param {{
 *   renderFailed?: boolean,
 *   problems?: string[],
 *   productRefs?: number,
 *   productsShown?: number | null,
 *   same?: boolean,
 *   soldOut?: string[],
 *   unknown?: string[],
 * }} r
 * @returns {{ action: "replace" | "keep", outcome: MailingRefreshOutcome, note: string }}
 */
export function decideMailingRefresh(r) {
  const keep = (why) => ({
    action: /** @type {const} */ ("keep"),
    outcome: /** @type {const} */ ("behalten"),
    note: `${why} Gesendet wird der Inhalt der Freigabe (Preise und Verfügbarkeit vom Zeitpunkt der Freigabe).`,
  });
  if (r.renderFailed) return keep("Die Mail konnte beim Versandstart nicht neu erstellt werden.");
  if (r.productsShown === null) return keep("Der Produktkatalog war beim Versandstart nicht lesbar.");
  const problems = (r.problems ?? []).filter(Boolean);
  if (problems.length > 0) {
    return keep(`Die beim Versandstart neu erstellte Mail besteht die Prüfung nicht: ${problems.join(" ")}`);
  }
  const refs = Math.max(0, Number(r.productRefs) || 0);
  const shown = Math.max(0, Number(r.productsShown) || 0);
  if (refs > 0 && shown === 0) {
    return keep(
      refs === 1
        ? "Beim Versandstart war das Produkt der Mail nicht lieferbar (oder der Katalog leer)."
        : "Beim Versandstart war keins der Produkte der Mail lieferbar (oder der Katalog leer)."
    );
  }
  if (r.same) {
    return { action: "replace", outcome: "unveraendert", note: "Preise und Verfügbarkeit beim Versandstart geprüft — unverändert." };
  }
  const missing = [
    ...(r.soldOut ?? []).map((n) => `${n} (ausverkauft)`),
    ...(r.unknown ?? []).map((n) => `${n} (nicht mehr im Katalog)`),
  ];
  return {
    action: "replace",
    outcome: "aktualisiert",
    note: `Preise und Verfügbarkeit beim Versandstart aktualisiert.${missing.length ? ` Nicht in der Mail: ${missing.join(", ")}.` : ""}`,
  };
}

/**
 * The stored note of a refresh (campaign_mailings.merges.refresh), or null.
 * @param {unknown} v
 * @returns {{ at: string, releasedAt: string | null, outcome: MailingRefreshOutcome, note: string } | null}
 */
export function parseMailingRefresh(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = /** @type {Record<string, unknown>} */ (v);
  const outcome = o.outcome === "aktualisiert" || o.outcome === "unveraendert" || o.outcome === "behalten" ? o.outcome : null;
  const at = typeof o.at === "string" && Number.isFinite(Date.parse(o.at)) ? new Date(o.at).toISOString() : null;
  if (!outcome || !at) return null;
  const released = typeof o.releasedAt === "string" && Number.isFinite(Date.parse(o.releasedAt)) ? new Date(o.releasedAt).toISOString() : null;
  return { at, releasedAt: released, outcome, note: typeof o.note === "string" ? o.note.slice(0, 2000) : "" };
}
