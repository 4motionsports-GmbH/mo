// Random documents through the whole pipeline (normalise → render HTML in
// send and preview mode → text part): whatever the editor or the KI-Gestalter
// builds must stay Outlook-lint-clean, keep the legal footer exactly once, and
// never leak "undefined" / "NaN" into the mail. Seeded, so a failure names a
// reproducible case (FUZZ_SEED / FUZZ_RUNS override the defaults).
import { test } from "node:test";
import assert from "node:assert/strict";
import { lintOutlookHtml } from "./email-outlook.mjs";
import {
  MAIL_CHILD_BLOCK_TYPES,
  MAIL_FONT_KEYS,
  MENU_SEPARATORS,
  TEXT_BULLETS,
  applyMergeFields,
  normalizeMailTemplateDoc,
  validateMailTemplateDoc,
} from "./mail-template-doc.mjs";
import { MAIL_CARD_WIDTH, MAIL_FOOTER_MARKER, renderMailTemplateHtml, renderMailTemplateText } from "./mail-template-render.mjs";
import { FIXTURE_ASSETS, fixtureContext } from "./__fixtures__/mail-template-v1-cases.mjs";

/** The six social icons of production (email-template.ts EMAIL_SOCIAL_LINKS) — the widest icon row there is. */
const SOCIAL_LINKS = ["facebook", "instagram", "pinterest", "youtube", "tiktok", "linkedin"].map((alt) => ({ alt, icon: `https://cdn.example.com/${alt}.png`, url: `https://${alt}.com/motionsports` }));
/**
 * Custom HTML: balanced markup, and markup the fence must clean (handlers
 * after "/" or a quoted value, raw-text tags, an unterminated comment,
 * script URLs) — every one of them lint-clean and harmless once sanitized.
 */
const HTML_SNIPPETS = [
  (w) => `<table role="presentation" width="100%"><tr><td style="padding: 8px;"><a href="https://www.motionsports.de/">${w}</a></td></tr></table>`,
  (w) => `<p style='color:#ffffff'>${w} <a href='https://motionsports.de/pages/faq'>FAQ</a></p>`,
  (w) => `<details/open/ontoggle="alert(1)"><summary>${w}</summary>Info</details>`,
  (w) => `<p>${w}</p><img/src="https://x.de/a.png"/onload="alert(1)" width="120" alt="a"><a href="java&#x09;script:alert(1)"onclick="x()">x</a>`,
  (w) => `<p>${w}</p><noembed>`,
  (w) => `<p>${w}</p><!--[if mso]><table><tr><td>`,
  (w) => `<div style="background-image:image-set('https://evil.example/x.gif' 1x)"><p>${w}</p></div><a href=https://x.de/b?c=1 ping=https://evil.example/p>b</a>`,
];

const SEED = Number(process.env.FUZZ_SEED ?? 20261111);
const RUNS = Number(process.env.FUZZ_RUNS ?? 160);

