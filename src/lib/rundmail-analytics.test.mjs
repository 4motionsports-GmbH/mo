import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYTICS_URL_KEYS,
  CSV_BOM,
  DEFAULT_RUNDMAIL_WINDOW,
  RECIPIENT_CSV_HEADERS,
  activityGranularity,
  analyticsUrlEntries,
  attributeOrder,
  attributeRecipientOrders,
  bucketLabel,
  bucketTick,
  buildActivitySeries,
  buildSendSeries,
  berlinDay,
  clickedBeforeOrder,
  csvCell,
  csvDateTime,
  csvEuro,
  csvLine,
  dayRange,
  inRundmailWindow,
  lastRundmailTouch,
  likePattern,
  linkDisplay,
  notSentReasonLabel,
  orderNetCents,
  orderUsedCode,
  parseNotSentReason,
  parsePositiveId,
  parseRecipientFilter,
  parseRecipientPage,
  parseRecipientQuery,
  parseRecipientSort,
  parseRundmailWindow,
  readAnalyticsUrlState,
  recipientCsvCells,
  recipientCsvFilename,
  recipientName,
  recipientState,
  recipientTimeline,
  rundmailCouponCodes,
  rundmailRates,
  rundmailWindowDays,
  rundmailWindowHours,
  rundmailWindowLabel,
  sendStepMinutes,
  summarizeAttributed,
} from "./rundmail-analytics.mjs";
import { normalizeMailTemplateDoc } from "./mail-template-doc.mjs";

const H = 3_600_000;
const D = 24 * H;
const plus = (iso, msDelta) => new Date(Date.parse(iso) + msDelta).toISOString();

// ── windows ──────────────────────────────────────────────────────────────────

test("windows: 1, 3, 7 (default), 14 days and „bis heute“; unknown values fall back to 7", () => {
  assert.equal(DEFAULT_RUNDMAIL_WINDOW, "7");
  assert.equal(parseRundmailWindow("14"), "14");
  assert.equal(parseRundmailWindow("heute"), "heute");
  assert.equal(parseRundmailWindow(["3", "7"]), "3");
  assert.equal(parseRundmailWindow("30"), "7");
  assert.equal(parseRundmailWindow(undefined), "7");
  assert.equal(rundmailWindowDays("1"), 1);
  assert.equal(rundmailWindowDays("heute"), null);
  assert.equal(rundmailWindowDays("nonsense"), 7);
  assert.equal(rundmailWindowHours("3"), 72);
  assert.equal(rundmailWindowHours("heute"), null);
  assert.equal(rundmailWindowLabel("1"), "1 Tag");
  assert.equal(rundmailWindowLabel("heute"), "bis heute");
});

// ── the rule ─────────────────────────────────────────────────────────────────

const SENT = "2026-11-27T08:00:00Z";

test("window: strictly after the send, up to and including send + window; „bis heute“ has no end", () => {
  assert.equal(inRundmailWindow(SENT, SENT, 7), false, "the same instant is not after the send");
  assert.equal(inRundmailWindow(plus(SENT, -1000), SENT, 7), false);
  assert.equal(inRundmailWindow(plus(SENT, 1000), SENT, 7), true);
  assert.equal(inRundmailWindow(plus(SENT, 7 * D), SENT, 7), true, "the last instant of the window counts");
  assert.equal(inRundmailWindow(plus(SENT, 7 * D + 1000), SENT, 7), false);
  assert.equal(inRundmailWindow(plus(SENT, 1 * D + 1000), SENT, 1), false);
  assert.equal(inRundmailWindow(plus(SENT, 400 * D), SENT, null), true);
  assert.equal(inRundmailWindow(null, SENT, null), false);
});

