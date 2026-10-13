// The Outlook for Windows check: renders EVERY mail Mo sends — summary, DOI,
// marketing and campaign (each as item mail and as set mail) in EVERY design
// of the registry, plus the Korrespondenz mail — and runs the Word-engine lint
// (lintOutlookHtml, src/lib/email-outlook.mjs) over each render. Exits 1 on
// any finding (a mail over MAIL_SIZE_BUDGET_BYTES is one: Gmail clips at
// 102 KB and the unsubscribe footer would vanish).
//
//   npx tsx scripts/check-email-outlook.mjs [--verbose] [--out <dir>]
//   npm run check:email-outlook
//
// --verbose prints every finding with the offending markup; --out writes each
// render as <design>-<kind>.html (open it in a browser, or put a design into a
// real Outlook inbox with scripts/send-test-emails.mjs --design <key>).
//
// The renders go through renderEmailDesignPreview — the production composers
// inside withEmailDesign(resolveEmailDesignForKind(...)) + withEmailRenderData,
// with sample data from the catalog: byte-for-byte what the Einstellungen
// preview shows, through the same code a real send runs. Nothing is sent,
// stored or minted. (tsx because the production module graph uses
// extensionless TypeScript imports.)
//
// The lint cannot see images: .webp/.avif sources are listed as info lines,
// per mail and as the share of catalog product images (classic Outlook
// 2007–2019 cannot show WebP; newer Microsoft 365 builds may) — they do not
// fail the check.

import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { lintOutlookHtml, MAIL_SIZE_BUDGET_BYTES } from "../src/lib/email-outlook.mjs";

const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const outIndex = args.indexOf("--out");
const OUT_DIR = outIndex >= 0 ? args[outIndex + 1] : null;
if (outIndex >= 0 && !OUT_DIR) {
  console.error("--out needs a directory");
  process.exit(2);
}

// The countdown block renders only with a signing secret (the unsubscribe
// links use the same one, so production always has it). A placeholder keeps
// the countdown in the check without a .env; it signs nothing that leaves
// this process.
if (!process.env.UNSUBSCRIBE_SECRET && !process.env.CHAT_SHARED_SECRET) {
  process.env.UNSUBSCRIBE_SECRET = "check-email-outlook";
}

// The TypeScript modules are loaded through require (after the env above):
// under tsx they form one CommonJS graph, and an ESM `import` of one of them
// can create a SECOND instance of a module that graph already holds — the
// design and render data (AsyncLocalStorage) would then not reach the
// renderers.
const require = createRequire(import.meta.url);
const { renderEmailDesignPreview } = require("../src/lib/email-design-preview.ts");
const { listEmailDesignMeta, resolveEmailDesignForKind } = require("../src/lib/email-designs/registry.ts");
const { renderCorrespondenceEmail } = require("../src/lib/correspondence-email.ts");
const { loadProductCatalog } = require("../src/lib/catalog-store.ts");
const { firstProductImageUrl } = require("../src/lib/email-products.ts");

/** The widest image each layout has room for — Word sizes an <img> by its width attribute. */
const MAX_IMAGE_WIDTH = { performance: 564 };
const DEFAULT_MAX_IMAGE_WIDTH = 480;

const CORRESPONDENCE_SAMPLE =
  "Hallo Anna-Sophie,\n\n" +
  "danke für deine Nachricht! Die Hantelscheiben sind ab Montag wieder auf Lager — " +
  "ich lege dir gern ein Paar zurück.\n\n" +
  "Viele Grüße\nMo von motion sports";

