import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bundleBlockModel,
  bundleBlockText,
  bundleEyecatcherKind,
  bundleHeadline,
  bundleSaving,
  bundleStattPrice,
  bundleTagline,
  bundleUnitPriceLabel,
  clampBundleDescription,
  formatBundleMoney,
  shouldRenderBundleBlock,
  tintHex,
} from "./bundle-email-core.mjs";

const NBSP = " ";
/** Intl puts a no-break space before "€" in German; compare with plain spaces. */
const plain = (s) => (s == null ? s : String(s).replace(/ /g, " "));

/** The visual-check set: 2× kettlebell + mat + balance pad, 29,90 € cheaper. */
const SET = {
  title: "Dein Home-Gym-Set",
  components: [
    { name: "Adjustable Kettlebell 3,5 - 18 kg - BowFlex", quantity: 2, unitPrice: "239.00", imageUrl: "https://cdn.example/kb.jpg", description: "Verstellbar von 3,5 bis 18 kg." },
    { name: "AIREX® Gymnastikmatte Fitline 180 x 60 cm", quantity: 1, unitPrice: "79.95", imageUrl: "https://cdn.example/mat.jpg", description: null },
    { name: "AIREX® Balance Pad 48 x 40 cm", quantity: 1, unitPrice: "79.95", imageUrl: "http://insecure.example/pad.jpg" },
  ],
  bundlePrice: "598.00",
  componentsSum: "637.90",
};

test("shouldRenderBundleBlock: block omitted when no bundle is attached", () => {
  assert.equal(shouldRenderBundleBlock(null), false);
  assert.equal(shouldRenderBundleBlock(undefined), false);
});

test("shouldRenderBundleBlock: only an ACTIVE attached bundle renders", () => {
  assert.equal(shouldRenderBundleBlock({ status: "active" }), true);
  assert.equal(shouldRenderBundleBlock({ status: "pending" }), false);
  assert.equal(shouldRenderBundleBlock({ status: "expired" }), false);
  assert.equal(shouldRenderBundleBlock({ status: "failed" }), false);
});

test("shouldRenderBundleBlock: an active set past its deadline no longer renders", () => {
  const now = Date.UTC(2026, 9, 1, 12);
  const future = new Date(now + 60_000).toISOString();
  const past = new Date(now - 60_000).toISOString();
  assert.equal(shouldRenderBundleBlock({ status: "active", expiresAt: future }, now), true);
  assert.equal(shouldRenderBundleBlock({ status: "active", expiresAt: past }, now), false);
  assert.equal(shouldRenderBundleBlock({ status: "active", expiresAt: null }, now), true);
});

test("bundleStattPrice: present (= true component sum) only when bundle is cheaper", () => {
  // A genuine saving → strike price = the snapshotted component sum.
  assert.equal(bundleStattPrice("149.00", "160.00"), "160.00");
  assert.equal(bundleStattPrice(149, 160), "160.00");
});

test("bundleStattPrice: omitted when price >= sum (PAngV — no invented strike)", () => {
  assert.equal(bundleStattPrice("160.00", "160.00"), null); // equal ⇒ no statt
  assert.equal(bundleStattPrice("170.00", "160.00"), null); // above ⇒ no statt
});

test("bundleHeadline keeps short operator titles and replaces generated long ones", () => {
  assert.equal(bundleHeadline("Dein Rack-Upgrade", "de"), "Dein Rack-Upgrade");
  assert.equal(bundleHeadline("Set: Bodenschutzmatte Excellence 1000x1000 mm + ATX® Jammer Arms X1-600", "de"), "Dein persönliches Set");
  assert.equal(bundleHeadline("Ein Titel, der deutlich länger ist als vierzig Zeichen", "de"), "Dein persönliches Set");
  assert.equal(bundleHeadline("", "en"), "Your personal set");
  assert.equal(bundleHeadline(null, "de"), "Dein persönliches Set");
});

test("formatBundleMoney: German and English currency formats; garbage printed as given", () => {
  assert.equal(plain(formatBundleMoney("1299", "EUR", "de")), "1.299,00 €");
  assert.equal(plain(formatBundleMoney("149,90", "EUR", "de")), "149,90 €");
  assert.equal(formatBundleMoney(49, "EUR", "en"), "€49.00");
  assert.equal(formatBundleMoney("n/a", "EUR", "de"), "n/a");
});

test("bundleSaving: only a genuine saving, percentage rounded DOWN, none under 1 %", () => {
  assert.deepEqual(bundleSaving("129.90", "159.80"), { amountCents: 2990, pct: 18 }); // 18.71 % → 18
  assert.deepEqual(bundleSaving("160.00", "160.00"), { amountCents: null, pct: null });
  assert.deepEqual(bundleSaving("170.00", "160.00"), { amountCents: null, pct: null });
  assert.deepEqual(bundleSaving("999.00", "1000.00"), { amountCents: 100, pct: null }); // 0.1 %
  assert.deepEqual(bundleSaving("x", "160.00"), { amountCents: null, pct: null });
});