test("last touch: the latest Rundmail sent before the order; the same instant → the higher send id", () => {
  const sends = [
    { id: 10, sentAt: "2026-11-20T08:00:00Z" },
    { id: 11, sentAt: "2026-11-27T08:00:00Z" },
    { id: 12, sentAt: "2026-12-01T08:00:00Z" },
  ];
  assert.equal(lastRundmailTouch("2026-11-28T10:00:00Z", sends)?.id, 11);
  assert.equal(lastRundmailTouch("2026-11-21T10:00:00Z", sends)?.id, 10);
  assert.equal(lastRundmailTouch("2026-12-05T10:00:00Z", sends)?.id, 12);
  assert.equal(lastRundmailTouch("2026-11-01T10:00:00Z", sends), null, "nothing before the order");
  const tie = [
    { id: 21, sentAt: SENT },
    { id: 20, sentAt: SENT },
  ];
  assert.equal(lastRundmailTouch(plus(SENT, H), tie)?.id, 21);
  assert.equal(lastRundmailTouch(plus(SENT, H), [...tie].reverse())?.id, 21);
});

test("attributeOrder: counts only uncancelled orders after the send, in the window, with no later Rundmail between", () => {
  const send = { id: 1, sentAt: SENT };
  const order = (offset, extra = {}) => ({ processedAt: plus(SENT, offset), cancelledAt: null, ...extra });

  assert.deepEqual(attributeOrder(order(2 * H), send, [], 7), { verdict: "zaehlt", counts: true, touch: send });
  assert.equal(attributeOrder(order(2 * H, { cancelledAt: plus(SENT, 3 * H) }), send, [], 7).verdict, "storniert");
  assert.equal(attributeOrder(order(-H), send, [], 7).verdict, "davor");
  assert.equal(attributeOrder(order(8 * D), send, [], 7).verdict, "ausserhalb");
  assert.equal(attributeOrder(order(8 * D), send, [], null).verdict, "zaehlt", "„bis heute“");

  // A second Rundmail two days later: an order after it is ITS order (last touch) …
  const later = { id: 2, sentAt: plus(SENT, 2 * D) };
  const r = attributeOrder(order(3 * D), send, [send, later], 7);
  assert.equal(r.verdict, "spaetere_rundmail");
  assert.equal(r.counts, false);
  assert.equal(r.touch?.id, 2);
  assert.equal(attributeOrder(order(3 * D), later, [send, later], 7).verdict, "zaehlt");
  // … an order between the two stays with the first one.
  assert.equal(attributeOrder(order(D), send, [send, later], 7).verdict, "zaehlt");
  assert.equal(attributeOrder(order(D), later, [send, later], 7).verdict, "davor");

  // An EARLIER Rundmail never takes an order from a later one.
  const earlier = { id: 3, sentAt: plus(SENT, -5 * D) };
  assert.equal(attributeOrder(order(H), send, [earlier, send], 14).verdict, "zaehlt");
  assert.equal(attributeOrder(order(H), earlier, [earlier, send], 14).verdict, "spaetere_rundmail");
});

test("the later send's window contains the order whenever the earlier one's does — each order counts at most once", () => {
  const a = { id: 1, sentAt: SENT };
  const b = { id: 2, sentAt: plus(SENT, 36 * H) };
  for (const windowDays of [1, 3, 7, 14, null]) {
    for (let offset = H; offset <= 20 * D; offset += 7 * H) {
      const o = { processedAt: plus(SENT, offset), cancelledAt: null };
      const counted = [a, b].filter((s) => attributeOrder(o, s, [a, b], windowDays).counts).length;
      assert.ok(counted <= 1, `window ${windowDays}, offset ${offset / H} h: counted ${counted} times`);
      // inside a's window (or b's) it counts exactly once
      const inAny = [a, b].some((s) => inRundmailWindow(o.processedAt, s.sentAt, windowDays));
      assert.equal(counted, inAny ? 1 : 0);
    }
  }
});

test("revenue: total minus refunds, never below zero", () => {
  assert.equal(orderNetCents({ totalCents: 12990, refundedCents: 0 }), 12990);
  assert.equal(orderNetCents({ totalCents: 12990, refundedCents: 2990 }), 10000);
  assert.equal(orderNetCents({ totalCents: 12990, refundedCents: 12990 }), 0);
  assert.equal(orderNetCents({ totalCents: 1000, refundedCents: 5000 }), 0);
  assert.equal(orderNetCents({ totalCents: "4500", refundedCents: null }), 4500);
});

