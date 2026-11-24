import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAMPAIGN_END_MIN_LEAD_MINUTES,
  campaignEndChange,
  campaignEndSuggestions,
  mailingEndOutlook,
  validateCampaignEnd,
} from "./campaign-end.mjs";

// 24.11.2026, 14:00 in Berlin (13:00 UTC) — the afternoon after the Rundmail stopped at 11:50.
const NOW = Date.parse("2026-11-24T13:00:00Z");
const PAST = "2026-11-24T10:50:00.000Z"; // 11:50 Berlin
const FUTURE = "2026-11-30T22:59:00.000Z"; // 30.11. 23:59 Berlin

test("campaignEndChange: the Rundmail of 24.11. — still „aktiv“, its end passed → change, expired", () => {
  assert.deepEqual(campaignEndChange({ kind: "rundmail", status: "aktiv", endsAt: PAST, finished: false }, { now: NOW }), {
    ok: true,
    mode: "change",
    expired: true,
  });
});

test("campaignEndChange: after the nightly job („beendet“, send not finished) → resume", () => {
  assert.deepEqual(campaignEndChange({ kind: "rundmail", status: "beendet", endsAt: PAST, endedAt: "2026-11-25T02:30:00Z", finished: false }, { now: NOW }), {
    ok: true,
    mode: "resume",
    expired: true,
  });
});

test("campaignEndChange: a Rundmail whose send is finished or cancelled cannot be changed", () => {
  for (const status of ["beendet", "aktiv"]) {
    const r = campaignEndChange({ kind: "rundmail", status, endsAt: PAST, finished: true }, { now: NOW });
    assert.equal(r.ok, false);
    assert.match(r.message, /abgeschlossen/);
  }
});

test("campaignEndChange: running, planned, paused and draft campaigns only change the date", () => {
  for (const status of ["aktiv", "pausiert", "entwurf"]) {
    for (const kind of ["rundmail", "aktion", "laufend"]) {
      const r = campaignEndChange({ kind, status, endsAt: FUTURE, finished: false }, { now: NOW });
      assert.deepEqual(r, { ok: true, mode: "change", expired: false }, `${kind} ${status}`);
    }
  }
  // no end yet
  assert.deepEqual(campaignEndChange({ kind: "aktion", status: "aktiv", endsAt: null }, { now: NOW }), { ok: true, mode: "change", expired: false });
  // a paused campaign past its end
  assert.deepEqual(campaignEndChange({ kind: "aktion", status: "pausiert", endsAt: PAST }, { now: NOW }), { ok: true, mode: "change", expired: true });
});

test("campaignEndChange: other kinds resume only when their end ended them, never after „Beenden“ by hand", () => {
  // ended by the nightly job after its end
  assert.deepEqual(campaignEndChange({ kind: "aktion", status: "beendet", endsAt: PAST, endedAt: "2026-11-25T02:30:00Z" }, { now: NOW }), {
    ok: true,
    mode: "resume",
    expired: true,
  });
  // „Beenden“ after the end had passed counts as ended by the date too
  assert.equal(campaignEndChange({ kind: "laufend", status: "beendet", endsAt: PAST, endedAt: "2026-11-24T12:00:00Z" }, { now: NOW }).ok, true);
  // ended by hand before its end
  const manual = campaignEndChange({ kind: "aktion", status: "beendet", endsAt: FUTURE, endedAt: "2026-11-20T09:00:00Z" }, { now: NOW });
  assert.equal(manual.ok, false);
  assert.match(manual.message, /von Hand beendet.*„Wieder aufnehmen“/);
  // ended by hand without any end
  assert.equal(campaignEndChange({ kind: "aktion", status: "beendet", endsAt: null, endedAt: "2026-11-20T09:00:00Z" }, { now: NOW }).ok, false);
});

test("campaignEndChange: Einzelansprache and archived campaigns are refused", () => {
  assert.deepEqual(campaignEndChange({ kind: "einzel", status: "aktiv" }, { now: NOW }), { ok: false, message: "Die Einzelansprache hat kein Ende." });
  const archived = campaignEndChange({ kind: "rundmail", status: "archiviert", endsAt: PAST, finished: false }, { now: NOW });
  assert.equal(archived.ok, false);
  assert.match(archived.message, /archivierte/);
});

