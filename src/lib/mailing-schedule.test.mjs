import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAILING_PLAN_MAX_DAYS,
  MAILING_REFRESH_MIN_LEAD_MS,
  MAILING_START_GRACE_MS,
  decideMailingRefresh,
  formatMailingDuration,
  mailingCanUnschedule,
  mailingDurationMinutes,
  mailingRefreshDue,
  mailingScheduleState,
  parseMailingRefresh,
  realMailingRate,
  validateMailingStart,
} from "./mailing-schedule.mjs";
import { MAILING_RATES } from "./mailing-core.mjs";

const NOW = Date.parse("2026-11-27T07:00:00.000Z"); // Fr., 08:00 Berlin

test("the real speed is about 80 % of the tempo label", () => {
  assert.equal(realMailingRate(MAILING_RATES.normal), 240);
  assert.equal(realMailingRate(MAILING_RATES.behutsam), 48);
  assert.equal(realMailingRate(MAILING_RATES.schnell), 800);
  assert.equal(realMailingRate(0), 1);
  assert.equal(realMailingRate(Number.NaN), 1);
});

test("the duration is counted at the real speed, rounded up", () => {
  assert.equal(mailingDurationMinutes(0, 300), 0);
  assert.equal(mailingDurationMinutes(1, 300), 1);
  assert.equal(mailingDurationMinutes(240, 300), 1);
  assert.equal(mailingDurationMinutes(241, 300), 2);
  // 12,000 recipients at „Normal“: 50 minutes, not the 40 the label suggests
  assert.equal(mailingDurationMinutes(12_000, 300), 50);
  assert.equal(mailingDurationMinutes(-5, 300), 0);
});

test("durations read in German", () => {
  assert.equal(formatMailingDuration(0), "etwa 1 Min.");
  assert.equal(formatMailingDuration(45), "etwa 45 Min.");
  assert.equal(formatMailingDuration(60), "etwa 1 Std.");
  assert.equal(formatMailingDuration(80), "etwa 1 Std. 20 Min.");
  assert.equal(formatMailingDuration(127), "etwa 2 Std.");
  assert.equal(formatMailingDuration(140), "etwa 2 Std. 15 Min.");
  assert.equal(formatMailingDuration(178), "etwa 3 Std.");
  assert.equal(formatMailingDuration(24 * 60), "etwa 1 Tag");
  assert.equal(formatMailingDuration(27 * 60), "etwa 1 Tag 3 Std.");
  assert.equal(formatMailingDuration(50 * 60), "etwa 2 Tage 2 Std.");
});

test("„Jetzt“ starts now; a planned start is checked", () => {
  const now = validateMailingStart(null, { now: NOW });
  assert.deepEqual(now, { ok: true, startsAt: new Date(NOW).toISOString(), planned: false });
  assert.equal(validateMailingStart("", { now: NOW }).ok, true);

  const later = validateMailingStart("2026-11-28T07:00:00.000Z", { now: NOW });
  assert.deepEqual(later, { ok: true, startsAt: "2026-11-28T07:00:00.000Z", planned: true });

  assert.deepEqual(validateMailingStart("morgen", { now: NOW }), { ok: false, message: "Ungültiger Zeitpunkt." });
  // a typo in the date must never send at once
  const past = validateMailingStart("2026-11-20T07:00:00.000Z", { now: NOW });
  assert.equal(past.ok, false);
  assert.match(past.message, /Vergangenheit/);
  // a minute behind (clock difference) counts as now
  const skew = validateMailingStart(new Date(NOW - 60_000).toISOString(), { now: NOW });
  assert.deepEqual(skew, { ok: true, startsAt: new Date(NOW).toISOString(), planned: false });

  const far = validateMailingStart(new Date(NOW + (MAILING_PLAN_MAX_DAYS + 1) * 86_400_000).toISOString(), { now: NOW });
  assert.equal(far.ok, false);
  assert.match(far.message, /60 Tage/);

  const afterEnd = validateMailingStart("2026-12-01T07:00:00.000Z", { now: NOW, endsAt: "2026-11-30T23:00:00.000Z" });
  assert.equal(afterEnd.ok, false);
  assert.match(afterEnd.message, /Ende der Kampagne/);
  assert.equal(validateMailingStart("2026-11-29T07:00:00.000Z", { now: NOW, endsAt: "2026-11-30T23:00:00.000Z" }).ok, true);
});