test("„mit Code“ is case-insensitive and ignores spaces; „nach Klick“ needs the first click before the order", () => {
  assert.equal(orderUsedCode({ discountCodes: ["blackweek25"] }, ["BLACKWEEK25"]), true);
  assert.equal(orderUsedCode({ discountCodes: [" BlackWeek25 ", "OTHER"] }, ["BLACKWEEK25"]), true);
  assert.equal(orderUsedCode({ discountCodes: ["MK-1234"] }, ["BLACKWEEK25"]), false);
  assert.equal(orderUsedCode({ discountCodes: ["BLACKWEEK25"] }, []), false);
  assert.equal(orderUsedCode({ discountCodes: null }, ["X"]), false);
  assert.equal(clickedBeforeOrder(plus(SENT, 2 * H), plus(SENT, H)), true);
  assert.equal(clickedBeforeOrder(plus(SENT, H), plus(SENT, 2 * H)), false, "clicked after ordering");
  assert.equal(clickedBeforeOrder(plus(SENT, H), null), false);
});

test("attributeRecipientOrders + summarizeAttributed: flags, verdicts and totals of the counted orders", () => {
  const send = { id: 1, sentAt: SENT, clickedAt: plus(SENT, 30 * 60_000) };
  const later = { id: 2, sentAt: plus(SENT, 4 * D) };
  const orders = [
    { customerId: 7, processedAt: plus(SENT, H), cancelledAt: null, totalCents: 10000, refundedCents: 0, discountCodes: ["blackweek25"] },
    { customerId: 7, processedAt: plus(SENT, 20 * 60_000), cancelledAt: null, totalCents: 5000, refundedCents: 1000, discountCodes: [] },
    { customerId: 7, processedAt: plus(SENT, 2 * H), cancelledAt: plus(SENT, 3 * H), totalCents: 9000, refundedCents: 0, discountCodes: ["BLACKWEEK25"] },
    { customerId: 7, processedAt: plus(SENT, 5 * D), cancelledAt: null, totalCents: 7000, refundedCents: 0, discountCodes: [] },
  ];
  const rows = attributeRecipientOrders({ send, personSends: [send, later], orders, windowDays: 7, codes: ["BLACKWEEK25"] });
  assert.deepEqual(rows.map((r) => r.verdict), ["zaehlt", "zaehlt", "storniert", "spaetere_rundmail"]);
  assert.deepEqual(rows.map((r) => r.withCode), [true, false, true, false]);
  assert.deepEqual(rows.map((r) => r.afterClick), [true, false, true, true]);
  assert.equal(rows[3].touchId, 2);
  assert.deepEqual(summarizeAttributed(rows), {
    orders: 2,
    buyers: 1,
    revenueCents: 14000,
    codeOrders: 1,
    codeBuyers: 1,
    codeRevenueCents: 10000,
    clickOrders: 1,
    clickRevenueCents: 10000,
  });
  assert.deepEqual(summarizeAttributed([]).orders, 0);
});

// ── codes ────────────────────────────────────────────────────────────────────

test("coupon codes: coupon blocks (inside sections too) and /discount/ links, upper case and unique", () => {
  const doc = normalizeMailTemplateDoc({
    blocks: [
      { type: "heading", text: "Black Week" },
      { type: "coupon", code: "blackweek25", headline: "25 %" },
      {
        type: "section",
        columns: [
          { blocks: [{ type: "coupon", code: "BW-VIP", headline: "VIP" }] },
          { blocks: [{ type: "text", text: "Hallo" }] },
        ],
      },
    ],
  });
  const links = [
    { url: "https://motionsports.de/discount/BLACKWEEK25?redirect=/collections/all" },
    { url: "https://motionsports.de/discount/extra%2010" },
    { url: "https://motionsports.de/products/rack" },
  ];
  assert.deepEqual(rundmailCouponCodes(doc, links), ["BLACKWEEK25", "BW-VIP", "EXTRA 10"]);
  assert.deepEqual(rundmailCouponCodes(null, []), []);
  assert.deepEqual(rundmailCouponCodes(normalizeMailTemplateDoc({ blocks: [{ type: "coupon", code: "" }] })), []);
});

// ── figures ──────────────────────────────────────────────────────────────────