test("validateCampaignEnd: none, at least 15 minutes ahead, after a planned start, at most a year", () => {
  assert.deepEqual(validateCampaignEnd(null, { now: NOW }), { ok: true, endsAt: null });
  assert.deepEqual(validateCampaignEnd("", { now: NOW }), { ok: true, endsAt: null });
  assert.deepEqual(validateCampaignEnd(FUTURE, { now: NOW }), { ok: true, endsAt: FUTURE });
  // the past and a few minutes ahead are refused
  assert.equal(validateCampaignEnd(PAST, { now: NOW }).ok, false);
  const soon = validateCampaignEnd(new Date(NOW + 5 * 60_000).toISOString(), { now: NOW });
  assert.deepEqual(soon, { ok: false, message: `Das neue Ende muss mindestens ${CAMPAIGN_END_MIN_LEAD_MINUTES} Minuten in der Zukunft liegen.` });
  assert.equal(validateCampaignEnd(new Date(NOW + 15 * 60_000).toISOString(), { now: NOW }).ok, true);
  // a typo far ahead
  assert.deepEqual(validateCampaignEnd("2062-11-30T22:59:00.000Z", { now: NOW }), { ok: false, message: "Höchstens ein Jahr im Voraus." });
  // a planned start that is still ahead
  assert.deepEqual(validateCampaignEnd("2026-11-27T08:00:00.000Z", { now: NOW, startsAt: "2026-11-28T08:00:00.000Z" }), {
    ok: false,
    message: "Das Ende muss nach dem geplanten Start liegen.",
  });
  // a start in the past does not matter
  assert.equal(validateCampaignEnd(FUTURE, { now: NOW, startsAt: "2026-11-24T08:00:00.000Z" }).ok, true);
  // garbage
  assert.deepEqual(validateCampaignEnd("morgen", { now: NOW }), { ok: false, message: "Ungültiger Zeitpunkt." });
  assert.deepEqual(validateCampaignEnd(12345, { now: NOW }), { ok: false, message: "Ungültiger Zeitpunkt." });
});

test("campaignEndSuggestions: today 23:59 while far enough ahead, tomorrow, in seven days — Berlin days", () => {
  assert.deepEqual(campaignEndSuggestions({ now: NOW }), [
    { key: "heute", label: "Heute 23:59", value: "2026-11-24T23:59" },
    { key: "morgen", label: "Morgen 23:59", value: "2026-11-25T23:59" },
    { key: "woche", label: "In 7 Tagen", value: "2026-12-01T23:59" },
  ]);
  // 23:50 in Berlin: today is too close
  const late = campaignEndSuggestions({ now: Date.parse("2026-11-24T22:50:00Z") });
  assert.deepEqual(late.map((s) => s.key), ["morgen", "woche"]);
  assert.equal(late[0].value, "2026-11-25T23:59");
  // 00:30 in Berlin is already the next Berlin day (23:30 UTC the day before)
  assert.equal(campaignEndSuggestions({ now: Date.parse("2026-11-24T23:30:00Z") })[0].value, "2026-11-25T23:59");
  // across a month end and the summer-time switch
  assert.equal(campaignEndSuggestions({ now: Date.parse("2027-03-27T10:00:00Z") })[2].value, "2027-04-03T23:59");
  // every suggestion passes the check
  for (const s of campaignEndSuggestions({ now: NOW })) {
    const iso = new Date(`${s.value}:00+01:00`).toISOString();
    assert.equal(validateCampaignEnd(iso, { now: NOW }).ok, true, s.key);
  }
});

test("mailingEndOutlook: 2,065 recipients at „Normal“ fit before 30.11., not before 14:05", () => {
  const ok = mailingEndOutlook({ open: 2065, perMinute: 300, endsAt: FUTURE, now: NOW });
  assert.equal(ok.fits, true);
  assert.equal(ok.minutes, 9);
  assert.equal(ok.label, "etwa 9 Min.");
  const tight = mailingEndOutlook({ open: 2065, perMinute: 60, endsAt: new Date(NOW + 20 * 60_000).toISOString(), now: NOW });
  assert.equal(tight.fits, false);
  assert.equal(tight.label, "etwa 44 Min.");
  // a planned start counts from the start
  const planned = mailingEndOutlook({ open: 2065, perMinute: 300, startsAt: new Date(NOW + 60 * 60_000).toISOString(), endsAt: new Date(NOW + 65 * 60_000).toISOString(), now: NOW });
  assert.equal(planned.fits, false);
  // no end, nobody waiting
  assert.equal(mailingEndOutlook({ open: 2065, perMinute: 300, endsAt: null, now: NOW }).fits, true);
  assert.deepEqual(mailingEndOutlook({ open: 0, perMinute: 300, endsAt: PAST, now: NOW }), { minutes: 0, label: "etwa 1 Min.", fits: true });
});
