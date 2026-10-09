import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HIDDEN_TITLE,
  SENDER_TAG_PATTERN,
  WELCOME_HINT_RE,
  assessWelcomeTrigger,
  berlin,
  buildTimeline,
  cleanText,
  codeGroupLabel,
  codeKind,
  codeUsageGroups,
  describeDiscountNode,
  duration,
  isMoOwnDiscount,
  isReadOnlyGraphql,
  isSelectOnlySql,
  maskCode,
  maskEmail,
  parseInboxTime,
  redactEmails,
  shopifyConsentOf,
  throttleDelayMs,
  welcomeCandidateReasons,
} from "./welcome-code-check.mjs";

const node = (discount, events = []) => ({ id: "gid://shopify/DiscountNode/1", discount, events: { nodes: events } });
const basic = (over = {}) => ({
  __typename: "DiscountCodeBasic",
  title: "Sommer",
  status: "ACTIVE",
  tags: [],
  codesCount: { count: 1 },
  codes: { nodes: [{ code: "SOMMER10", createdBy: null, asyncUsageCount: 3 }] },
  customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.1 }, items: { __typename: "AllDiscountItems", allItems: true } },
  context: { __typename: "DiscountBuyerSelectionAll", all: "ALL" },
  ...over,
});

test("masking: e-mail keeps first letter and domain, codes keep 4 chars + length (short codes none)", () => {
  assert.equal(maskEmail("Max.Muster@Example.com"), "m•••@example.com");
  assert.equal(maskEmail("nope"), "•••");
  assert.equal(maskCode("WILLKOMMEN5"), "WILL•••(11)");
  assert.equal(maskCode("WILLKOMMEN5", true), "WILLKOMMEN5");
  assert.equal(maskCode("AB"), "•••(2)");
  assert.equal(maskCode("AB", true), "AB");
});

test("free text: addresses masked, tags stripped, cut to length", () => {
  assert.equal(redactEmails("Rabatt für anna.b@example.com und Bob <bob@shop.de>"), "Rabatt für a•••@example.com und Bob <b•••@shop.de>");
  assert.equal(redactEmails(null), null);
  assert.equal(cleanText("<b>Max</b> subscribed  (max@example.com)"), "Max subscribed (m•••@example.com)");
  assert.equal(cleanText("x".repeat(20), 10), `${"x".repeat(9)}…`);
});

test("berlin: Europe/Berlin with seconds, dash for nothing", () => {
  assert.equal(berlin("2026-10-08T10:00:05Z"), "08.10.2026, 12:00:05");
  assert.equal(berlin(null), "—");
  assert.equal(berlin("kaputt"), "—");
});

test("inbox time: with a zone as given, without one as Europe/Berlin wall time (ISO or German)", () => {
  assert.equal(parseInboxTime("2026-10-06T16:16:40+02:00"), "2026-10-06T14:16:40.000Z");
  assert.equal(parseInboxTime("2026-10-06T14:16:40Z"), "2026-10-06T14:16:40.000Z");
  assert.equal(parseInboxTime("2026-10-06T16:16:40"), "2026-10-06T14:16:40.000Z");
  assert.equal(parseInboxTime("2026-10-06 16:16"), "2026-10-06T14:16:00.000Z");
  assert.equal(parseInboxTime("06.10.2026, 16:16:40"), "2026-10-06T14:16:40.000Z");
  assert.equal(parseInboxTime("1.12.2026 10:00"), "2026-12-01T09:00:00.000Z");
  assert.equal(parseInboxTime("2026-10-25T03:30:00"), "2026-10-25T02:30:00.000Z"); // after the switch back to CET
  assert.equal(parseInboxTime("2026-10-25T01:30:00"), "2026-10-24T23:30:00.000Z"); // still CEST
  assert.equal(parseInboxTime("gestern"), null);
  assert.equal(parseInboxTime("2026-13-01T10:00"), null);
  assert.equal(parseInboxTime(""), null);
});

test("guards: GraphQL queries only", () => {
  assert.equal(isReadOnlyGraphql("query X($id: ID!) { discountNode(id: $id) { id } }"), true);
  assert.equal(isReadOnlyGraphql("{ currentAppInstallation { accessScopes { handle } } }"), true);
  assert.equal(isReadOnlyGraphql('query { shop { name } } # mutation in a comment\n'), true);
  assert.equal(isReadOnlyGraphql('query Q { customers(query: "mutation") { nodes { id } } }'), true);
  assert.equal(isReadOnlyGraphql("mutation { discountCodeDelete(id: 1) { userErrors { message } } }"), false);
  assert.equal(isReadOnlyGraphql("# hi\nmutation M { x }"), false);
  assert.equal(isReadOnlyGraphql("query A { a } mutation B { b }"), false);
  assert.equal(isReadOnlyGraphql("subscription S { x }"), false);
  assert.equal(isReadOnlyGraphql(""), false);
});