/** @type {Array<{ name: string, html: string, maxImageWidth: number }>} */
const mails = [];
for (const meta of listEmailDesignMeta()) {
  const maxImageWidth = MAX_IMAGE_WIDTH[meta.key] ?? DEFAULT_MAX_IMAGE_WIDTH;
  for (const kind of meta.supportedKinds) {
    const samples = kind === "marketing" || kind === "campaign" ? ["items", "set"] : ["items"];
    for (const sample of samples) {
      const name = `${meta.key}-${kind}${samples.length > 1 ? `-${sample}` : ""}`;
      try {
        const html = await renderEmailDesignPreview(kind, resolveEmailDesignForKind(meta.key, kind), sample);
        mails.push({ name, html, maxImageWidth });
      } catch (err) {
        console.error(`✗ ${name}: render failed —`, err);
        process.exitCode = 1;
      }
    }
  }
}
mails.push({
  name: "korrespondenz",
  html: renderCorrespondenceEmail(CORRESPONDENCE_SAMPLE).html,
  maxImageWidth: DEFAULT_MAX_IMAGE_WIDTH,
});

const isModernImage = (url) => /\.(?:webp|avif)(?:[?#]|$)/i.test(url);

/** Distinct image URLs that are WebP/AVIF (img src, VML src, background attributes and CSS url()). */
function modernImageUrls(html) {
  const urls = new Set();
  for (const m of html.matchAll(/\s(?:src|background)\s*=\s*"([^"]+)"|url\(\s*['"]?([^'")\s]+)/gi)) {
    const url = (m[1] ?? m[2]).replace(/&amp;/g, "&");
    if (isModernImage(url)) urls.add(url);
  }
  return [...urls];
}

// The sample mails show only a few products; the share over the whole
// catalog (the image a mail uses: firstProductImageUrl) says how many real
// product cards would be affected.
const catalogImages = (await loadProductCatalog()).map(firstProductImageUrl).filter(Boolean);
const catalogModern = catalogImages.filter(isModernImage).length;

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const nameWidth = Math.max(...mails.map((m) => m.name.length));
const infos = [];
let findingCount = 0;
let failingMails = 0;

if (OUT_DIR) mkdirSync(OUT_DIR, { recursive: true });
console.log(`Outlook for Windows check — ${mails.length} mails, lintOutlookHtml, size budget ${kb(MAIL_SIZE_BUDGET_BYTES)}\n`);
console.log(`${"mail".padEnd(nameWidth)}  ${"size".padStart(8)}  findings`);
for (const mail of mails) {
  const bytes = Buffer.byteLength(mail.html);
  const findings = lintOutlookHtml(mail.html, { maxImageWidth: mail.maxImageWidth });
  const byRule = new Map();
  for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  const summary = findings.length
    ? `${findings.length}  ${[...byRule].map(([rule, n]) => (n > 1 ? `${rule}×${n}` : rule)).join(" ")}`
    : "ok";
  console.log(`${mail.name.padEnd(nameWidth)}  ${kb(bytes).padStart(8)}  ${summary}`);
  if (VERBOSE) {
    for (const f of findings) console.log(`    ${f.rule}: ${f.message}\n      ${f.excerpt}`);
  }
  findingCount += findings.length;
  if (findings.length) failingMails++;
  const modern = modernImageUrls(mail.html);
  if (modern.length) infos.push(`${mail.name}: ${modern.length} WebP/AVIF image(s)${VERBOSE ? `\n      ${modern.join("\n      ")}` : ""}`);
  if (OUT_DIR) writeFileSync(path.join(OUT_DIR, `${mail.name}.html`), mail.html);
}

if (infos.length || catalogModern) {
  console.log("\ninfo — WebP/AVIF images (classic Outlook 2007–2019 cannot show them, newer Microsoft 365 builds may; check in a real Outlook):");
  console.log(`  catalog: ${catalogModern} of ${catalogImages.length} product images used in mails`);
  for (const line of infos) console.log(`  ${line}`);
}
if (OUT_DIR) console.log(`\nRenders written to ${path.resolve(OUT_DIR)}`);
if (findingCount) {
  console.log(`\n✗ ${findingCount} finding(s) in ${failingMails} of ${mails.length} mails${VERBOSE ? "" : " — --verbose shows the markup"} (rules: src/lib/email-outlook.mjs).`);
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log(`\n✓ All ${mails.length} mails pass the Outlook lint.`);
}