test("rates: shares of the sent mails, revenue per recipient in cents; nothing sent → null", () => {
  const r = rundmailRates({ sent: 4000, clicked: 400, bounced: 40, complained: 2, unsubscribed: 20, buyers: 80, revenueCents: 1_200_000 });
  assert.equal(r.clickRate, 0.1);
  assert.equal(r.bounceRate, 0.01);
  assert.equal(r.complaintRate, 0.0005);
  assert.equal(r.unsubscribeRate, 0.005);
  assert.equal(r.conversion, 0.02);
  assert.equal(r.revenuePerRecipientCents, 300);
  const none = rundmailRates({ sent: 0, clicked: 0, bounced: 0, complained: 0, unsubscribed: 0, buyers: 0, revenueCents: 0 });
  assert.equal(none.clickRate, null);
  assert.equal(none.revenuePerRecipientCents, null);
});

// ── list parameters ──────────────────────────────────────────────────────────

test("list parameters: filters, reasons, sorts, page, search, ids and the LIKE pattern", () => {
  assert.equal(parseRecipientFilter("ordered"), "ordered");
  assert.equal(parseRecipientFilter("opened"), "all", "opens are not measured — no such filter");
  assert.equal(parseNotSentReason("zu_haeufig"), "zu_haeufig");
  assert.equal(parseNotSentReason("hacked"), null);
  assert.equal(parseNotSentReason("constructor"), null);
  assert.equal(notSentReasonLabel(null), "Ohne Angabe");
  assert.equal(notSentReasonLabel("doppelt"), "Adresse doppelt");
  assert.deepEqual(parseRecipientSort("revenue", undefined), { sort: "revenue", dir: "desc" });
  assert.deepEqual(parseRecipientSort("clicks", "asc"), { sort: "clicks", dir: "asc" });
  assert.deepEqual(parseRecipientSort("email", "sideways"), { sort: "sent", dir: "desc" });
  assert.equal(parseRecipientPage("3"), 3);
  assert.equal(parseRecipientPage("0"), 1);
  assert.equal(parseRecipientPage("abc"), 1);
  assert.equal(parseRecipientQuery("  anna   müller "), "anna müller");
  assert.equal(parseRecipientQuery("x".repeat(300)).length, 100);
  assert.equal(parseRecipientQuery(42), "");
  assert.equal(parsePositiveId("123"), 123);
  assert.equal(parsePositiveId("0"), null);
  assert.equal(parsePositiveId("12a"), null);
  assert.equal(likePattern("50%_off\\"), "%50\\%\\_off\\\\%");
});

test("URL state: read with defaults, write only what differs, reason only with „Nicht gesendet“", () => {
  const read = (pairs) => readAnalyticsUrlState((k) => new URLSearchParams(pairs).get(k));
  assert.deepEqual(read(""), {
    window: "7",
    filter: "all",
    reason: null,
    q: "",
    sort: "sent",
    dir: "desc",
    page: 1,
    recipient: null,
  });
  const state = read("window=1&rfilter=not_sent&rgrund=doppelt&rq=anna&rsort=revenue&rdir=asc&rpage=4&recipient=55");
  assert.deepEqual(state, {
    window: "1",
    filter: "not_sent",
    reason: "doppelt",
    q: "anna",
    sort: "revenue",
    dir: "asc",
    page: 4,
    recipient: 55,
  });
  assert.equal(read("rfilter=clicked&rgrund=doppelt").reason, null);

  const sp = new URLSearchParams("tab=kampagne&campaign=34&view=versand&rpage=9");
  for (const [k, v] of analyticsUrlEntries({ ...read(""), filter: "clicked", window: "heute" })) {
    if (v === null) sp.delete(k);
    else sp.set(k, v);
  }
  assert.equal(sp.toString(), "tab=kampagne&campaign=34&view=versand&window=heute&rfilter=clicked");
  assert.deepEqual(
    analyticsUrlEntries(read("")).filter(([, v]) => v !== null),
    [],
    "the default state writes nothing"
  );
  assert.equal(ANALYTICS_URL_KEYS.window, "window");
});

// ── status chip ──────────────────────────────────────────────────────────────