test("guards: one SELECT only", () => {
  assert.equal(isSelectOnlySql("SELECT id, shopify_updated_at, done_at FROM customers WHERE email = $1"), true);
  assert.equal(isSelectOnlySql("  with x AS (SELECT 1) SELECT * FROM x;"), true);
  assert.equal(isSelectOnlySql("SELECT 'delete me' AS note -- update later"), true);
  assert.equal(isSelectOnlySql("UPDATE customers SET email = NULL"), false);
  assert.equal(isSelectOnlySql("SELECT 1; DELETE FROM customers"), false);
  assert.equal(isSelectOnlySql("WITH d AS (DELETE FROM customers RETURNING id) SELECT * FROM d"), false);
  assert.equal(isSelectOnlySql("SELECT * FROM customers FOR UPDATE"), false);
  assert.equal(isSelectOnlySql("SELECT set_config('x', 'y', true)"), true);
});

test("throttle: waits from the cost extension, Retry-After or 2 s; final answers return null", () => {
  const throttled = {
    errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
    extensions: { cost: { requestedQueryCost: 300, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 100, restoreRate: 100 } } },
  };
  assert.equal(throttleDelayMs({ status: 200, json: throttled }), 2250);
  assert.equal(throttleDelayMs({ status: 429, json: {}, retryAfter: "3" }), 3000);
  assert.equal(throttleDelayMs({ status: 503, json: null }), 2000);
  assert.equal(throttleDelayMs({ status: 429, json: { extensions: { cost: { requestedQueryCost: 99999, throttleStatus: { currentlyAvailable: 0, restoreRate: 50 } } } } }), 20_000);
  assert.equal(throttleDelayMs({ status: 200, json: { data: {} } }), null);
  assert.equal(throttleDelayMs({ status: 401, json: { errors: [{ message: "nope" }] } }), null);
});

test("describe: value, minimum, items, combinability; minimum unknown when not asked for", () => {
  const d = describeDiscountNode(
    node(
      basic({
        customerGets: {
          value: { __typename: "DiscountAmount", amount: { amount: "50.0", currencyCode: "EUR" }, appliesOnEachItem: false },
          items: { __typename: "DiscountCollections", collections: { nodes: [{ title: "Eligible" }], pageInfo: { hasNextPage: false } } },
        },
        minimumRequirement: { __typename: "DiscountMinimumSubtotal", greaterThanOrEqualToSubtotal: { amount: "500", currencyCode: "EUR" } },
        combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
      })
    )
  );
  assert.match(d.value, /^50,00\s€$/);
  assert.equal(d.percent, null);
  assert.equal(d.items, "Kollektionen: Eligible");
  assert.match(d.minimum, /^ab 500,00\s€ Warenwert$/);
  assert.equal(d.combines, "kombinierbar mit Versandrabatte");
  const five = describeDiscountNode(node(basic({ customerGets: { value: { percentage: 0.05 } } })));
  assert.equal(five.value, "5 %");
  assert.equal(five.percent, 5);
  assert.equal(five.minimum, null);
  assert.equal(describeDiscountNode(node(basic({ minimumRequirement: null }))).minimum, "kein Mindestwert");
  assert.equal(describeDiscountNode(node({ __typename: "DiscountCodeFreeShipping", title: "Versand", codes: { nodes: [] } })).value, "Gratisversand");
});