test("the state of a released Rundmail, one rule everywhere", () => {
  const base = { status: "aktiv", frozen: true, started: false, finished: false, now: NOW };
  assert.equal(mailingScheduleState({ ...base, status: "entwurf", frozen: false, startsAt: null }).kind, "entwurf");

  const planned = mailingScheduleState({ ...base, startsAt: "2026-11-28T07:00:00.000Z" });
  assert.equal(planned.kind, "geplant");
  assert.equal(planned.untilMs, 24 * 3_600_000);

  assert.equal(mailingScheduleState({ ...base, startsAt: new Date(NOW - 30_000).toISOString() }).kind, "startet");
  const overdue = mailingScheduleState({ ...base, startsAt: new Date(NOW - MAILING_START_GRACE_MS - 1000).toISOString() });
  assert.equal(overdue.kind, "ueberfaellig");
  assert.equal(overdue.overdueMs, MAILING_START_GRACE_MS + 1000);

  assert.equal(mailingScheduleState({ ...base, startsAt: new Date(NOW - 3_600_000).toISOString(), started: true }).kind, "laeuft");
  assert.equal(mailingScheduleState({ ...base, startsAt: null, started: true }).kind, "laeuft");
  assert.equal(mailingScheduleState({ ...base, status: "pausiert", startsAt: "2026-11-28T07:00:00.000Z" }).kind, "pausiert");
  assert.equal(mailingScheduleState({ ...base, status: "beendet", startsAt: null, finished: true }).kind, "fertig");
  assert.equal(mailingScheduleState({ ...base, status: "beendet", startsAt: null }).kind, "beendet");
});

test("„Planung zurücknehmen“ until the first mail", () => {
  const at = (kind) => ({ kind });
  assert.equal(mailingCanUnschedule(at("geplant"), 0), true);
  assert.equal(mailingCanUnschedule(at("startet"), 0), true);
  assert.equal(mailingCanUnschedule(at("ueberfaellig"), 0), true);
  assert.equal(mailingCanUnschedule(at("geplant"), 1), false);
  assert.equal(mailingCanUnschedule(at("laeuft"), 0), false);
  assert.equal(mailingCanUnschedule(at("pausiert"), 0), false);
});

test("the refresh at the start is due only for a planned release, once", () => {
  const released = "2026-11-26T16:00:00.000Z";
  const start = "2026-11-27T07:00:00.000Z";
  assert.equal(mailingRefreshDue({ frozenAt: released, startsAt: start, materializedAt: null, finishedAt: null }), true);
  // „Jetzt senden“: frozen and started in the same moment
  assert.equal(mailingRefreshDue({ frozenAt: start, startsAt: start, materializedAt: null, finishedAt: null }), false);
  assert.equal(
    mailingRefreshDue({ frozenAt: new Date(Date.parse(start) - MAILING_REFRESH_MIN_LEAD_MS + 1).toISOString(), startsAt: start, materializedAt: null, finishedAt: null }),
    false
  );
  // after the refresh frozen_at is the moment it ran (≥ the start)
  assert.equal(mailingRefreshDue({ frozenAt: "2026-11-27T07:00:20.000Z", startsAt: start, materializedAt: null, finishedAt: null }), false);
  // the audience is matched: something may be sent — never again
  assert.equal(mailingRefreshDue({ frozenAt: released, startsAt: start, materializedAt: "2026-11-27T07:00:30.000Z", finishedAt: null }), false);
  assert.equal(mailingRefreshDue({ frozenAt: released, startsAt: start, materializedAt: null, finishedAt: "2026-11-27T08:00:00.000Z" }), false);
  assert.equal(mailingRefreshDue({ frozenAt: null, startsAt: start, materializedAt: null, finishedAt: null }), false);
  assert.equal(mailingRefreshDue({ frozenAt: released, startsAt: null, materializedAt: null, finishedAt: null }), false);
  assert.equal(mailingRefreshDue(null), false);
});

