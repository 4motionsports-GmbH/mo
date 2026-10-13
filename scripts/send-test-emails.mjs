// Sends ONE TEST EMAIL OF EVERY REDESIGNED TYPE (summary, DOI, marketing,
// campaign) in ONE DESIGN to a given address so the design can be checked in
// a real inbox — marketing and campaign twice: as an ITEM mail (product rows +
// code) and as a SET mail (only the set; a mail is one or the other,
// offer-mode.mjs). Everything renders through the EXACT production renderers,
// inside withEmailDesign(resolveEmailDesignForKind(design, kind)) +
// withEmailRenderData like the send paths — only the data is sample data (the
// design's default hero, a sample first name), and every subject carries a
// [TEST <design>] prefix.
//
//   npx tsx --env-file=.env scripts/send-test-emails.mjs [recipient] [--design <classic|studio|performance>]
//
// (tsx because the production module graph uses extensionless TypeScript
// imports; --env-file so RESEND_API_KEY + CONTACT_FROM_EMAIL are set. The
// recipient defaults to the address below — pass another one to override.
// --design defaults to classic; send each design to a classic Outlook for
// Windows inbox to check what the Word engine makes of it — the lint in
// scripts/check-email-outlook.mjs cannot judge everything.)
//
// SAFE BY DESIGN: this script sends ONLY to the explicitly given recipient,
// touches NO database rows, mints NO discount codes (codes/links are visibly
// fake), and bypasses NONE of the production send paths — those still run
// exclusively through approveAndSend()/approveAndSendCampaign().

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// src/ is loaded through require: under tsx the TypeScript modules form one
// CommonJS graph, and an ESM `import` of one of them can create a SECOND
// instance of a module that graph already holds — the design set through
// withEmailDesign (an AsyncLocalStorage) is then invisible to the renderers
// and every mail goes out classic.
const require = createRequire(import.meta.url);
const { sendEmail, isEmailConfigured } = require("../src/lib/email.ts");
const { buildSummaryEmailContent } = require("../src/lib/summary-email.ts");
const {
  doiEmailBody,
  doiEmailSubject,
  summaryEmailSubject,
  unsubscribeFooter,
} = require("../src/lib/consent-copy.ts");
const { renderMarketingEmail } = require("../src/lib/marketing-email.ts");
const { renderCampaignEmail } = require("../src/lib/campaign-email.ts");
const { renderBundleOfferBlock } = require("../src/lib/bundle-email.ts");
const { withEmailDesign, withEmailRenderData } = require("../src/lib/email-design-context.ts");
const {
  designSupportsKind,
  listEmailDesignMeta,
  resolveEmailDesignForKind,
} = require("../src/lib/email-designs/registry.ts");

// Arguments: `--design <key>` (or `--design=<key>`) anywhere; the first other
// argument is the recipient.
const args = process.argv.slice(2);
let DESIGN = "classic";
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--design") DESIGN = args[++i] ?? "";
  else if (args[i].startsWith("--design=")) DESIGN = args[i].slice("--design=".length);
  else positional.push(args[i]);
}
const RECIPIENT = positional[0] || "marcel@marcelkueck.dev";

const designKeys = listEmailDesignMeta().map((d) => d.key);
if (!designKeys.includes(DESIGN)) {
  console.error(`Unknown design "${DESIGN}" — use one of: ${designKeys.join(", ")}.`);
  process.exit(1);
}