test("status chip: the Gesendet chips for sent mails, plus pending, sending, not sent and failed", () => {
  const sent = { status: "sent", sentAt: SENT };
  assert.equal(recipientState({ status: "pending" }).label, "Ausstehend");
  assert.equal(recipientState({ status: "sending" }).label, "Wird gesendet");
  assert.deepEqual(recipientState({ status: "suppressed", excludedReason: "kein_doi" }), {
    key: "not_sent",
    label: "Nicht gesendet",
    tone: "neutral",
    detail: "Kein nachweisbares Double-Opt-in",
  });
  assert.equal(recipientState({ status: "skipped", excludedReason: "versand_fehler" }).label, "Fehler");
  assert.equal(recipientState({ status: "skipped", excludedReason: "versand_fehler" }).tone, "destructive");
  assert.equal(recipientState(sent).label, "Gesendet");
  assert.equal(recipientState({ ...sent, deliveredAt: SENT }).label, "Zugestellt");
  assert.equal(recipientState({ ...sent, deliveredAt: SENT, clickedAt: SENT }).label, "Geklickt");
  assert.equal(recipientState({ ...sent, deliveredAt: SENT, clickedAt: SENT, complainedAt: SENT }).label, "Beschwerde");
  const bounce = recipientState({ ...sent, bouncedAt: "2026-11-27T08:01:00Z", bounceType: "hard", complainedAt: SENT });
  assert.equal(bounce.label, "Bounce");
  assert.match(bounce.detail, /^hart · 27\.11\.26, 09:01$/);
  assert.equal(linkDisplay("https://motionsports.de/collections/black-week?utm_source=mo"), "motionsports.de/collections/black-week");
  assert.equal(linkDisplay(null), "—");
});

// ── timeline ─────────────────────────────────────────────────────────────────

test("timeline: sent, delivered, clicks, orders, unsubscribe — oldest first; not sent shows the reason", () => {
  const t = recipientTimeline({
    status: "sent",
    sentAt: SENT,
    deliveredAt: plus(SENT, 5000),
    unsubscribedAt: plus(SENT, 3 * D),
    clicks: [
      { at: plus(SENT, H), url: "https://motionsports.de/collections/black-week?utm_source=mo" },
      { at: plus(SENT, 2 * H), url: null },
    ],
    orders: [{ processedAt: plus(SENT, 90 * 60_000), orderName: "#1042", netCents: 12990, verdict: "zaehlt" }],
  });
  assert.deepEqual(
    t.map((e) => [e.kind, e.title]),
    [
      ["sent", "Gesendet"],
      ["delivered", "Zugestellt"],
      ["click", "Erster Klick"],
      ["order", "Bestellung #1042"],
      ["click", "Klick"],
      ["unsubscribe", "Abgemeldet"],
    ]
  );
  assert.equal(t[2].detail, "motionsports.de/collections/black-week");
  assert.equal(t[3].detail, "zählt für diese Rundmail");
  assert.equal(t[3].orderIndex, 0);
  assert.deepEqual(recipientTimeline({ status: "suppressed", excludedReason: "gesperrt", skippedAt: null }), [
    { kind: "not_sent", at: null, title: "Nicht gesendet", detail: "Gesperrt (Abmeldung, Bounce, Beschwerde)" },
  ]);
  assert.deepEqual(recipientTimeline({ status: "pending" }), []);
});

// ── series ───────────────────────────────────────────────────────────────────

test("send chart steps: per minute up to an hour, per 10 minutes, per hour, per day — at most 180 columns", () => {
  const t0 = Date.parse("2026-11-27T08:00:00Z");
  assert.equal(sendStepMinutes(t0, t0), 1);
  assert.equal(sendStepMinutes(t0, t0 + 17 * 60_000), 1);
  assert.equal(sendStepMinutes(t0, t0 + 3 * H), 10);
  assert.equal(sendStepMinutes(t0, t0 + 29 * H), 10);
  assert.equal(sendStepMinutes(t0, t0 + 31 * H), 60);
  assert.equal(sendStepMinutes(t0, t0 + 3 * 7 * D), 1440);
});