test("a good new render replaces the release; the note names what dropped out", () => {
  const changed = decideMailingRefresh({ problems: [], productRefs: 3, productsShown: 2, same: false, soldOut: ["ATX Hantelbank"], unknown: [] });
  assert.equal(changed.action, "replace");
  assert.equal(changed.outcome, "aktualisiert");
  assert.equal(changed.note, "Preise und Verfügbarkeit beim Versandstart aktualisiert. Nicht in der Mail: ATX Hantelbank (ausverkauft).");

  const plain = decideMailingRefresh({ problems: [], productRefs: 0, productsShown: 0, same: false });
  assert.deepEqual(plain, { action: "replace", outcome: "aktualisiert", note: "Preise und Verfügbarkeit beim Versandstart aktualisiert." });

  const same = decideMailingRefresh({ problems: [], productRefs: 2, productsShown: 2, same: true });
  assert.equal(same.action, "replace");
  assert.equal(same.outcome, "unveraendert");
});

test("anything wrong keeps the release version — with a German note, never a block", () => {
  const failed = decideMailingRefresh({ renderFailed: true });
  assert.equal(failed.action, "keep");
  assert.equal(failed.outcome, "behalten");
  assert.match(failed.note, /nicht neu erstellt.*Gesendet wird der Inhalt der Freigabe/);

  const catalog = decideMailingRefresh({ problems: [], productRefs: 2, productsShown: null });
  assert.equal(catalog.action, "keep");
  assert.match(catalog.note, /Produktkatalog war beim Versandstart nicht lesbar/);

  const big = decideMailingRefresh({ problems: ["Die Mail ist 104 KB groß."], productRefs: 1, productsShown: 1 });
  assert.equal(big.action, "keep");
  assert.match(big.note, /besteht die Prüfung nicht: Die Mail ist 104 KB groß\./);

  // every product gone at once: sold out or a catalog outage — never a Black Week mail without its products
  const none = decideMailingRefresh({ problems: [], productRefs: 4, productsShown: 0, soldOut: ["A", "B", "C", "D"] });
  assert.equal(none.action, "keep");
  assert.match(none.note, /keins der Produkte/);
  assert.match(decideMailingRefresh({ problems: [], productRefs: 1, productsShown: 0 }).note, /das Produkt der Mail/);
});

test("the stored refresh note is read defensively", () => {
  assert.equal(parseMailingRefresh(null), null);
  assert.equal(parseMailingRefresh([]), null);
  assert.equal(parseMailingRefresh({ outcome: "kaputt", at: "2026-11-27T07:00:00.000Z" }), null);
  assert.equal(parseMailingRefresh({ outcome: "aktualisiert", at: "nie" }), null);
  assert.deepEqual(
    parseMailingRefresh({ outcome: "behalten", at: "2026-11-27T07:00:00Z", releasedAt: "2026-11-26T16:00:00Z", note: "x" }),
    { at: "2026-11-27T07:00:00.000Z", releasedAt: "2026-11-26T16:00:00.000Z", outcome: "behalten", note: "x" }
  );
  assert.deepEqual(parseMailingRefresh({ outcome: "unveraendert", at: "2026-11-27T07:00:00Z" }), {
    at: "2026-11-27T07:00:00.000Z",
    releasedAt: null,
    outcome: "unveraendert",
    note: "",
  });
});