if (!isEmailConfigured()) {
  console.error(
    "RESEND_API_KEY / CONTACT_FROM_EMAIL not set — run with `--env-file=.env`."
  );
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const catalog = JSON.parse(
  await readFile(path.join(ROOT, "src/data/product-catalog.json"), "utf8")
);
const withImages = catalog.filter(
  (p) =>
    Array.isArray(p.images) &&
    p.images.some((u) => typeof u === "string" && u.startsWith("https://"))
);
if (withImages.length < 7) {
  console.error("Catalog has too few products with images for a representative test.");
  process.exit(1);
}
// One WebP picture at position 3 (summary alternatives, both item mails and
// the campaign set): about 40 % of the catalogue's pictures are WebP, which
// older Outlook builds cannot show — the real-inbox check must include one.
const isWebp = (p) => /\.webp(?:[?#]|$)/i.test(p.images.find((u) => u.startsWith("https://")) ?? "");
const webpAt = withImages.findIndex(isWebp);
if (webpAt > 6) withImages.splice(2, 0, ...withImages.splice(webpAt, 1));

// Inert links: the unsubscribe/confirm pages will show their "invalid link"
// screens if clicked — nothing can be (un)subscribed by accident.
const FAKE_UNSUBSCRIBE_URL = "https://motionsports.de/api/unsubscribe?token=TEST";
const FAKE_CONFIRM_URL = "https://motionsports.de/api/confirm-marketing?token=TEST";
const SHOP_URL = "https://motionsports.de";
// What the send paths pass as the recipient's first name (hero designs greet
// with it); no hero image → the design's default hero, as for a send without one.
const SAMPLE_RENDER_DATA = { recipientFirstName: "Anna-Sophie" };

const firstImage = (p) => p.images.find((u) => u.startsWith("https://")) ?? null;
const unitPrice = (p) =>
  typeof p.salePrice === "number" && p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price;
const inFourDays = () => new Date(Date.now() + 4 * 86_400_000).toISOString();

/**
 * A sample set block: the products (the first twice) with their current price
 * as the snapshot unit price; `discount` (0…1) below the component sum, 0 =
 * the set costs exactly its parts (no strike, no saving — the PAngV guard).
 * Call it INSIDE the design (render()): the block is rendered through the
 * design's renderers, as on the send paths.
 */
function sampleSet(products, { discount, language = "de" }) {
  const components = products.map((p, i) => ({
    name: p.name,
    imageUrl: firstImage(p),
    quantity: i === 0 ? 2 : 1,
    unitPrice: unitPrice(p).toFixed(2),
    description: p.shortDescription ?? null,
  }));
  const sumCents = components.reduce((n, c) => n + Math.round(Number(c.unitPrice) * 100) * c.quantity, 0);
  const priceCents = discount > 0 ? Math.floor((sumCents * (1 - discount)) / 100) * 100 - 10 : sumCents;
  const block = renderBundleOfferBlock({
    title: language === "en" ? "Your home gym set" : "Dein Home-Gym-Set",
    components,
    bundlePrice: (priceCents / 100).toFixed(2),
    componentsSum: (sumCents / 100).toFixed(2),
    offerUrl: SHOP_URL,
    language,
  });
  return { ...block, expiresAt: inFourDays() };
}

const results = [];
/**
 * Render `render()` inside the chosen design for `kind` and send it. A design
 * without a variant for the kind is skipped (the settings never offer it).
 */
async function sendTest(label, kind, subject, render) {
  if (!designSupportsKind(DESIGN, kind)) {
    console.log(`– ${label} skipped (design "${DESIGN}" has no ${kind} mail)`);
    return;
  }
  const { text, html } = await withEmailDesign(resolveEmailDesignForKind(DESIGN, kind), () =>
    withEmailRenderData(SAMPLE_RENDER_DATA, render)
  );
  const result = await sendEmail({
    to: RECIPIENT,
    subject: `[TEST ${DESIGN}] ${subject}`,
    text,
    html,
    kind: "design-test",
  });
  results.push({ label, result });
  console.log(
    result.ok ? `✓ ${label} sent (id ${result.id ?? "?"})` : `✗ ${label} FAILED`,
    result.ok ? "" : JSON.stringify(result)
  );
}

// --- 1. Conversation summary (transactional) ---------------------------------
await sendTest("summary", "summary", summaryEmailSubject("de"), () =>
  buildSummaryEmailContent({
    summary:
      "Du suchst eine kompakte Ausstattung für dein Heimstudio mit Fokus auf " +
      "Krafttraining auf begrenzter Fläche. Wir haben passende Hantelscheiben " +
      "und ergänzendes Zubehör besprochen, die leise und platzsparend sind.",
    chosenProducts: withImages.slice(0, 2),
    alternatives: withImages.slice(2, 5),
    cartUrl: SHOP_URL,
  })
);

// --- 2. Double-opt-in confirmation --------------------------------------------
await sendTest("doi", "doi", doiEmailSubject("de"), () => doiEmailBody(FAKE_CONFIRM_URL, "de"));

// --- 3. Marketing ITEM mail (product rows + cart + code note) -----------------
await sendTest(
  "marketing (Einzelprodukte)",
  "marketing",
  "Deine persönliche Empfehlung von motion sports",
  () =>
    renderMarketingEmail({
      subject: "Deine persönliche Empfehlung von motion sports",
      body:
        "Hallo,\n\nvielen Dank für dein Gespräch mit Mo! Basierend auf deiner " +
        "Beratung haben wir eine persönliche Auswahl für dich zusammengestellt — " +
        "inklusive einem kleinen Dankeschön: 10 % auf deinen vorbereiteten Warenkorb.",
      linkUrl: SHOP_URL,
      products: withImages.slice(0, 4),
      discountCode: "MS5-TEST123",
      discountExpiresLabel: "31.12.2026",
      discountExpiresAt: inFourDays(),
      unsubscribe: unsubscribeFooter(FAKE_UNSUBSCRIBE_URL),
      bundle: null,
    })
);

// --- 4. Marketing SET mail (only the set; no saving → no strike, PAngV guard) -
await sendTest(
  "marketing (Set, ohne Ersparnis)",
  "marketing",
  "Dein persönliches Set von motion sports",
  () =>
    renderMarketingEmail({
      subject: "Dein persönliches Set von motion sports",
      body:
        "Hallo,\n\nvielen Dank für dein Gespräch mit Mo! Passend zu deiner Beratung " +
        "haben wir dir ein Set zusammengestellt.",
      linkUrl: null,
      products: [],
      discountCode: null,
      discountExpiresLabel: null,
      unsubscribe: unsubscribeFooter(FAKE_UNSUBSCRIBE_URL),
      bundle: sampleSet(withImages.slice(4, 7), { discount: 0 }),
    })
);

// --- 5. Campaign ITEM mail (product rows + coupon + Mo promo) -----------------
await sendTest(
  "campaign (Einzelprodukte)",
  "campaign",
  "Deine persönliche Empfehlung von motion sports",
  () =>
    renderCampaignEmail({
      subject: "Deine persönliche Empfehlung von motion sports",
      body:
        "Hallo,\n\nschön, dass du wieder da bist! Seit deinem letzten Einkauf gibt " +
        "es einige Neuheiten, die zu deinem Training passen könnten. Mo, unser " +
        "digitaler Berater, stellt dir in wenigen Minuten eine persönliche " +
        "Empfehlung zusammen.",
      language: "de",
      products: withImages.slice(2, 5),
      discountCode: "MK-TEST123",
      discountExpiresLabel: "31.12.2026",
      discountExpiresAt: inFourDays(),
      discountPercent: 5,
      unsubscribe: unsubscribeFooter(FAKE_UNSUBSCRIBE_URL),
      bundle: null,
    })
);

// --- 6. Campaign SET mail (only the set, genuine saving + Mo promo) -----------
await sendTest(
  "campaign (Set, mit Ersparnis)",
  "campaign",
  "Dein persönliches Set von motion sports",
  () =>
    renderCampaignEmail({
      subject: "Dein persönliches Set von motion sports",
      body:
        "Hallo,\n\nschön, dass du wieder da bist! Passend zu deinem letzten Einkauf " +
        "haben wir dir ein Set zusammengestellt — zusammen günstiger als einzeln.",
      language: "de",
      discountCode: null,
      discountExpiresLabel: null,
      unsubscribe: unsubscribeFooter(FAKE_UNSUBSCRIBE_URL),
      bundle: sampleSet(withImages.slice(0, 3), { discount: 0.15 }),
    })
);

const failed = results.filter((r) => !r.result.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} test emails (design ${DESIGN}) sent to ${RECIPIENT}.`
);
process.exit(failed.length ? 1 : 0);