test("bundleEyecatcherKind: the saving badge only with a saving AND a percentage", () => {
  assert.equal(bundleEyecatcherKind({ savingLabel: "29,90 €", savingPct: 18 }), "saving");
  assert.equal(bundleEyecatcherKind({ savingLabel: "1,00 €", savingPct: null }), "price");
  assert.equal(bundleEyecatcherKind({ savingLabel: null, savingPct: null }), "price");
  assert.equal(bundleEyecatcherKind({ savingLabel: null, savingPct: 10 }), "price");
});

test("bundleUnitPriceLabel: „je …“ only for more than one", () => {
  assert.equal(bundleUnitPriceLabel("49,00 €", 2, "de"), "je 49,00 €");
  assert.equal(bundleUnitPriceLabel("49,00 €", 1, "de"), "49,00 €");
  assert.equal(bundleUnitPriceLabel("€49.00", 3, "en"), "€49.00 each");
  assert.equal(bundleUnitPriceLabel("€49.00", 1, "en"), "€49.00");
  assert.equal(bundleUnitPriceLabel(null, 2, "de"), null);
});

test("clampBundleDescription: collapses whitespace, cuts at a word with an ellipsis", () => {
  assert.equal(clampBundleDescription("  Kurz   und  gut. "), "Kurz und gut.");
  assert.equal(clampBundleDescription(""), null);
  assert.equal(clampBundleDescription(null), null);
  const long =
    "Robuste Gymnastikmatte aus geschlossenzelligem Schaum, rutschfest, hautfreundlich und leicht zu reinigen, ideal für Yoga und Pilates.";
  const out = clampBundleDescription(long, 60);
  assert.ok(out.length <= 61, out);
  assert.ok(out.endsWith("…"), out);
  assert.ok(!/[ ,]…$/.test(out), out);
  assert.ok(long.startsWith(out.slice(0, -1)), out);
});

test("bundleTagline: „zusammen günstiger“ only with a genuine saving", () => {
  assert.equal(bundleTagline({ itemCount: 3, pieceCount: 4, eyecatcher: "saving" }), "3 Produkte · zusammen günstiger");
  assert.equal(bundleTagline({ itemCount: 3, pieceCount: 4, eyecatcher: "price" }), "3 Produkte in einem Set");
  assert.equal(bundleTagline({ itemCount: 1, pieceCount: 4, eyecatcher: "saving" }), "4 Stück · zusammen günstiger");
  assert.equal(
    bundleTagline({ itemCount: 2, pieceCount: 2, eyecatcher: "saving", language: "en" }),
    "2 products · cheaper together"
  );
  assert.equal(bundleTagline({ itemCount: 1, pieceCount: 1, eyecatcher: "price", language: "en" }), "1 piece in one set");
});

test("tintHex: a pale tint of the accent; non-hex falls back to light grey", () => {
  assert.equal(tintHex("#008ccb", 0.1), "#e6f4fa");
  assert.equal(tintHex("#111111", 0.1), "#e7e7e7");
  assert.equal(tintHex("#08c", 0.1), "#e6f3fa");
  assert.equal(tintHex("#008ccb", 1), "#008ccb");
  assert.equal(tintHex("blue"), "#f4f4f4");
  assert.equal(tintHex(null), "#f4f4f4");
});

test("bundleBlockModel: genuine saving → strike, saving badge and snapshot unit prices", () => {
  const m = bundleBlockModel(SET);
  assert.equal(m.headline, "Dein Home-Gym-Set");
  assert.equal(plain(m.priceLabel), "598,00 €");
  assert.equal(plain(m.stattLabel), "637,90 €");
  assert.equal(plain(m.savingLabel), "39,90 €");
  assert.equal(m.savingPct, 6); // 6.25 % → 6
  assert.equal(m.eyecatcher, "saving");
  assert.deepEqual(
    { ...m.eyecatcherCopy, note: plain(m.eyecatcherCopy.note) },
    { label: null, value: `−6${NBSP}%`, note: "Du sparst 39,90 €" }
  );
  assert.equal(m.itemCount, 3);
  assert.equal(m.pieceCount, 4);
  assert.equal(m.tagline, "3 Produkte · zusammen günstiger");
  assert.deepEqual(
    m.items.map((i) => [i.name, i.quantity, plain(i.unitPriceLabel)]),
    [
      ["Adjustable Kettlebell 3,5 - 18 kg - BowFlex", 2, "je 239,00 €"],
      ["AIREX® Gymnastikmatte Fitline 180 x 60 cm", 1, "79,95 €"],
      ["AIREX® Balance Pad 48 x 40 cm", 1, "79,95 €"],
    ]
  );
  // Only absolute https images survive (mail clients load nothing else).
  assert.deepEqual(
    m.items.map((i) => i.imageUrl),
    ["https://cdn.example/kb.jpg", "https://cdn.example/mat.jpg", null]
  );
  assert.equal(m.items[0].description, "Verstellbar von 3,5 bis 18 kg.");
  assert.equal(m.items[1].description, null);
  assert.equal(m.labels.cta, "Zur Kasse");
});

