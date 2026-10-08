import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_SIGNIN_RETURN,
  ACCOUNT_SIGNIN_STARTED,
  DISCONTINUED_WIDGET_EVENTS,
  LOGIN_GATE_DECLINED,
  LOGIN_GATE_DISMISSED,
  LOGIN_GATE_SHOWN,
  LOGIN_GATE_SIGNIN_CLICKED,
  RETIRED_CONSENT_GATE_SURFACES,
  discontinuedWidgetEvent,
  loginGateRates,
  signinSource,
} from "./kpi-widget-events.mjs";
import { CART_PATTERNS, CTA_PATTERNS } from "./kpi-event-patterns.mjs";

test("the widget's 2026-10-01 event names, exactly as it sends them", () => {
  assert.equal(LOGIN_GATE_SHOWN, "login_gate_shown");
  assert.equal(LOGIN_GATE_SIGNIN_CLICKED, "login_gate_signin_clicked");
  assert.equal(LOGIN_GATE_DECLINED, "login_gate_declined");
  assert.equal(LOGIN_GATE_DISMISSED, "login_gate_dismissed");
  assert.equal(ACCOUNT_SIGNIN_STARTED, "account_signin_started");
  assert.equal(ACCOUNT_SIGNIN_RETURN, "account_signin_return");
});

/** SQL ILIKE → RegExp, to check the headline click signals stay clean. */
const like = (p) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");

test("no new event counts as a product click or a cart click", () => {
  const names = [
    LOGIN_GATE_SHOWN,
    LOGIN_GATE_SIGNIN_CLICKED,
    LOGIN_GATE_DECLINED,
    LOGIN_GATE_DISMISSED,
    ACCOUNT_SIGNIN_STARTED,
    ACCOUNT_SIGNIN_RETURN,
    "consent_gate_shown",
    "consent_gate_accepted",
    "account_signin_linked",
    "account_signin_link_refused",
    "account_shop_recognised",
  ];
  for (const name of names) {
    for (const p of [...CTA_PATTERNS, ...CART_PATTERNS]) {
      assert.equal(like(p).test(name), false, `${name} must not match ${p}`);
    }
  }
});

test("signinSource: only the popup counts as login_gate", () => {
  assert.equal(signinSource("login_gate"), "login_gate");
  assert.equal(signinSource(undefined), "other");
  assert.equal(signinSource(""), "other");
  assert.equal(signinSource("welcome"), "other");
  assert.equal(signinSource({}), "other");
});

test("starter_* are discontinued, nothing else is", () => {
  assert.deepEqual(Object.keys(DISCONTINUED_WIDGET_EVENTS).sort(), ["starter_clicked", "starter_shown"]);
  assert.equal(discontinuedWidgetEvent("starter_shown")?.since, "2026-10-01");
  assert.equal(discontinuedWidgetEvent("login_gate_shown"), null);
  assert.equal(discontinuedWidgetEvent("toString"), null);
  assert.equal(RETIRED_CONSENT_GATE_SURFACES.chat, "2026-10-01");
});

test("loginGateRates: per-session rates, null without a base", () => {
  const r = loginGateRates({ shown: 200, clicked: 50, declined: 100, dismissed: 30, signedIn: 40, linked: 30 });
  assert.equal(r.clickRate, 0.25);
  assert.equal(r.declineRate, 0.5);
  assert.equal(r.dismissRate, 0.15);
  assert.equal(r.signInRate, 0.8);
  assert.equal(r.linkRate, 0.75);
  assert.equal(r.overallRate, 0.15);
  assert.equal(r.unlinked, 10);

  const none = loginGateRates({ shown: 0, clicked: 0, declined: 0, dismissed: 0, signedIn: 0, linked: 0 });
  assert.deepEqual(
    [none.clickRate, none.declineRate, none.dismissRate, none.signInRate, none.linkRate, none.overallRate],
    [null, null, null, null, null, null]
  );
});