test("describe: a customer-restricted discount shows a count, drops Shopify's summary and masks addresses", () => {
  const d = describeDiscountNode(
    node(
      basic({
        title: "Willkommen anna@example.com",
        context: { __typename: "DiscountCustomers", customers: [{ id: "a" }, { id: "b" }] },
        summary: "50 € für anna@example.com",
      }),
      [{ createdAt: "2026-10-01T00:00:00Z", action: "create", message: "Code für <b>anna@example.com</b> angelegt" }]
    )
  );
  assert.equal(d.buyers, "nur 2 einzelne Kunden");
  assert.equal(codeKind(d), "Code nur für einzelne Kunden");
  assert.equal(d.summary, null);
  assert.equal(d.title, HIDDEN_TITLE);
  assert.equal(d.restricted, true);
  assert.ok(!JSON.stringify(d).includes("anna@"));
  assert.deepEqual(welcomeCandidateReasons(d), ["Titel"]);
  // pass 1 (the scan) only knows the context's type — enough to hide the title
  const scanned = describeDiscountNode(node(basic({ title: "VIP Anna Beispiel", context: { __typename: "DiscountCustomers" } })));
  assert.equal(scanned.title, HIDDEN_TITLE);
  assert.equal(scanned.buyers, "nur einzelne Kunden");
  assert.equal(describeDiscountNode(node(basic({ context: { __typename: "DiscountCustomers", customers: [{ id: "a" }] } }))).buyers, "nur 1 einzelner Kunde");
  const open = describeDiscountNode(node(basic({ title: "Rabatt für info@shop.de", summary: "5 % für alle — Fragen an info@shop.de" })));
  assert.equal(open.title, "Rabatt für i•••@shop.de");
  assert.equal(open.summary, "5 % für alle — Fragen an i•••@shop.de");
  assert.equal(codeKind(open), "ein Code für alle");
  assert.equal(codeKind(describeDiscountNode(node(basic({ codesCount: { count: 40 } })))), "Einzelcodes");
});

test("candidates: welcome words, 5 %, app-created codes; Mo's own codes never", () => {
  const welcome = describeDiscountNode(node(basic({ title: "Newsletter Willkommen", codes: { nodes: [{ code: "HALLO", createdBy: { title: "Shopify Messaging" } }] } })));
  assert.deepEqual(welcomeCandidateReasons(welcome), ["Titel", "Code von App: Shopify Messaging"]);
  const five = describeDiscountNode(node(basic({ customerGets: { value: { percentage: 0.05 } } })));
  assert.deepEqual(welcomeCandidateReasons(five), ["5 %"]);
  const mo = describeDiscountNode(
    node(
      basic({
        title: "Persönlicher Rabatt (5%) — MS5-ABCD",
        customerGets: { value: { percentage: 0.05 } },
        codes: { nodes: [{ code: "MS5-ABCD2345", createdBy: { title: "motionsports-chatbot" } }] },
      })
    )
  );
  assert.equal(isMoOwnDiscount(mo), true);
  assert.deepEqual(welcomeCandidateReasons(mo), []);
  assert.deepEqual(welcomeCandidateReasons(describeDiscountNode(node(basic()))), []);
  const byAppEvent = describeDiscountNode(node(basic(), [{ createdAt: "2025-01-01T00:00:00Z", action: "create", appTitle: "Shopify Flow", attributeToApp: true }]));
  assert.deepEqual(welcomeCandidateReasons(byAppEvent), ["angelegt/geändert von App: Shopify Flow"]);
  const bulk = describeDiscountNode(node(basic({ codesCount: { count: 800 }, tags: ["welcome-series"] })));
  assert.deepEqual(welcomeCandidateReasons(bulk), ["Tag", "800 Codes (Einzelcodes?)"]);
});

test("hint patterns: JS and Postgres share the words, the tag pattern adds mail apps", () => {
  for (const w of ["Willkommen", "WELCOME5", "Newsletter-Rabatt", "new customer", "Erstbestellung", "sign-up"]) assert.ok(WELCOME_HINT_RE.test(w), w);
  assert.ok(!WELCOME_HINT_RE.test("Sommer10"));
  assert.ok(new RegExp(SENDER_TAG_PATTERN, "i").test("Mailchimp"));
  assert.ok(!/[\\()[\]]/.test(SENDER_TAG_PATTERN.replace(/\[ _-\]/g, "")), "only alternation and [ _-] classes (valid POSIX ERE)");
});

test("code groups: shared codes by name (masked by default), single-use codes folded into their prefix", () => {
  const g = codeUsageGroups([
    { code: "willkommen5", orders: 5, customers: 5, first: "2026-10-01", last: "2026-10-05" },
    { code: "WELCOME-AAAA", orders: 1, customers: 1, first: "2026-10-02", last: "2026-10-02" },
    { code: "WELCOME-BBBB", orders: 1, customers: 1, first: new Date("2026-10-03"), last: new Date("2026-10-03") },
    { code: "MS5-CCCC", orders: 1, customers: 1, first: "2026-10-04", last: "2026-10-04" },
    { code: "XY12", orders: 1, customers: 1, first: "2026-10-04", last: "2026-10-04" },
  ]);
  assert.deepEqual(
    g.map((x) => [x.group, x.codes, x.orders, x.mo]),
    [
      ["WILLKOMMEN5", 1, 5, false],
      ["WELCOME-…", 2, 2, false],
      ["(Einzelcodes ohne Präfix)", 1, 1, false],
      ["MS5-…", 1, 1, true],
    ]
  );
  assert.equal(g[1].first, "2026-10-02");
  assert.equal(new Date(g[1].last).toISOString().slice(0, 10), "2026-10-03");
  assert.equal(codeGroupLabel(g[0]), "WILL•••(11)");
  assert.equal(codeGroupLabel(g[0], true), "WILLKOMMEN5");
  assert.equal(codeGroupLabel(g[1]), "WELCOME-…");
});

