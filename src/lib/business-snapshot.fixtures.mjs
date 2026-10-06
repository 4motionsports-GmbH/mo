// A realistic raw input for buildBusinessSnapshot() — the shape business-
// snapshot.ts collects from the store getters — used by the node:test suites
// of the snapshot, the report synthesis and the PDF. Numbers are invented but
// consistent (the funnels narrow, rates match their counts). Every part has
// the shape of its getter (business-snapshot-core SNAPSHOT_RAW_FIELDS; the
// field-contract test checks the builder reads nothing this fixture lacks).

export const SAMPLE_PERIOD = { from: "2026-08-10", to: "2026-09-08", days: 30, label: "10.08.2026 – 08.09.2026" };
export const SAMPLE_PREVIOUS = { from: "2026-07-11", to: "2026-08-09", days: 30, label: "11.07.2026 – 09.08.2026" };

/** One mo_orders ledger row as mo-revenue-store RevenueLedgerOrder. */
function order(day, total, tier, source, { codes = [], overlap = null, status = "PAID" } = {}) {
  return {
    processedAt: `${day}T10:00:00.000Z`,
    total,
    currency: "EUR",
    financialStatus: status,
    tier,
    source,
    discountCodes: codes,
    overlap,
  };
}

// „Umsatz durch Mo“ — current period (ledger). Paid: 21 orders, 14 920,90 €;
// the Shopify lookup adds MK-HERBST-03 (300 €) → 22 orders, 15 220,90 €.
//   Beraten & gekauft 3 / 1 890 · Beraten, anderes 5 / 4 210,50 · Direkt 14 / 9 120,40
//   (Set 4 / 5 120 · Kampagne 4 / 1 340,40 · Marketing 4 / 1 450 · Zusammenfassung 2 / 1 210)
const CURRENT_ORDERS = [
  order("2026-08-12", 720, "assisted", "widget", { overlap: true }),
  order("2026-08-19", 650, "assisted", "widget", { overlap: true }),
  order("2026-09-02", 520, "assisted", "widget", { overlap: true }),
  order("2026-08-11", 1200, "influenced", "widget", { overlap: false }),
  order("2026-08-15", 980.5, "influenced", "widget", { overlap: false }),
  order("2026-08-24", 850, "influenced", "widget", { overlap: false }),
  order("2026-08-29", 640, "influenced", "widget", { overlap: false }),
  order("2026-09-05", 540, "influenced", "widget", { overlap: false }),
  order("2026-08-13", 1800, "direct", "bundle"),
  order("2026-08-21", 1400, "direct", "bundle"),
  order("2026-08-27", 1100, "direct", "bundle"),
  order("2026-09-04", 820, "direct", "bundle"),
  order("2026-08-20", 420.4, "direct", "discount_code", { codes: ["MK-HERBST-01"] }),
  order("2026-08-26", 320, "direct", "discount_code", { codes: ["MK-HERBST-02"] }),
  order("2026-09-01", 300, "direct", "discount_code", { codes: ["MK-EINZEL-01"] }),
  order("2026-08-17", 340, "direct", "discount_code", { codes: ["MS5-A7Q2"] }),
  order("2026-08-31", 300, "direct", "discount_code", { codes: ["MS5-B3K9"] }),
  order("2026-08-22", 470, "direct", "marketing_email"),
  order("2026-09-03", 340, "direct", "marketing_email"),
  order("2026-08-14", 700, "direct", "summary_email"),
  order("2026-08-28", 510, "direct", "summary_email"),
  // Not (yet) paid — counted as „erfasst, nicht bezahlt“, never as revenue.
  order("2026-09-07", 480, "influenced", "widget", { overlap: false, status: "PENDING" }),
  order("2026-09-08", 999, "direct", "bundle", { status: "PENDING" }),
];