test("bundleBlockModel: no saving → no strike, no saving, the set-price badge", () => {
  const m = bundleBlockModel({ ...SET, bundlePrice: "637.90" });
  assert.equal(m.stattLabel, null);
  assert.equal(m.savingLabel, null);
  assert.equal(m.savingPct, null);
  assert.equal(m.eyecatcher, "price");
  assert.deepEqual(
    { ...m.eyecatcherCopy, value: plain(m.eyecatcherCopy.value) },
    { label: "Set-Preis", value: "637,90 €", note: null }
  );
  assert.equal(m.tagline, "3 Produkte in einem Set");
  // The unit prices still show — they are the snapshot, not a saving claim.
  assert.equal(plain(m.items[0].unitPriceLabel), "je 239,00 €");
  // A set above its parts: same — never a strike price.
  const above = bundleBlockModel({ ...SET, bundlePrice: "700.00" });
  assert.equal(above.stattLabel, null);
  assert.equal(above.eyecatcher, "price");
});

test("bundleBlockModel: unit prices only when Σ unitPrice × quantity equals the component sum", () => {
  const mismatch = bundleBlockModel({ ...SET, componentsSum: "700.00" });
  assert.ok(mismatch.items.every((i) => i.unitPriceLabel === null));
  const missing = bundleBlockModel({
    ...SET,
    components: [{ ...SET.components[0], unitPrice: null }, ...SET.components.slice(1)],
  });
  assert.ok(missing.items.every((i) => i.unitPriceLabel === null));
  // Same name twice with the same price is merged (counts added) and still adds up.
  const merged = bundleBlockModel({
    title: null,
    components: [
      { name: "Kettlebell 16 kg", quantity: 1, unitPrice: "49.00" },
      { name: "Kettlebell 16 kg", quantity: 2, unitPrice: "49.00" },
    ],
    bundlePrice: "140.00",
    componentsSum: "147.00",
  });
  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0].quantity, 3);
  assert.equal(plain(merged.items[0].unitPriceLabel), "je 49,00 €");
  assert.equal(merged.tagline, "3 Stück · zusammen günstiger");
  assert.equal(merged.headline, "Dein persönliches Set");
  // …but the same name with two different prices hides the prices.
  const conflicting = bundleBlockModel({
    title: null,
    components: [
      { name: "Kettlebell 16 kg", quantity: 1, unitPrice: "49.00" },
      { name: "Kettlebell 16 kg", quantity: 1, unitPrice: "59.00" },
    ],
    bundlePrice: "100.00",
    componentsSum: "108.00",
  });
  assert.equal(conflicting.items[0].unitPriceLabel, null);
});

test("bundleBlockModel: English labels and formats", () => {
  const m = bundleBlockModel({ ...SET, language: "en" });
  assert.equal(m.labels.cta, "Checkout");
  assert.equal(m.priceLabel, "€598.00");
  assert.equal(m.eyecatcherCopy.value, "−6%");
  assert.equal(m.eyecatcherCopy.note, "You save €39.90");
  assert.equal(m.items[0].unitPriceLabel, "€239.00 each");
  assert.equal(m.tagline, "3 products · cheaper together");
  assert.equal(bundleBlockModel({ ...SET, title: "", language: "en" }).headline, "Your personal set");
});

test("bundleBlockText: one line per item with its unit price; strike and saving only when genuine", () => {
  const url = "https://mo.example/api/r/tok";
  const withSaving = plain(bundleBlockText(bundleBlockModel(SET), url));
  assert.equal(
    withSaving,
    [
      "",
      "—",
      "Dein persönliches Angebot: Dein Home-Gym-Set",
      "- 2× Adjustable Kettlebell 3,5 - 18 kg - BowFlex — je 239,00 €",
      "- 1× AIREX® Gymnastikmatte Fitline 180 x 60 cm — 79,95 €",
      "- 1× AIREX® Balance Pad 48 x 40 cm — 79,95 €",
      "Set-Preis: 598,00 € (statt 637,90 €)",
      "Du sparst 39,90 € (6 %)",
      `Zur Kasse: ${url}`,
    ].join("\n")
  );
  const noSaving = plain(bundleBlockText(bundleBlockModel({ ...SET, bundlePrice: "637.90" }), url));
  assert.ok(noSaving.includes("Set-Preis: 637,90 €\n"));
  assert.ok(!noSaving.includes("statt"));
  assert.ok(!noSaving.includes("sparst"));
  assert.ok(noSaving.endsWith(`Zur Kasse: ${url}`));
});
