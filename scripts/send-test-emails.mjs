// Sends ONE TEST EMAIL OF EVERY REDESIGNED TYPE (summary, DOI, marketing,
// campaign) to a given address so the new newsletter design can be checked in
// a real inbox — marketing and campaign twice: as an ITEM mail (product rows +
// code) and as a SET mail (only the set; a mail is one or the other,
// offer-mode.mjs). Everything renders through the EXACT production renderers —
// only the data is sample data, and every subject carries a [TEST] prefix.
//
//   npx tsx --env-file=.env scripts/send-test-emails.mjs [recipient]
//
// (tsx because the production module graph uses extensionless TypeScript
// imports; --env-file so RESEND_API_KEY + CONTACT_FROM_EMAIL are set. The
// recipient defaults to the address below — pass another one to override.)
//
// SAFE BY DESIGN: this script sends ONLY to the explicitly given recipient,
// touches NO database rows, mints NO discount codes (codes/links are visibly
// fake), and bypasses NONE of the production send paths — those still run
// exclusively through approveAndSend()/approveAndSendCampaign().

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sendEmail, isEmailConfigured } from "../src/lib/email.ts";
import { buildSummaryEmailContent } from "../src/lib/summary-email.ts";
import {
  doiEmailBody,
  doiEmailSubject,
  summaryEmailSubject,
  unsubscribeFooter,
} from "../src/lib/consent-copy.ts";
import { renderMarketingEmail } from "../src/lib/marketing-email.ts";
import { renderCampaignEmail } from "../src/lib/campaign-email.ts";
import { renderBundleOfferBlock } from "../src/lib/bundle-email.ts";

const RECIPIENT = process.argv[2] || "marcel@marcelkueck.dev";

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

// Inert links: the unsubscribe/confirm pages will show their "invalid link"
// screens if clicked — nothing can be (un)subscribed by accident.
const FAKE_UNSUBSCRIBE_URL = "https://motionsports.de/api/unsubscribe?token=TEST";
const FAKE_CONFIRM_URL = "https://motionsports.de/api/confirm-marketing?token=TEST";
const SHOP_URL = "https://motionsports.de";

const firstImage = (p) => p.images.find((u) => u.startsWith("https://")) ?? null;
const unitPrice = (p) =>
  typeof p.salePrice === "number" && p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price;
const inFourDays = () => new Date(Date.now() + 4 * 86_400_000).toISOString();

/**
 * A sample set block: the products (the first twice) with their current price
 * as the snapshot unit price; `discount` (0…1) below the component sum, 0 =
 * the set costs exactly its parts (no strike, no saving — the PAngV guard).
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
async function sendTest(label, { subject, text, html }) {
  const result = await sendEmail({
    to: RECIPIENT,
    subject: `[TEST] ${subject}`,
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
{
  const chosenProducts = withImages.slice(0, 2);
  const alternatives = withImages.slice(2, 5);
  const { text, html } = buildSummaryEmailContent({
    summary:
      "Du suchst eine kompakte Ausstattung für dein Heimstudio mit Fokus auf " +
      "Krafttraining auf begrenzter Fläche. Wir haben passende Hantelscheiben " +
      "und ergänzendes Zubehör besprochen, die leise und platzsparend sind.",
    chosenProducts,
    alternatives,
    cartUrl: SHOP_URL,
  });
  await sendTest("summary", { subject: summaryEmailSubject("de"), text, html });
}

// --- 2. Double-opt-in confirmation --------------------------------------------
{
  const { text, html } = doiEmailBody(FAKE_CONFIRM_URL, "de");
  await sendTest("doi", { subject: doiEmailSubject("de"), text, html });
}

// --- 3. Marketing ITEM mail (product rows + cart + code note) -----------------
{
  const { text, html } = renderMarketingEmail({
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
  });
  await sendTest("marketing (Einzelprodukte)", {
    subject: "Deine persönliche Empfehlung von motion sports",
    text,
    html,
  });
}

// --- 4. Marketing SET mail (only the set; no saving → no strike, PAngV guard) -
{
  const { text, html } = renderMarketingEmail({
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
  });
  await sendTest("marketing (Set, ohne Ersparnis)", {
    subject: "Dein persönliches Set von motion sports",
    text,
    html,
  });
}

// --- 5. Campaign ITEM mail (product rows + coupon + Mo promo) -----------------
{
  const { text, html } = renderCampaignEmail({
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
  });
  await sendTest("campaign (Einzelprodukte)", {
    subject: "Deine persönliche Empfehlung von motion sports",
    text,
    html,
  });
}

// --- 6. Campaign SET mail (only the set, genuine saving + Mo promo) -----------
{
  const { text, html } = renderCampaignEmail({
    subject: "Dein persönliches Set von motion sports",
    body:
      "Hallo,\n\nschön, dass du wieder da bist! Passend zu deinem letzten Einkauf " +
      "haben wir dir ein Set zusammengestellt — zusammen günstiger als einzeln.",
    language: "de",
    discountCode: null,
    discountExpiresLabel: null,
    unsubscribe: unsubscribeFooter(FAKE_UNSUBSCRIBE_URL),
    bundle: sampleSet(withImages.slice(0, 3), { discount: 0.15 }),
  });
  await sendTest("campaign (Set, mit Ersparnis)", {
    subject: "Dein persönliches Set von motion sports",
    text,
    html,
  });
}

const failed = results.filter((r) => !r.result.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} test emails sent to ${RECIPIENT}.`
);
process.exit(failed.length ? 1 : 0);