test("buildSendSeries: every bucket from the first to the last send, empty ones as 0", () => {
  const m0 = Date.parse("2026-11-27T08:03:00Z") / 60_000;
  const quick = buildSendSeries([
    { minute: m0, count: 300 },
    { minute: m0 + 1, count: 300 },
    { minute: m0 + 3, count: 120 },
  ]);
  assert.equal(quick.stepMinutes, 1);
  assert.deepEqual(quick.points.map((p) => p.value), [300, 300, 0, 120]);
  assert.equal(quick.points[0].t, "2026-11-27T08:03:00.000Z");

  const slow = buildSendSeries([
    { minute: m0, count: 60 },
    { minute: m0 + 9, count: 60 },
    { minute: m0 + 95, count: 30 },
  ]);
  assert.equal(slow.stepMinutes, 10);
  assert.equal(slow.points[0].t, "2026-11-27T08:00:00.000Z", "buckets start on whole 10 minutes");
  assert.equal(slow.points[0].value, 60);
  assert.equal(slow.points[1].value, 60, "08:12 lands in 08:10–08:20");
  assert.equal(slow.points.at(-1).value, 30);
  assert.equal(slow.points.reduce((n, p) => n + p.value, 0), 150);
  assert.deepEqual(buildSendSeries([]), { stepMinutes: 10, points: [] });
});

test("buildActivitySeries: hours up to four days, Berlin days beyond (an evening UTC click is the next Berlin day)", () => {
  const from = Date.parse("2026-11-27T08:00:00Z");
  const h0 = from / H;
  const hourly = buildActivitySeries(
    [
      { hour: h0, clicks: 40, orders: 0, revenueCents: 0 },
      { hour: h0 + 2, clicks: 10, orders: 2, revenueCents: 25000 },
    ],
    { fromMs: from, toMs: from + 3 * D }
  );
  assert.equal(hourly.granularity, "hour");
  assert.equal(hourly.points.length, 73);
  assert.deepEqual(hourly.points.slice(0, 3).map((p) => [p.clicks, p.orders, p.revenueCents]), [
    [40, 0, 0],
    [0, 0, 0],
    [10, 2, 25000],
  ]);

  const late = Date.parse("2026-11-27T23:30:00Z") / H; // 00:30 on 28.11. in Berlin
  const daily = buildActivitySeries(
    [
      { hour: h0, clicks: 40 },
      { hour: Math.floor(late), clicks: 5, orders: 1, revenueCents: 9900 },
    ],
    { fromMs: from, toMs: from + 7 * D }
  );
  assert.equal(daily.granularity, "day");
  assert.equal(daily.points[0].t, "2026-11-27");
  assert.equal(daily.points[0].clicks, 40);
  assert.deepEqual([daily.points[1].t, daily.points[1].clicks, daily.points[1].orders], ["2026-11-28", 5, 1]);
  assert.equal(daily.points.length, 8);
  assert.equal(activityGranularity(from, from + 4 * D), "hour");
  assert.equal(activityGranularity(from, from + 4 * D + 1), "day");
  assert.deepEqual(buildActivitySeries([], { fromMs: from, toMs: from - 1 }), { granularity: "hour", points: [] });
});

test("Berlin days: midnight boundaries in winter and across the clock change", () => {
  assert.equal(berlinDay(Date.parse("2026-11-27T22:59:00Z")), "2026-11-27");
  assert.equal(berlinDay(Date.parse("2026-11-27T23:00:00Z")), "2026-11-28");
  assert.equal(berlinDay(Date.parse("2026-07-01T22:00:00Z")), "2026-07-02", "summer time: UTC+2");
  assert.deepEqual(dayRange("2026-10-24", "2026-10-27"), ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
  assert.deepEqual(dayRange("2026-11-28", "2026-11-27"), []);
});

test("bucket labels and ticks in Berlin time", () => {
  assert.equal(bucketLabel("2026-11-27T08:00:00.000Z", 10), "27.11., 09:00–09:10");
  assert.equal(bucketLabel("2026-11-27T08:00:00.000Z", 60), "27.11., 09:00–10:00");
  assert.equal(bucketLabel("2026-11-27T08:03:00.000Z", 1), "27.11., 09:03");
  assert.equal(bucketLabel("2026-11-27", 1440), "Fr., 27.11.2026");
  assert.equal(bucketTick("2026-11-27T08:00:00.000Z", 10, false), "09:00");
  assert.equal(bucketTick("2026-11-27T08:00:00.000Z", 60, true), "27.11. 09:00");
  assert.equal(bucketTick("2026-11-27", 1440, true), "27.11.");
});

// ── CSV ──────────────────────────────────────────────────────────────────────

test("CSV cells: quotes for ; \" and line breaks, an apostrophe before formulas, CRLF lines", () => {
  assert.equal(csvCell("Anna"), "Anna");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(12), "12");
  assert.equal(csvCell("Müller; Anna"), '"Müller; Anna"');
  assert.equal(csvCell('Max "Mo" M.'), '"Max ""Mo"" M."');
  assert.equal(csvCell("a\nb"), '"a\nb"');
  assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csvCell("+4930"), "'+4930");
  assert.equal(csvCell("@sum"), "'@sum");
  assert.equal(csvCell(" padded "), '" padded "');
  assert.equal(csvLine(["a", "b;c", ""]), 'a;"b;c";\r\n');
  assert.equal(CSV_BOM, "﻿");
});