test("shopify consent: defaultEmailAddress first, the deprecated field as fallback", () => {
  assert.deepEqual(
    shopifyConsentOf({
      defaultEmailAddress: { marketingState: "SUBSCRIBED", marketingOptInLevel: "CONFIRMED_OPT_IN", marketingUpdatedAt: "2026-10-08T10:00:00Z" },
      emailMarketingConsent: { marketingState: "SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN", consentUpdatedAt: "2026-10-01T10:00:00Z" },
    }),
    { marketingState: "SUBSCRIBED", optInLevel: "CONFIRMED_OPT_IN", consentUpdatedAt: "2026-10-08T10:00:00Z", from: "defaultEmailAddress" }
  );
  assert.deepEqual(
    shopifyConsentOf({ defaultEmailAddress: null, emailMarketingConsent: { marketingState: "PENDING", marketingOptInLevel: null, consentUpdatedAt: "2026-10-01T10:00:00Z" } }),
    { marketingState: "PENDING", optInLevel: null, consentUpdatedAt: "2026-10-01T10:00:00Z", from: "emailMarketingConsent (veraltet)" }
  );
  assert.equal(
    shopifyConsentOf({ defaultEmailAddress: { marketingState: "SUBSCRIBED", marketingUpdatedAt: null }, emailMarketingConsent: { consentUpdatedAt: "2026-10-01T10:00:00Z" } }).consentUpdatedAt,
    "2026-10-01T10:00:00Z"
  );
  assert.equal(shopifyConsentOf({}), null);
});

test("timeline: chronological, unreadable times dropped; durations", () => {
  const t = buildTimeline([
    { at: "2026-10-08T10:05:00Z", side: "Shopify", what: "b" },
    { at: new Date("2026-10-08T10:00:00Z"), side: "Mo", what: "a" },
    { at: "kaputt", side: "Mo", what: "x" },
    { at: null, side: "Mo", what: "y" },
  ]);
  assert.deepEqual(
    t.map((e) => e.what),
    ["a", "b"]
  );
  assert.equal(duration(18_000), "18 s");
  assert.equal(duration(4.3 * 60_000), "4 min");
  assert.equal(duration(25 * 3_600_000), "25 h");
  assert.equal(duration(25.5 * 3_600_000), "25,5 h");
});

const T = "2026-10-08T10:00:00.000Z";
const plus = (iso, min) => new Date(new Date(iso).getTime() + min * 60000).toISOString();
const doneRow = (over = {}) => ({ kind: "consent_update", status: "done", payloadAt: T, payloadState: "subscribed", doneAt: plus(T, 0.3), ...over });

test("assess: Mo wrote in time, Shopify carries Mo's timestamp, mail 4 min later", () => {
  const out = assessWelcomeTrigger({
    moConfirmedAt: T,
    outbox: [doneRow()],
    shopify: { marketingState: "SUBSCRIBED", optInLevel: "CONFIRMED_OPT_IN", consentUpdatedAt: T },
    inboxAt: plus(T, 4.3),
  });
  assert.match(out[0], /18 s nach der Bestätigung \(Einwilligung aktualisiert \(Testfall 8\)\) — innerhalb des 24-h-Fensters/);
  assert.ok(out.some((l) => /stammt von Mo/.test(l)));
  assert.match(out.at(-1), /4 min nach Mos Schreibvorgang → passt zu „von der Chat-Bestätigung ausgelöst“/);
});

test("assess: customerCreate path is named (test case 8b); a write more than 24 h later is flagged", () => {
  const ok = assessWelcomeTrigger({ moConfirmedAt: T, outbox: [doneRow({ kind: "customer_create" })] });
  assert.match(ok[0], /customerCreate/);
  assert.match(ok.at(-1), /--inbox/);
  const late = assessWelcomeTrigger({ moConfirmedAt: T, outbox: [doneRow({ kind: "customer_create", doneAt: plus(T, 25 * 60) })] });
  assert.match(late[0], /25 h NACH .* älter als 24 h/);
});

