// Sends ONE TEST EMAIL OF EVERY REDESIGNED TYPE (summary, DOI, marketing,
// campaign) to a given address so the new newsletter design can be checked in
// a real inbox. Everything renders through the EXACT production renderers —
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
if (withImages.length < 6) {
  console.error("Catalog has too few products with images for a representative test.");
  process.exit(1);
}

// Inert links: the unsubscribe/confirm pages will show their "invalid link"
// screens if clicked — nothing can be (un)subscribed by accident.
const FAKE_UNSUBSCRIBE_URL = "https://motionsports.de/api/unsubscribe?token=TEST";
const FAKE_CONFIRM_URL = "https://motionsports.de/api/confirm-marketing?token=TEST";
const SHOP_URL = "https://motionsports.de";

const firstImage = (p) => p.images.find((u) => u.startsWith("https://")) ?? null;

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

// --- 3. Personalised marketing email (grid + bundle + discount note) ----------
{
  const products = withImages.slice(0, 4);
  const bundleComponents = withImages.slice(4, 6);
  const bundle = renderBundleOfferBlock({
    title: "Dein persönliches Home-Gym Set",
    components: bundleComponents.map((p) => ({ name: p.name, imageUrl: firstImage(p) })),
    bundlePrice: 899,
    componentsSum: 998,
    offerUrl: SHOP_URL,
  });
  const { text, html } = renderMarketingEmail({
    subject: "Deine persönliche Empfehlung von motion sports",
    body:
      "Hallo,\n\nvielen Dank für dein Gespräch mit Mo! Basierend auf deiner " +
      "Beratung haben wir eine persönliche Auswahl für dich zusammengestellt — " +
      "inklusive einem kleinen Dankeschön: 10 % auf deinen vorbereiteten Warenkorb.",
    linkUrl: SHOP_URL,
    products,
    discountCode: "MS5-TEST123",
    discountExpiresLabel: "31.12.2026",
    unsubscribe: unsubscribeFooter(FAKE_UNSUBSCRIBE_URL),
    bundle,
  });
  await sendTest("marketing", {
    subject: "Deine persönliche Empfehlung von motion sports",
    text,
    html,
  });
}

// --- 4. Campaign email (prose + bundle + Mo promo + discount note) ------------
{
  const bundleComponents = withImages.slice(0, 2);
  const bundle = renderBundleOfferBlock({
    title: "Dein persönliches Set",
    components: bundleComponents.map((p) => ({ name: p.name, imageUrl: firstImage(p) })),
    bundlePrice: 449,
    componentsSum: 449, // equal sum → no strike line (PAngV guard visible in test)
    offerUrl: SHOP_URL,
  });
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
    unsubscribe: unsubscribeFooter(FAKE_UNSUBSCRIBE_URL),
    bundle,
  });
  await sendTest("campaign", {
    subject: "Deine persönliche Empfehlung von motion sports",
    text,
    html,
  });
}

const failed = results.filter((r) => !r.result.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} test emails sent to ${RECIPIENT}.`
);
process.exit(failed.length ? 1 : 0);