test("CSV values: Berlin date-times Excel reads, euros with a decimal comma", () => {
  assert.equal(csvDateTime("2026-11-27T08:03:00Z"), "27.11.2026 09:03");
  assert.equal(csvDateTime("2026-07-01T22:15:00Z"), "02.07.2026 00:15");
  assert.equal(csvDateTime(null), "");
  assert.equal(csvEuro(123456), "1234,56");
  assert.equal(csvEuro(5), "0,05");
  assert.equal(csvEuro(0), "0,00");
  assert.equal(csvEuro("x"), "");
});

test("CSV row of a recipient: every column in header order", () => {
  const cells = recipientCsvCells({
    customerId: 42,
    firstName: "Anna",
    lastName: "Müller",
    email: "anna@example.de",
    status: "sent",
    excludedReason: null,
    sentAt: "2026-11-27T08:03:00Z",
    deliveredAt: "2026-11-27T08:03:05Z",
    bouncedAt: null,
    bounceType: null,
    complainedAt: null,
    clickedAt: "2026-11-27T09:00:00Z",
    unsubscribedAt: null,
    clicks: 3,
    orders: 2,
    revenueCents: 25980,
    codeOrders: 1,
    orderNames: "#1042, #1043",
  });
  assert.equal(cells.length, RECIPIENT_CSV_HEADERS.length);
  assert.deepEqual(cells, [
    "Anna Müller",
    "anna@example.de",
    "42",
    "Geklickt",
    "",
    "27.11.2026 09:03",
    "27.11.2026 09:03",
    "27.11.2026 10:00",
    "3",
    "",
    "",
    "",
    "2",
    "259,80",
    "1",
    "#1042, #1043",
  ]);
  const notSent = recipientCsvCells({
    customerId: null,
    firstName: null,
    lastName: null,
    email: "x@example.de",
    status: "skipped",
    excludedReason: "zu_haeufig",
    sentAt: null,
    deliveredAt: null,
    bouncedAt: null,
    bounceType: null,
    complainedAt: null,
    clickedAt: null,
    unsubscribedAt: null,
    clicks: 0,
    orders: 0,
    revenueCents: 0,
    codeOrders: 0,
    orderNames: null,
  });
  assert.deepEqual(notSent.slice(0, 5), ["", "x@example.de", "", "Nicht gesendet", "Sperrfrist (zuletzt angeschrieben)"]);
  assert.deepEqual(notSent.slice(8), ["", "", "", "", "", "", "", ""], "no zeros for a mail that was never sent");
  assert.equal(recipientName({ firstName: "  Lena ", lastName: null }), "Lena");
});

test("CSV file name: slug, window and the Berlin date", () => {
  const now = Date.parse("2026-11-27T23:30:00Z");
  assert.equal(recipientCsvFilename("black-week-2026", "7", now), "rundmail-black-week-2026-empfaenger-7-tage-2026-11-28.csv");
  assert.equal(recipientCsvFilename("Black Week!", "1", now), "rundmail-black-week-empfaenger-1-tag-2026-11-28.csv");
  assert.equal(recipientCsvFilename("", "heute", now), "rundmail-rundmail-empfaenger-bis-heute-2026-11-28.csv");
});