// Previous period (ledger only, as on the KPI screen): 16 paid orders, 10 120 €.
const PREVIOUS_ORDERS = [
  order("2026-07-14", 560, "assisted", "widget", { overlap: true }),
  order("2026-07-30", 420, "assisted", "widget", { overlap: true }),
  order("2026-07-12", 1000, "influenced", "widget", { overlap: false }),
  order("2026-07-20", 850, "influenced", "widget", { overlap: false }),
  order("2026-07-27", 610, "influenced", "widget", { overlap: false }),
  order("2026-08-05", 450, "influenced", "widget", { overlap: false }),
  order("2026-07-16", 2500, "direct", "bundle"),
  order("2026-08-02", 768.65, "direct", "bundle"),
  order("2026-07-22", 330, "direct", "discount_code", { codes: ["MK-SOMMER-01"] }),
  order("2026-07-29", 280, "direct", "discount_code", { codes: ["MK-SOMMER-02"] }),
  order("2026-08-06", 200, "direct", "discount_code", { codes: ["MK-EINZEL-00"] }),
  order("2026-07-18", 310, "direct", "discount_code", { codes: ["MS5-C1D4"] }),
  order("2026-07-25", 300, "direct", "discount_code", { codes: ["MS5-D8F2"] }),
  order("2026-08-01", 924.11, "direct", "marketing_email"),
  order("2026-07-15", 400, "direct", "summary_email"),
  order("2026-08-08", 217.24, "direct", "summary_email"),
  order("2026-08-09", 300, "influenced", "widget", { overlap: false, status: "PENDING" }),
];

/** getMoRevenueData(range) — mo-revenue-store MoRevenueData (details trimmed). */
export const SAMPLE_MO_REVENUE = {
  range: SAMPLE_PERIOD,
  previous: { from: SAMPLE_PREVIOUS.from, to: SAMPLE_PREVIOUS.to, days: SAMPLE_PREVIOUS.days },
  orders: CURRENT_ORDERS,
  previousOrders: PREVIOUS_ORDERS,
  details: [],
  detailsTruncated: false,
  ledgerCodes: ["MK-HERBST-01", "MK-HERBST-02", "MK-EINZEL-01", "MS5-A7Q2", "MS5-B3K9"],
  ledgerOrderNames: ["#1031", "#1036", "#1040"],
  unresolved: { unknownToken: 2, outsideWindow: 1 },
  ingestionSeen: true,
  attributionWindowDays: 30,
  sessionAnchor: false,
};

/** The cached Shopify block (kpi-cache loadKpiShopifyBlock): the code lookup and the campaign funnel. */
export const SAMPLE_SHOPIFY = {
  revenue: {
    revenueAmount: 1360.4,
    currency: "EUR",
    orderCount: 3,
    shopifyConfigured: true,
    codesChecked: 18,
    redemptionUnknown: 0,
    codesInScope: 18,
    sampled: false,
    redemptions: [
      // Already in the ledger (code) — counted once, from the ledger.
      { code: "MK-HERBST-01", orderName: "#1031", createdAt: "2026-08-20T10:00:00.000Z", amount: 420.4, currency: "EUR", financialStatus: "PAID" },
      { code: "ms5-a7q2", orderName: "#1029", createdAt: "2026-08-17T10:00:00.000Z", amount: 340, currency: "EUR", financialStatus: "PAID" },
      // Before the webhook registration — the code complement.
      { code: "MK-HERBST-03", orderName: "#1019", createdAt: "2026-08-10T15:00:00.000Z", amount: 300, currency: "EUR", financialStatus: "PAID" },
    ],
    range: SAMPLE_PERIOD,
  },
  campaign: {
    sent: 30,
    sentViaEmail: 30,
    sentViaCopy: 0,
    trackedSends: 30,
    clicked: 10,
    clickRate: 0.333,
    byLanguage: { de: 30, en: 0, unknown: 0 },
    shopifyConfigured: true,
    converted: 4,
    conversionRate: 0.133,
    codesChecked: 30,
    redemptionUnknown: 0,
    sampled: false,
    revenueEur: 1340.4,
    bundleSends: 4,
  },
  fetchedAt: "2026-09-09T05:58:00.000Z",
};

/** MK codes → campaign (business-snapshot.ts loadCampaignCodes). */
export const SAMPLE_CAMPAIGN_CODES = [
  { code: "MK-HERBST-01", campaignId: 3, name: "Herbst-Kraftraum", kind: "segment" },
  { code: "MK-HERBST-02", campaignId: 3, name: "Herbst-Kraftraum", kind: "segment" },
  { code: "MK-HERBST-03", campaignId: 3, name: "Herbst-Kraftraum", kind: "segment" },
  { code: "MK-EINZEL-01", campaignId: 1, name: "Einzelansprache", kind: "einzel" },
  { code: "MK-EINZEL-00", campaignId: 1, name: "Einzelansprache", kind: "einzel" },
  { code: "MK-SOMMER-01", campaignId: 2, name: "Sommer-Ausdauer", kind: "segment" },
  { code: "MK-SOMMER-02", campaignId: 2, name: "Sommer-Ausdauer", kind: "segment" },
];