test("loginGateRates: junk and impossible counts never break the funnel", () => {
  const r = loginGateRates({ shown: "10", clicked: -3, declined: null, dismissed: undefined, signedIn: 2, linked: 5 });
  assert.equal(r.clickRate, 0);
  assert.equal(r.declineRate, 0);
  assert.equal(r.signInRate, null);
  assert.equal(r.linkRate, 1); // capped
  assert.equal(r.unlinked, 0);
});

test("server-only events: the AC §5 server table, nothing the widget sends", async () => {
  const { SERVER_ONLY_EVENTS, isServerOnlyEvent } = await import("./kpi-widget-events.mjs");
  for (const e of ["account_signin_linked", "account_signin_link_refused", "account_signin_succeeded", "account_erased", "campaign_chat_started", "contact_form_submitted", "order_status_lookup", "mo_order_marker_unresolved", "account_shop_recognised", "page_context_applied", "page_context_answered", "email_capture_ask_shown", "consent_ask_eligible", "consent_copy_served"]) {
    assert.equal(isServerOnlyEvent(e), true, e);
  }
  for (const e of [LOGIN_GATE_SHOWN, ACCOUNT_SIGNIN_STARTED, ACCOUNT_SIGNIN_RETURN, "consent_gate_accepted", "email_capture_declined", "account_export_started", "account_exported", "chat_opened", "product_cta_clicked", "add_to_cart_clicked"]) {
    assert.equal(isServerOnlyEvent(e), false, e);
  }
  assert.equal(isServerOnlyEvent(" account_erased "), true);
  assert.equal(isServerOnlyEvent(null), false);
  assert.equal(new Set(SERVER_ONLY_EVENTS).size, SERVER_ONLY_EVENTS.length);
});

test("classifySigninSession follows docs 05 §12.1", async () => {
  const { classifySigninSession: c, SIGNIN_DIAGNOSIS } = await import("./kpi-widget-events.mjs");
  assert.equal(c({ gateClicked: true, started: true, succeeded: true, returnOk: true, linked: true }), "complete");
  assert.equal(c({ started: true, succeeded: true, returnLinkFailed: true, linked: true }), "complete_retry"); // row 7
  assert.equal(c({ started: true, succeeded: true, returnLinkFailed: true, refusedInvalid: true }), "refused_invalid"); // row 6
  assert.equal(c({ started: true, succeeded: true, returnLinkFailed: true, refusedMismatch: true }), "refused_mismatch");
  assert.equal(c({ started: true, succeeded: true, returnLinkFailed: true }), "link_failed_local"); // row 5
  assert.equal(c({ started: true, succeeded: true, returnOk: true }), "stale_widget"); // row 4a
  assert.equal(c({ started: true, succeeded: true }), "no_return"); // row 4b
  assert.equal(c({ succeeded: true }), "no_return");
  assert.equal(c({ started: true, succeeded: true, returnOther: true }), "returned_error");
  assert.equal(c({ started: true }), "abandoned"); // row 3
  assert.equal(c({ started: true, returnOther: true }), "returned_error");
  assert.equal(c({ gateClicked: true, dismissedAfterClick: true }), "dismissed_while_waiting"); // row 1
  assert.equal(c({ gateClicked: true }), "start_lost"); // row 2
  assert.equal(c({}), "none");
  assert.equal(c({ linked: true, linkedViaShop: true }), "shop_recognised");
  assert.equal(c({ linked: true, linkedViaShop: true, started: true, succeeded: true }), "complete_retry");
  // P0.3: renewals vs new shop sign-ins; an issued but unredeemed shop code.
  assert.equal(c({ linked: true, linkedViaShop: true, linkedViaShopNew: true }), "shop_recognised");
  assert.equal(c({ linked: true, linkedViaShop: true, linkedViaShopNew: false }), "shop_renewed");
  assert.equal(c({ shopCodeIssued: true }), "shop_not_redeemed");
  // A chat sign-in outcome always wins over the shop code.
  assert.equal(c({ shopCodeIssued: true, started: true }), "abandoned");
  assert.equal(c({ shopCodeIssued: true, gateClicked: true }), "start_lost");
  assert.equal(c({ shopCodeIssued: true, refusedInvalid: true }), "refused_invalid");
  // Every category has a label.
  const keys = new Set(SIGNIN_DIAGNOSIS.map((d) => d.key));
  for (const k of ["complete", "shop_recognised", "shop_renewed", "shop_not_redeemed", "complete_retry", "refused_mismatch", "refused_invalid", "link_failed_local", "stale_widget", "no_return", "returned_error", "abandoned", "dismissed_while_waiting", "start_lost"]) {
    assert.ok(keys.has(k), k);
  }
});

