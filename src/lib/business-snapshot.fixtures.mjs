// A realistic raw input for buildBusinessSnapshot() — the shape business-
// snapshot.ts collects from the store getters — used by the node:test suites
// of the snapshot, the report synthesis and the PDF. Numbers are invented but
// consistent (the funnels narrow, rates match their counts).

export const SAMPLE_PERIOD = { from: "2026-08-10", to: "2026-09-08", days: 30, label: "10.08.2026 – 08.09.2026" };
export const SAMPLE_PREVIOUS = { from: "2026-07-11", to: "2026-08-09", days: 30, label: "11.07.2026 – 09.08.2026" };

function attribution(direct, assisted, influenced, extra = {}) {
  return {
    direct: { orderCount: direct[0], revenueAmount: direct[1] },
    assisted: { orderCount: assisted[0], revenueAmount: assisted[1] },
    influenced: { orderCount: influenced[0], revenueAmount: influenced[1] },
    unrealisedOrders: extra.unrealised ?? 0,
    currency: "EUR",
    totalOrders: direct[0] + assisted[0] + influenced[0] + (extra.unrealised ?? 0),
    ingestionSeen: true,
    attributionWindowDays: 30,
    unresolvedOrders: { unknownToken: extra.unknownToken ?? 0, outsideWindow: extra.outsideWindow ?? 0 },
    sessionAnchor: false,
    range: { from: "", to: "", days: 30, label: "" },
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
    attribution: attribution([14, 9120.4], [3, 1890.0], [5, 4210.5], { unrealised: 2, unknownToken: 2, outsideWindow: 1 }),
    ordersBySource: [
      { source: "bundle", orders: 4, revenue: 5120.0 },
      { source: "discount_code", orders: 6, revenue: 1980.4 },
      { source: "summary_email", orders: 2, revenue: 1210.0 },
      { source: "marketing_email", orders: 2, revenue: 810.0 },
      { source: "widget", orders: 8, revenue: 6100.5 },
    ],
    codeOrders: { ms5: { orders: 2, revenue: 640.0 }, mk: { orders: 4, revenue: 1340.4 } },
    core: core({ chats: 96, avgMessages: 7.4, abandoned: 21, clicks: 58, cart: 9, reach: 1840, opened: 212, wrote: 101 }),
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
    }),
    capture: capture({ asked: 64, submitted: 22, opted: 14, doiSent: 12, confirmed: 8 }),
    newSubscribers: 19,
    campaigns: [
      { campaignId: 3, name: "Herbst-Kraftraum", kind: "segment", sent: 24, tracked: 24, clicked: 7, bundleClicked: 2, chatStarted: 3, unsubscribed: 1, delivered: 23, bounced: 1, complained: 0, moOrders: 3, moRevenue: 1040.4, letters: 4 },
      { campaignId: 1, name: "Einzelansprache", kind: "einzel", sent: 6, tracked: 6, clicked: 3, bundleClicked: 0, chatStarted: 1, unsubscribed: 0, delivered: 6, bounced: 0, complained: 0, moOrders: 1, moRevenue: 300.0, letters: 0 },
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
    attribution: attribution([10, 6230.0], [2, 980.0], [4, 2910.0], { unrealised: 1, unknownToken: 4, outsideWindow: 2 }),
    ordersBySource: [
      { source: "bundle", orders: 2, revenue: 2268.65 },
      { source: "discount_code", orders: 5, revenue: 1420.0 },
      { source: "widget", orders: 6, revenue: 3890.0 },
      { source: "summary_email", orders: 2, revenue: 617.24 },
      { source: "marketing_email", orders: 1, revenue: 924.11 },
    ],
    codeOrders: { ms5: { orders: 2, revenue: 610.0 }, mk: { orders: 3, revenue: 810.0 } },
    core: core({ chats: 71, avgMessages: 6.9, abandoned: 19, clicks: 37, cart: 5, reach: 1610, opened: 180, wrote: 74 }),
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
      { campaignId: 2, name: "Sommer-Ausdauer", kind: "segment", sent: 15, tracked: 15, clicked: 3, bundleClicked: 1, chatStarted: 0, unsubscribed: 1, delivered: 15, bounced: 0, complained: 0, moOrders: 2, moRevenue: 610.0, letters: 2 },
      { campaignId: 1, name: "Einzelansprache", kind: "einzel", sent: 4, tracked: 4, clicked: 1, bundleClicked: 0, chatStarted: 0, unsubscribed: 0, delivered: 4, bounced: 0, complained: 0, moOrders: 1, moRevenue: 200.0, letters: 0 },
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
  shopify: null,
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