/** getJourneyCounts(range) — kpi-journey-store JourneyCounts. */
function journey(o) {
  return {
    chats: o.chats,
    shown: o.shown,
    clicked: o.clicked,
    cart: o.cart,
    ordered: o.ordered,
    orderedAny: o.orderedAny,
    orderedOrders: o.orderedAny,
    revenue: o.revenue,
    productClicks: o.productClicks,
    cartClicks: o.cartClicks,
  };
}

function core(o) {
  return {
    totalChats: o.chats,
    chatsByDay: [],
    windowDays: 30,
    avgMessagesPerChat: o.avgMessages,
    status: { active: o.chats - o.abandoned, abandoned: o.abandoned, converted: 0 },
    abandonedRate: o.abandoned / o.chats,
    productCtaClicks: o.clicks,
    addToCartClicks: o.cart,
    productCtaRatePerChat: o.clicks / o.chats,
    addToCartRatePerChat: o.cart / o.chats,
    sessionsWithTelemetry: o.reach,
    openedSessions: o.opened,
    wroteSessions: o.wrote,
    chatsWithMessages: o.chats,
    engagementRate: o.wrote / o.opened,
    topEvents: [],
  };
}

function account(o) {
  return {
    signins: o.signins,
    silentSignins: 1,
    linkedSignins: o.signin + o.shop,
    refusedLinks: o.refused,
    exports: o.exports,
    erasures: o.erasures,
    contactFormSubmissions: o.contact,
    contactOrderSupport: 1,
    contactWithSession: o.contact,
    summaryDownloads: 2,
    summaryEmails: 9,
    linkedSessions: { signin: o.signin, shop: o.shop, renewedOnly: 2 },
    shopRecognition: {
      recognised: o.recognised,
      recognisedNew: o.recognised - 3,
      withToken: 2,
      withCode: o.withCode,
      redeemed: o.redeemed,
      refused: 0,
      flagOff: 0,
      noProof: 1,
      handover: 0,
      codeFailed: 0,
      rates: { redeemRate: o.redeemed / o.withCode, alarm: false },
    },
  };
}

function consentGate(o) {
  return {
    total: { shown: o.shown, accepted: o.accepted, declined: o.declined, dismissed: 4 },
    bySurface: {
      chat: { shown: 0, accepted: 0, declined: 0, dismissed: 0 },
      signin: { shown: o.shown, accepted: o.accepted, declined: o.declined, dismissed: 4 },
    },
    signinByWay: {
      signin: { shown: o.wayShown[0], accepted: o.wayAccepted[0], declined: 3, optedIn: o.wayOpted[0] },
      shop: { shown: o.wayShown[1], accepted: o.wayAccepted[1], declined: 2, optedIn: o.wayOpted[1] },
      unknown: { shown: 0, accepted: 0, declined: 0, optedIn: 0 },
    },
    byVariant: o.variants ?? [],
  };
}

function capture(o) {
  return {
    askShown: o.asked,
    submitted: o.submitted,
    marketingOptedIn: o.opted,
    doiSent: o.doiSent,
    doiNotSent: 0,
    alreadySubscribed: 2,
    suppressed: 0,
    confirmed: o.confirmed,
    declined: 6,
    submitRate: o.submitted / o.asked,
    doiRate: o.confirmed / o.doiSent,
    asksByTrigger: [],
  };
}