test("shopRecognitionRates: rates, minimum sample and the strict alarm threshold", async () => {
  const { shopRecognitionRates: r } = await import("./kpi-widget-events.mjs");
  assert.deepEqual(r({ recognised: 0, withToken: 0, withCode: 0, redeemed: 0 }), {
    redeemRate: null, tokenShare: null, unlinked: 0, unlinkedShare: null, alarm: false,
  });
  assert.equal(r({ recognised: 19, withToken: 0, withCode: 19, redeemed: 0 }).alarm, false);
  assert.equal(r({ recognised: 20, withToken: 5, withCode: 20, redeemed: 15 }).alarm, true);
  assert.equal(r({ recognised: 20, withToken: 5, withCode: 20, redeemed: 16 }).alarm, false);
  const x = r({ recognised: 10, withToken: 4, withCode: 5, redeemed: 9 });
  assert.equal(x.redeemRate, 1);
  assert.equal(x.unlinked, 0);
  assert.equal(x.tokenShare, 0.4);
});

test("consent variant rows: forged values merge into „unbekannt“; DOI rate leaves already-confirmed out", async () => {
  const { normalizeConsentVariantRows: n, consentVariantRates: r } = await import("./kpi-widget-events.mjs");
  const known = (id) => id === "a";
  const place = (p) => (["popup", "signin_return", "value_moment"].includes(p) ? p : null);
  const rows = n(
    [
      { variant: "a", placement: "popup", shown: 10, accepted: 4 },
      { variant: "<script>", placement: "popup", shown: 1 },
      { variant: "zz", placement: "popup", shown: 2 },
      { variant: "", placement: "", shown: 3 },
      { variant: "a", placement: "evil", shown: 1 },
    ],
    known,
    place
  );
  const byKey = Object.fromEntries(rows.map((x) => [`${x.variant}|${x.placement}`, x]));
  assert.equal(byKey["a|popup"].shown, 10);
  assert.equal(byKey["unbekannt|popup"].shown, 3);
  assert.equal(byKey["ohne (älteres Widget)|ohne"].shown, 3);
  assert.equal(byKey["a|unbekannt"].shown, 1);
  assert.deepEqual(r({ shown: 0, accepted: 0, doiRequired: 0, doiConfirmed: 0 }), { acceptRate: null, doiRate: null, comparable: false });
  assert.deepEqual(r({ shown: 200, accepted: 50, doiRequired: 40, doiConfirmed: 20 }), { acceptRate: 0.25, doiRate: 0.5, comparable: true });
});

test("consent variant rows: the reward counts merge with the rest, the row key stays variant|placement", async () => {
  const { normalizeConsentVariantRows: n } = await import("./kpi-widget-events.mjs");
  const known = (id) => id === "a" || id === "b";
  const place = (p) => (["popup", "signin_return", "value_moment"].includes(p) ? p : null);
  const rows = n(
    [
      { variant: "b", placement: "popup", shown: 10, accepted: 3, rewardShown: 8, rewardAccepted: 2 },
      { variant: "b", placement: "popup", optedIn: 3, doiRequired: 3, doiConfirmed: 1 },
      { variant: "a", placement: "popup", shown: 5 },
    ],
    known,
    place
  );
  const byKey = Object.fromEntries(rows.map((x) => [`${x.variant}|${x.placement}`, x]));
  assert.equal(rows.length, 2);
  assert.equal(byKey["b|popup"].rewardShown, 8);
  assert.equal(byKey["b|popup"].rewardAccepted, 2);
  assert.equal(byKey["b|popup"].optedIn, 3);
  assert.equal(byKey["a|popup"].rewardShown, 0);
});