test("assess: no confirmation, no outbox row, pending row, mail before Mo's write", () => {
  assert.match(assessWelcomeTrigger({})[0], /keine DOI-Bestätigung/);
  assert.match(assessWelcomeTrigger({ moConfirmedAt: T, outbox: [] })[0], /KEINE Outbox-Zeile/);
  assert.match(
    assessWelcomeTrigger({ moConfirmedAt: T, outbox: [{ kind: "consent_update", status: "failed", payloadAt: T, payloadState: "subscribed" }] })[0],
    /noch nicht erledigt \(failed\)/
  );
  const unsub = assessWelcomeTrigger({ moConfirmedAt: T, outbox: [doneRow({ payloadState: "unsubscribed" })] });
  assert.match(unsub[0], /KEINE Outbox-Zeile/);
  const early = assessWelcomeTrigger({ moConfirmedAt: T, outbox: [doneRow({ doneAt: plus(T, 1) })], inboxAt: plus(T, -30) });
  assert.match(early.at(-1), /31 min VOR Mos Schreibvorgang → anderer Auslöser/);
  const noRef = assessWelcomeTrigger({ inboxAt: T });
  assert.match(noRef.at(-1), /außerhalb von Mo/);
  const confirmOnly = assessWelcomeTrigger({ moConfirmedAt: T, inboxAt: plus(T, 3) });
  assert.match(confirmOnly.at(-1), /3 min nach Mos Bestätigung/);
});

test("assess: another source set the consent last; Shopify PENDING; an older write than the latest confirmation", () => {
  const foreign = assessWelcomeTrigger({
    moConfirmedAt: T,
    outbox: [doneRow({ doneAt: plus(T, 1) })],
    shopify: { marketingState: "SUBSCRIBED", optInLevel: "SINGLE_OPT_IN", consentUpdatedAt: plus(T, 600) },
  });
  assert.ok(foreign.some((l) => /10 h von Mos Bestätigungszeit ab → eine spätere\/andere Quelle/.test(l)));
  const pending = assessWelcomeTrigger({ moConfirmedAt: null, shopify: { marketingState: "PENDING", consentUpdatedAt: T } });
  assert.ok(pending.some((l) => /EIGENEN Bestätigungsmail .* C\.29/.test(l)));
  const stale = assessWelcomeTrigger({ moConfirmedAt: plus(T, 3 * 24 * 60), outbox: [doneRow()] });
  assert.ok(stale.some((l) => /früheren Bestätigung .*\(war schon abonniert\)/.test(l)));
});

test("assess: without Mo's database only Shopify's side, the mail measured against Shopify's timestamp", () => {
  const out = assessWelcomeTrigger({
    moChecked: false,
    moConfirmedAt: T,
    outbox: [doneRow()],
    shopify: { marketingState: "SUBSCRIBED", optInLevel: "CONFIRMED_OPT_IN", consentUpdatedAt: T },
    inboxAt: plus(T, 2),
  });
  assert.match(out[0], /Datenbank nicht gelesen/);
  assert.ok(!out.some((l) => /keine DOI-Bestätigung|Outbox-Zeile|Mo → Shopify/.test(l)));
  assert.match(out.at(-1), /2 min nach Shopifys letzter Einwilligungsänderung/);
  assert.match(assessWelcomeTrigger({ moChecked: false, inboxAt: T }).at(-1), /kein Bezugspunkt/);
});

test("a discount titled with its code never prints the code in clear (unless --show-codes)", async () => {
  const { describeDiscountNode, maskCodesIn, maskCode } = await import("./welcome-code-check.mjs");
  const node = {
    id: "gid://shopify/DiscountCodeNode/1",
    discount: {
      __typename: "DiscountCodeBasic",
      title: "WILLKOMMEN5",
      summary: "5 % auf alles mit WILLKOMMEN5",
      tags: ["newsletter willkommen5"],
      codes: { nodes: [{ code: "WILLKOMMEN5" }] },
    },
    events: { nodes: [{ message: "Discount WILLKOMMEN5 was created." }] },
  };
  const d = describeDiscountNode(node);
  // Everything the script prints: title, summary, tags, event texts, the codes' shown form.
  const printed = JSON.stringify([d.title, d.summary, d.tags, d.events.map((e) => e.message), d.codes.map((c) => c.shown)]);
  assert.equal(/willkommen5/i.test(printed), false);
  const shown = describeDiscountNode(node, { showCodes: true });
  assert.equal(shown.title, "WILLKOMMEN5");
  // Short codes are masked too; regex characters in a code are literal.
  assert.equal(maskCode("AB12"), "•••(4)");
  assert.equal(maskCodesIn("Code a.b+c gilt", ["a.b+c"]), "Code a.b+•••(5) gilt".replace("a.b+•••(5)", maskCode("a.b+c")));
  assert.equal(maskCodesIn(null, ["X"]), null);
});