export const SAMPLE_SNAPSHOT_RAW = {
  generatedAt: "2026-09-09T06:00:00.000Z",
  period: SAMPLE_PERIOD,
  previous: SAMPLE_PREVIOUS,
  cur: {
    core: core({ chats: 96, avgMessages: 7.4, abandoned: 21, clicks: 58, cart: 9, reach: 1840, opened: 212, wrote: 101 }),
    journey: journey({ chats: 88, shown: 61, clicked: 30, cart: 9, ordered: 5, orderedAny: 8, revenue: 6100.5, productClicks: 58, cartClicks: 9 }),
    reportKpis: { conversations: 96, analyzed: 74, withError: 3, emailCaptured: 18, cartUsed: 7, checkoutOffered: 61 },
    pageContext: { sessions: 34, resolved: 29, byLocale: {}, pcts: [0], arms: {}, excluded: {}, primary: null, progress: null },
    locales: { chats: [{ locale: "de", count: 88 }, { locale: "en", count: 8 }], captures: [] },
    loginGate: { shown: 140, clicked: 31, declined: 52, dismissed: 40, signedIn: 22, linked: 17, rates: {}, startsBySource: { login_gate: 31, other: 12 } },
    account: account({ signins: 44, signin: 21, shop: 9, refused: 2, exports: 1, erasures: 0, contact: 6, recognised: 15, withCode: 12, redeemed: 9 }),
    consentGate: consentGate({
      shown: 30,
      accepted: 12,
      declined: 8,
      wayShown: [21, 9],
      wayAccepted: [9, 3],
      wayOpted: [8, 3],
      variants: [
        { variant: "vorteile", placement: "chat", shown: 21, accepted: 9, declined: 6, dismissed: 3, acceptedWithoutShown: 0, optedIn: 8, alreadyConfirmed: 1, doiRequired: 7, doiConfirmed: 5, variantMismatch: 0 },
        { variant: "kurz", placement: "chat", shown: 9, accepted: 3, declined: 2, dismissed: 1, acceptedWithoutShown: 0, optedIn: 3, alreadyConfirmed: 0, doiRequired: 3, doiConfirmed: 1, variantMismatch: 0 },
      ],
    }),
    capture: capture({ asked: 64, submitted: 22, opted: 14, doiSent: 12, confirmed: 8 }),
    newSubscribers: 19,
    campaigns: [
      { campaignId: 3, name: "Herbst-Kraftraum", kind: "segment", sent: 24, tracked: 24, clicked: 7, bundleClicked: 2, chatStarted: 3, unsubscribed: 1, delivered: 23, bounced: 1, complained: 0, letters: 4 },
      { campaignId: 1, name: "Einzelansprache", kind: "einzel", sent: 6, tracked: 6, clicked: 3, bundleClicked: 0, chatStarted: 1, unsubscribed: 0, delivered: 6, bounced: 0, complained: 0, letters: 0 },
    ],
    ratings: [
      { kind: "campaign", count: 5, avg: 4.2 },
      { kind: "summary", count: 3, avg: 4.7 },
    ],
    letters: { sent: 4, costCents: 424 },
    inbox: {
      kinds: [
        { kind: "kaufabsicht", created: 18, acted: 9, dismissed: 4, closedBySelf: 2, withOutcome: 9, ordersAfterActed: 3, ordersAfterDismissed: 0, revenueAfterActedCents: 189000, topDismissReason: "schon gekauft" },
        { kind: "abwanderung", created: 22, acted: 6, dismissed: 9, closedBySelf: 3, withOutcome: 6, ordersAfterActed: 1, ordersAfterDismissed: 0, revenueAfterActedCents: 42000, topDismissReason: null },
      ],
      totalCreated: 40,
      totalActed: 15,
      suggestionsMade: 21,
    },
    ledger: { orders: 118, revenueCents: 9840000, buyers: 104, newBuyers: 61, returningBuyers: 43 },
    quality: {
      total: 96,
      analyzedCount: 74,
      categories: [
        { category: "product-advice", label: "Produktberatung", count: 41 },
        { category: "sizing", label: "Größe & Maße", count: 14 },
        { category: "price/discount", label: "Preis/Rabatt", count: 9 },
      ],
      qualities: [
        { quality: "handled_well", label: "Gut gelöst", count: 44 },
        { quality: "unmet_need", label: "Offener Bedarf", count: 17 },
        { quality: "dropped_off", label: "Abgesprungen", count: 13 },
      ],
    },
    qa: { queue: { open: 7, answered: 3, published: 41, dismissed: 5 }, createdInWindow: 9, publishedInWindow: 6, medianHoursToAnswer: 30.5, medianHoursToPublish: 52, scanBacklog: 23 },
    feedback: { total: 6, withConversation: 4, withEmail: 2, byTier: [] },
    orderStatus: { lookups: 11, sessions: 8, byOutcome: [{ outcome: "ok", count: 8 }, { outcome: "not_found", count: 3 }], byTopic: [], bySource: [] },
    bundles: { created: { total: 6, pending: 0, active: 2, expired: 4, failed: 0 }, activeNow: 2, clicks: 9, clickedOffers: 4, avgDiscountPct: 0.08 },
    aiCost: {
      capturedSince: "2026-05-13T00:00:00Z",
      consultationCount: 96,
      avgCostPerConsultationEur: 0.041,
      medianCostPerConsultationEur: 0.03,
      totalSpendEur: 21.4,
      chatSpendEur: 4.1,
      adminSpendEur: 17.3,
      estimated: false,
      perCallSite: [
        { callSite: "chat", spendEur: 3.9 },
        { callSite: "customer_profile", spendEur: 7.2 },
        { callSite: "campaign_draft", spendEur: 4.4 },
        { callSite: "hero_image", spendEur: 3.1 },
        { callSite: "analytics_report", spendEur: 1.6 },
      ],
      cache: { readTokens: 410000, writeTokens: 90000, chatInputTokens: 980000, hitRate: 0.418, savedEur: 0.61 },
    },
  },
  prev: {
    core: core({ chats: 71, avgMessages: 6.9, abandoned: 19, clicks: 37, cart: 5, reach: 1610, opened: 180, wrote: 74 }),
    journey: journey({ chats: 66, shown: 40, clicked: 20, cart: 5, ordered: 3, orderedAny: 6, revenue: 3890, productClicks: 37, cartClicks: 5 }),
    reportKpis: { conversations: 71, analyzed: 66, withError: 4, emailCaptured: 15, cartUsed: 4, checkoutOffered: 40 },
    pageContext: null,
    locales: { chats: [{ locale: "de", count: 67 }, { locale: "en", count: 4 }], captures: [] },
    loginGate: { shown: 120, clicked: 22, declined: 50, dismissed: 38, signedIn: 15, linked: 9, rates: {}, startsBySource: { login_gate: 22, other: 10 } },
    account: account({ signins: 30, signin: 12, shop: 0, refused: 3, exports: 0, erasures: 1, contact: 4, recognised: 4, withCode: 3, redeemed: 2 }),
    consentGate: consentGate({
      shown: 16,
      accepted: 5,
      declined: 6,
      wayShown: [16, 0],
      wayAccepted: [5, 0],
      wayOpted: [4, 0],
    }),
    capture: capture({ asked: 58, submitted: 17, opted: 11, doiSent: 11, confirmed: 6 }),
    newSubscribers: 12,
    campaigns: [
      { campaignId: 2, name: "Sommer-Ausdauer", kind: "segment", sent: 15, tracked: 15, clicked: 3, bundleClicked: 1, chatStarted: 0, unsubscribed: 1, delivered: 15, bounced: 0, complained: 0, letters: 2 },
      { campaignId: 1, name: "Einzelansprache", kind: "einzel", sent: 4, tracked: 4, clicked: 1, bundleClicked: 0, chatStarted: 0, unsubscribed: 0, delivered: 4, bounced: 0, complained: 0, letters: 0 },
    ],
    ratings: [{ kind: "campaign", count: 2, avg: 3.5 }],
    letters: { sent: 2, costCents: 212 },
    inbox: { kinds: [], totalCreated: 0, totalActed: 0, suggestionsMade: 0 },
    ledger: { orders: 101, revenueCents: 8120000, buyers: 93, newBuyers: 58, returningBuyers: 35 },
    quality: {
      total: 71,
      analyzedCount: 66,
      categories: [
        { category: "product-advice", label: "Produktberatung", count: 33 },
        { category: "sizing", label: "Größe & Maße", count: 12 },
      ],
      qualities: [
        { quality: "handled_well", label: "Gut gelöst", count: 35 },
        { quality: "unmet_need", label: "Offener Bedarf", count: 18 },
        { quality: "dropped_off", label: "Abgesprungen", count: 13 },
      ],
    },
    qa: { queue: { open: 7, answered: 3, published: 41, dismissed: 5 }, createdInWindow: 12, publishedInWindow: 4, medianHoursToAnswer: 44, medianHoursToPublish: 70, scanBacklog: 23 },
    feedback: { total: 4, withConversation: 2, withEmail: 1, byTier: [] },
    orderStatus: null,
    bundles: { created: { total: 3, pending: 0, active: 0, expired: 3, failed: 0 }, activeNow: 2, clicks: 4, clickedOffers: 2, avgDiscountPct: 0.07 },
    aiCost: {
      capturedSince: "2026-05-13T00:00:00Z",
      consultationCount: 71,
      avgCostPerConsultationEur: 0.045,
      medianCostPerConsultationEur: 0.033,
      totalSpendEur: 16.8,
      chatSpendEur: 3.2,
      adminSpendEur: 13.6,
      estimated: false,
      perCallSite: [
        { callSite: "chat", spendEur: 3.1 },
        { callSite: "customer_profile", spendEur: 6.0 },
        { callSite: "campaign_draft", spendEur: 3.3 },
      ],
      cache: { readTokens: 300000, writeTokens: 80000, chatInputTokens: 800000, hitRate: 0.375, savedEur: 0.44 },
    },
  },
  lifetime: {
    customerBase: {
      total: 642,
      shopifyCustomers: 588,
      leads: 54,
      withMo: 131,
      shopifyWithMo: 97,
      consent: { subscribed: 212, pending: 9, unsubscribed: 31, none: 386, blocked: 4 },
      doiShare: 0.41,
      bySegment: [
        { key: "keine_bestellung", n: 54 },
        { key: "ruhen", n: 190 },
        { key: "zurueckholen", n: 121 },
        { key: "ausbauen", n: 98 },
        { key: "frisch", n: 77 },
        { key: "weiterentwickeln", n: 64 },
        { key: "ausbauen_frueh", n: 38 },
      ],
      byValueTier: [
        { key: "grossgeraet", n: 214 },
        { key: "komponente", n: 201 },
        { key: "klein", n: 173 },
      ],
      churnHigh: 88,
      profiles: { voll: 40, kauf: 0, none: 602 },
      factsComputed: 588,
    },
    moEffect: {
      mo: { n: 97, avgOrders: 1.9, aovCents: 61200, repurchaseRate: 0.38 },
      withoutMo: { n: 491, avgOrders: 1.5, aovCents: 52800, repurchaseRate: 0.29 },
      withoutMoMatched: { n: 491, avgOrders: 1.6, aovCents: 55100, repurchaseRate: 0.31 },
      lift: { avgOrders: 0.19, aovCents: 0.11, repurchaseRate: 0.23 },
      tiers: [
        { tier: "grossgeraet", mo: { n: 41, repurchaseRate: 0.34 }, withoutMo: { n: 173, repurchaseRate: 0.27 } },
        { tier: "komponente", mo: { n: 33, repurchaseRate: 0.42 }, withoutMo: { n: 168, repurchaseRate: 0.33 } },
      ],
      enough: true,
    },
    wonByMo: { n: 23, revenueCents: 1840000 },
    subscribersBySource: [
      { source: "shopify", n: 141 },
      { source: "mo_capture_form", n: 38 },
      { source: "mo_signin", n: 21 },
      { source: "import", n: 12 },
    ],
  },
  moRevenue: SAMPLE_MO_REVENUE,
  shopify: SAMPLE_SHOPIFY,
  campaignCodes: SAMPLE_CAMPAIGN_CODES,
  switches: {
    shopifyConfigured: true,
    customerSync: true,
    consentWriteback: false,
    campaignSendsApproved: true,
    campaignRelease: false,
    physicalMailApproved: true,
    appProxySignin: true,
    attributionSessionAnchor: false,
    pageContext: true,
    pageContextHoldoutPct: 0,
    chatOrderStatus: false,
    emailConfigured: true,
    anthropicConfigured: true,
  },
  releases: [
    { date: "2026-08-20", key: "sample-release", title: "Beispiel-Release", detail: "Ein Release innerhalb der beiden Zeiträume." },
  ],
  releaseNotes: {
    signin: { current: [], previous: ["Erst ab dem 04.08.2026 aussagekräftig: Beispiel."] },
  },
};

/**
 * The previous period as its own snapshot input (a report about it, without a
 * period before it) — for report-to-report comparisons.
 */
export const SAMPLE_PREVIOUS_PERIOD_RAW = {
  ...SAMPLE_SNAPSHOT_RAW,
  period: SAMPLE_PREVIOUS,
  previous: null,
  cur: SAMPLE_SNAPSHOT_RAW.prev,
  prev: null,
  moRevenue: {
    ...SAMPLE_MO_REVENUE,
    range: SAMPLE_PREVIOUS,
    previous: null,
    orders: PREVIOUS_ORDERS,
    previousOrders: [],
    ledgerCodes: ["MK-SOMMER-01", "MK-SOMMER-02", "MK-EINZEL-00", "MS5-C1D4", "MS5-D8F2"],
    ledgerOrderNames: [],
    unresolved: { unknownToken: 4, outsideWindow: 2 },
  },
  shopify: null,
};