test("rewardRenderGap: only for a variant with a reward, never negative", async () => {
  const { rewardRenderGap: g } = await import("./kpi-widget-events.mjs");
  assert.equal(g({ shown: 10, rewardShown: 7 }, true), 3);
  assert.equal(g({ shown: 10, rewardShown: 7 }, false), 0);
  assert.equal(g({ shown: 5, rewardShown: 9 }, true), 0);
  assert.equal(g({ shown: "4" }, true), 4);
  assert.equal(g(/** @type {any} */ (null), true), 0);
});

test("login teaser rows: hint × variant, forged variants merge into „unbekannt“, mixed sessions apart", async () => {
  const { normalizeLoginTeaserRows: n } = await import("./kpi-widget-events.mjs");
  const known = (id) => id === "a" || id === "b";
  const rows = n(
    [
      { teaser: true, mixed: false, variant: "b", servedVariant: "b", shown: 6, clicked: 3, signedIn: 2, linked: 2, optedIn: 1, confirmed: 1 },
      { teaser: true, mixed: false, variant: "b", servedVariant: null, shown: 4, clicked: 1, linked: 1 },
      { teaser: true, mixed: false, variant: "<x>", shown: 2, clicked: 1 },
      { teaser: true, mixed: false, variant: "zz", shown: 1 },
      { teaser: false, mixed: false, variant: "", servedVariant: "a", shown: 20, clicked: 4, linked: 2 },
      { teaser: false, mixed: false, variant: "b", shown: 1 }, // no teaser → no variant shown
      { teaser: false, mixed: true, variant: "b", shown: 2, clicked: 2, linked: 1 },
      { teaser: true, mixed: false, variant: "b", shown: 0, clicked: 5 }, // no shown session → dropped
    ],
    known
  );
  assert.deepEqual(
    rows.map((r) => `${r.hint}|${r.variant}|${r.shown}`),
    ["mit Hinweis|b|10", "mit Hinweis|unbekannt|3", "ohne Hinweis|—|21", "gemischt|b|2"]
  );
  const b = rows[0];
  assert.equal(b.clicked, 4);
  assert.equal(b.linked, 3);
  assert.equal(b.optedIn, 1);
  assert.equal(b.confirmed, 1);
  assert.equal(b.rates.overallRate, 0.3);
  assert.equal(rows[2].rates.overallRate, 2 / 21);
});

test("served-variant rows: only sessions with a served variant, teaser share counted", async () => {
  const { normalizeServedVariantRows: n } = await import("./kpi-widget-events.mjs");
  const known = (id) => id === "a" || id === "b";
  const rows = n(
    [
      { teaser: true, mixed: false, variant: "b", servedVariant: "b", shown: 6, clicked: 3, linked: 2 },
      { teaser: false, mixed: false, variant: "", servedVariant: "b", shown: 2, clicked: 1 },
      { teaser: false, mixed: false, variant: "", servedVariant: "a", shown: 10, clicked: 2, linked: 1 },
      { teaser: false, mixed: false, variant: "", servedVariant: null, shown: 50 },
      { teaser: false, mixed: false, variant: "", servedVariant: "", shown: 50 },
      { teaser: false, mixed: false, variant: "", servedVariant: "?", shown: 1 },
    ],
    known
  );
  assert.deepEqual(
    rows.map((r) => `${r.variant}|${r.shown}|${r.withTeaser}`),
    ["a|10|0", "b|8|6", "unbekannt|1|0"]
  );
  assert.equal(rows[1].rates.overallRate, 0.25);
});