/** mulberry32 — a tiny deterministic PRNG. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generator(rand) {
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = (list) => list[int(0, list.length - 1)];
  const maybe = (p, v) => (rand() < p ? v() : undefined);
  const COLORS = ["#ffffff", "#000000", "#111111", "#f5c400", "#008ccb", "#c61724", "#1f2937", "#fafafa", "#e8e8e8", "#7c3aed"];
  const color = () => pick(COLORS);
  const words = (n) =>
    Array.from({ length: n }, () => pick(["Black", "Week", "Hantelbank", "Rack", "{{vorname|Hey}}", "stark", "Home-Gym", "–", "25 %", "Training", "**fett**", "Ü-Ei", "&", "<b>", "\"Zitat\""])).join(" ");
  const url = () => pick(["https://www.motionsports.de/collections/sale", "https://www.motionsports.de/", "https://cdn.shopify.com/s/files/banner.jpg", "mailto:info@motionsports.de"]);
  const img = () => pick(["https://cdn.shopify.com/s/files/banner.jpg", "https://mo.example.com/api/email-hero-image/template-a.png", "https://x.de/foto.gif"]);
  const textStyle = () => ({
    fontSize: maybe(0.3, () => int(10, 72)),
    weight: maybe(0.2, () => pick(["normal", "bold"])),
    italic: maybe(0.1, () => true),
    uppercase: maybe(0.15, () => true),
    letterSpacing: maybe(0.15, () => int(-2, 20)),
    lineHeight: maybe(0.15, () => int(100, 250)),
    font: maybe(0.2, () => pick(MAIL_FONT_KEYS)),
  });
  const box = () => ({ padTop: maybe(0.3, () => int(0, 120)), padBottom: maybe(0.3, () => int(0, 120)), background: maybe(0.2, color) });
  const block = (type) => {
    switch (type) {
      case "logo":
        return { type, align: pick(["left", "center", "right"]), width: int(60, 300), ...box() };
      case "heading":
        return { type, text: words(int(1, 6)), size: pick(["s", "m", "l", "xl"]), align: pick(["left", "center", "right"]), color: maybe(0.3, color), ...box(), ...textStyle() };
      case "text":
        return { type, text: rand() < 0.3 ? `- ${words(3)}\n- ${words(2)}\n\n${words(8)}` : words(int(3, 30)), size: pick(["s", "m", "l"]), bullet: maybe(0.3, () => pick(TEXT_BULLETS)), accentBar: maybe(0.15, color), ...box(), ...textStyle() };
      case "greeting":
        return { type, text: "Hallo {{vorname}},", fallback: "Hallo,", ...box(), ...textStyle() };
      case "image":
        return { type, src: img(), alt: words(2), href: maybe(0.5, url), width: pick(["full", "content", int(40, 600)]), align: pick(["left", "center", "right"]), radius: maybe(0.3, () => int(0, 40)), ...box() };
      case "button":
        return { type, label: words(int(1, 4)).slice(0, 60), href: url(), align: pick(["left", "center", "right"]), color: maybe(0.3, color), textColor: maybe(0.3, color), fullWidth: rand() < 0.2, size: maybe(0.5, () => pick(["s", "m", "l"])), shape: maybe(0.3, () => pick(["pill", "rounded", "square"])), outline: rand() < 0.15, borderColor: maybe(0.1, color), ...box() };
      case "menu":
        return { type, items: Array.from({ length: int(1, 8) }, () => ({ label: words(1).slice(0, 40), href: url() })), align: pick(["left", "center", "right"]), separator: pick(MENU_SEPARATORS), uppercase: rand() < 0.5, bold: rand() < 0.5, color: maybe(0.3, color), fontSize: maybe(0.3, () => int(10, 28)), ...box() };
      case "product":
        return { type, ref: pick(["atx®-hantelbank-klappbar-schwarz-silber", "rack-1", "kettlebell~123"]), layout: pick(["stacked", "side"]), showImage: rand() < 0.8, showPrice: rand() < 0.8, showDescription: rand() < 0.4, buttonLabel: pick(["Zum Produkt", "", "Ansehen"]), align: pick(["left", "center", "right"]), nameSize: maybe(0.3, () => int(12, 40)), ...box() };
      case "coupon":
        return {
          type,
          code: pick(["BLACKWEEK25", "SALE10", "MO-2026_X"]),
          headline: words(3),
          terms: words(5),
          accent: maybe(0.3, color),
          cardColor: maybe(0.3, color),
          borderStyle: maybe(0.3, () => pick(["dashed", "solid", "none"])),
          radius: maybe(0.3, () => int(0, 24)),
          textColor: maybe(0.2, color),
          codeColor: maybe(0.2, color),
          codeFont: maybe(0.2, () => pick(MAIL_FONT_KEYS)),
          cta: maybe(0.4, () => pick(["link", "button"])),
          ...box(),
        };
      case "countdown":
        return {
          type,
          until: "2030-11-30T22:59:00Z",
          heading: maybe(0.6, () => words(3)),
          tileColor: maybe(0.3, color),
          digitColor: maybe(0.3, color),
          labelColor: maybe(0.3, color),
          ...box(),
        };
      case "products":
        return { type, title: maybe(0.6, () => words(2)), refs: ["rack-1", "kettlebell~123", "atx®-hantelbank-klappbar-schwarz-silber"].slice(0, int(1, 3)), layout: pick(["rows", "grid"]), cardColor: maybe(0.3, color), textColor: maybe(0.3, color) };
      case "divider":
        return { type, color: maybe(0.5, color), thickness: int(1, 8), widthPct: int(10, 100), lineStyle: pick(["solid", "dashed", "dotted"]), align: pick(["left", "center", "right"]), ...box() };
      case "spacer":
        return { type, height: int(4, 200), background: maybe(0.3, color) };
      case "social":
        return { type, align: pick(["left", "center", "right"]), ...box() };
      case "html":
        return { type, html: pick(HTML_SNIPPETS)(words(3)), ...box() };
      default:
        return { type };
    }
  };
  const section = () => {
    const n = int(1, 4);
    return {
      type: "section",
      columns: Array.from({ length: n }, () => ({
        width: int(10, 60),
        valign: pick(["top", "middle", "bottom"]),
        background: maybe(0.2, color),
        padding: maybe(0.3, () => int(0, 48)),
        blocks: Array.from({ length: int(0, n > 2 ? 3 : 5) }, () => block(pick(MAIL_CHILD_BLOCK_TYPES))),
      })),
      background: maybe(0.4, color),
      bgImage: maybe(0.2, img),
      minHeight: maybe(0.2, () => int(0, 800)),
      padTop: maybe(0.4, () => int(0, 120)),
      padBottom: maybe(0.4, () => int(0, 120)),
      padX: maybe(0.2, () => int(0, 60)),
      gap: maybe(0.3, () => int(0, 48)),
      stack: rand() < 0.8,
      reverse: rand() < 0.2,
      radius: maybe(0.2, () => int(0, 32)),
      borderColor: maybe(0.15, color),
    };
  };
  return () => ({
    v: 2,
    style: {
      accentColor: color(),
      buttonTextColor: color(),
      textColor: color(),
      headingColor: color(),
      outerBackground: color(),
      cardBackground: color(),
      linkColor: maybe(0.3, color),
      fontFamily: pick(MAIL_FONT_KEYS),
      headingFont: maybe(0.4, () => pick(MAIL_FONT_KEYS)),
      buttonShape: pick(["pill", "rounded", "square"]),
      contentPadding: int(16, 60),
      cardRadius: int(0, 24),
    },
    blocks: [
      ...Array.from({ length: int(1, 9) }, () => {
        const r = rand();
        // the top-level only blocks with live data: the countdown and the fixed products
        return r < 0.45 ? section() : r < 0.55 ? block(pick(["countdown", "products"])) : block(pick(MAIL_CHILD_BLOCK_TYPES));
      }),
      { type: "footer", showSocial: rand() < 0.5, background: maybe(0.3, color), textColor: maybe(0.3, color) },
    ],
  });
}

/** The live data of every product, products and countdown block — the way mail-template-design.ts hands it over. */
function slotsFor(doc) {
  const slots = {};
  const item = (ref, i, rows) => ({
    name: `Produkt ${ref}`,
    imageUrl: i === 2 ? null : "https://cdn.shopify.com/p.jpg",
    url: i === 1 ? null : "https://www.motionsports.de/products/p",
    priceLabel: "399,00 €",
    compareAtLabel: i === 0 ? "499,00 €" : null,
    description: rows ? "Stabil, klappbar, platzsparend." : null,
    ctaLabel: rows ? "Zum Produkt" : null,
  });
  const visit = (b) => {
    if (b.type === "product" && b.ref) {
      slots[b.id] = {
        html: "",
        text: `${b.ref} — 399,00 €\nhttps://www.motionsports.de/products/${encodeURIComponent(b.ref)}`,
        product: { name: `Produkt ${b.ref}`, imageUrl: "https://cdn.shopify.com/p.jpg", url: "https://www.motionsports.de/products/p", priceLabel: "399,00 €", compareAtLabel: "499,00 €", description: "Stabil, klappbar, platzsparend." },
      };
    }
    if (b.type === "products" && b.refs?.length) {
      slots[b.id] = { html: "", text: "- Produkt — 399,00 €", products: { layout: b.layout, items: b.refs.map((r, i) => item(r, i, b.layout === "rows")) } };
    }
    if (b.type === "countdown" && b.until) {
      const signed = b.id.length % 2 === 0;
      slots[b.id] = {
        html: "",
        text: "Dein Angebot gilt noch 3 Tage",
        countdown: {
          imageUrl: signed ? "https://mo.example.com/api/email-countdown/t?bg=111111&tile=292929&digit=ffd400&label=a1a1a1&cs=s" : null,
          imageUrlMobile: signed ? "https://mo.example.com/api/email-countdown/t?w=m&bg=111111&tile=292929&digit=ffd400&label=a1a1a1&cs=s" : null,
          imageAlt: "Dein Angebot gilt noch 3 Tage",
          imageWidth: 564,
          imageHeight: 116,
          imageWidthMobile: 350,
          lead: "Dein Angebot gilt noch 3 Tage 4 Stunden",
          until: "bis Sa., 30.11.2030, 23:59 Uhr",
        },
      };
    }
    if (b.type === "section") for (const c of b.columns ?? []) for (const k of c.blocks ?? []) visit(k);
  };
  for (const b of doc.blocks) visit(b);
  return slots;
}

test(`random documents render lint-clean with one footer (${RUNS} runs, seed ${SEED})`, () => {
  const next = generator(prng(SEED));
  const merge = (t) => applyMergeFields(t, { firstName: "anna" });
  for (let i = 0; i < RUNS; i++) {
    const raw = next();
    const doc = normalizeMailTemplateDoc(raw);
    const where = `run ${i} (FUZZ_SEED=${SEED}): ${JSON.stringify(raw).slice(0, 400)}`;
    // the generated custom HTML is balanced: no structure error (no false alarm)
    for (const e of validateMailTemplateDoc(doc, "template").errors) assert.doesNotMatch(e.message, /unvollständige Tabellen|Bitte nur den Inhalt/, where);
    for (const previewPlaceholders of [false, true]) {
      const ctx = fixtureContext({ merge, slots: slotsFor(doc), previewPlaceholders, assets: { ...FIXTURE_ASSETS, socialLinks: SOCIAL_LINKS } });
      const html = renderMailTemplateHtml(doc, ctx);
      const findings = lintOutlookHtml(html, { maxImageWidth: MAIL_CARD_WIDTH, sizeBudgetBytes: 200 * 1024 });
      assert.deepEqual(findings, [], `${where}\n${JSON.stringify(findings.slice(0, 3))}`);
      assert.equal(html.split(MAIL_FOOTER_MARKER).length - 1, 1, `footer marker once — ${where}`);
      assert.doesNotMatch(html, /\bundefined\b|\bNaN\b|="null"|: null;|\[object Object\]/, where);
      // nothing of the custom HTML can run or fetch: no handler, script URL, image set or ping survives
      assert.doesNotMatch(html, /[\s/"']on[a-z]+\s*=|javascript:|image-set|\sping=|<(noembed|xmp|plaintext|script)\b/i, where);
      // every table cell width attribute is a whole, positive number
      for (const m of html.matchAll(/<(?:td|table|img)\b[^>]*\swidth="([^"]*)"/g)) {
        assert.match(m[1], /^(?:\d+%?)$/, `width="${m[1]}" — ${where}`);
        assert.ok(Number.parseInt(m[1], 10) > 0, `width="${m[1]}" — ${where}`);
      }
      const text = renderMailTemplateText(doc, ctx);
      assert.equal(typeof text, "string");
      assert.doesNotMatch(text, /\bundefined\b|\bNaN\b|\[object Object\]/, where);
    }
  }
});
