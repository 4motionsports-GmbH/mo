import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadReferenceImages,
  MAX_OWNED_REFERENCES,
  MAX_REFERENCE_IMAGES,
  ownedProductIds,
  pickReferenceCandidates,
  prepareReferenceImage,
  REFERENCE_MAX_PX,
  referenceInstruction,
  withReferenceInstruction,
} from "./email-hero-references.mjs";

const prod = (name, img) => ({ name, images: img ? [img] : [] });

test("ownedProductIds reads productId (campaign) and handle (chat customer), de-duplicated", () => {
  const history = {
    orders: [
      { items: [{ productId: "atx-rack-620" }, { handle: "atx-rack-620" }, { title: "no id" }] },
      { items: [{ handle: "atx-bench" }, { productId: "atx-plates" }] },
    ],
  };
  assert.deepEqual(ownedProductIds(history, 5), ["atx-rack-620", "atx-bench", "atx-plates"]);
  assert.deepEqual(ownedProductIds(history), ["atx-rack-620", "atx-bench"], "default limit");
  assert.deepEqual(ownedProductIds(null), []);
});

test("candidates: recommended first, then at most two owned, one picture each, capped", () => {
  const recommended = Array.from({ length: 5 }, (_, i) => prod(`Neu ${i}`, `https://cdn/n${i}.jpg`));
  const owned = Array.from({ length: 4 }, (_, i) => prod(`Alt ${i}`, `https://cdn/o${i}.jpg`));
  const refs = pickReferenceCandidates({ recommended, owned });
  assert.equal(refs.length, MAX_REFERENCE_IMAGES);
  assert.equal(refs.filter((r) => r.role === "new").length, 5);
  assert.equal(refs.filter((r) => r.role === "owned").length, 1, "cap leaves room for one owned");
  const few = pickReferenceCandidates({ recommended: recommended.slice(0, 2), owned });
  assert.equal(few.filter((r) => r.role === "owned").length, MAX_OWNED_REFERENCES);
});

test("candidates skip products without https picture and duplicate pictures", () => {
  const refs = pickReferenceCandidates({
    recommended: [prod("A", "http://insecure/a.jpg"), prod("B", "https://cdn/b.jpg"), prod("B2", "https://cdn/b.jpg"), prod("C")],
  });
  assert.deepEqual(refs.map((r) => r.label), ["B"]);
});

test("the reference block numbers the pictures and forbids cut-outs", () => {
  const text = referenceInstruction([
    { label: "ATX® Power Rack 620", role: "new" },
    { label: "ATX® Hexagon Hanteln", role: "owned" },
  ]);
  assert.match(text, /picture 1 = ATX® Power Rack 620; picture 2 = ATX® Hexagon Hanteln \(already owned, background\)/);
  assert.match(text, /Never paste them in as flat cut-outs/);
  assert.match(text, /never show their white catalogue backgrounds/);
  assert.equal(referenceInstruction([]), "");
  assert.equal(withReferenceInstruction("scene", []), "scene");
  assert.match(withReferenceInstruction("scene", [{ label: "X", role: "new" }]), /^scene\n\nREFERENCE PHOTOS/);
});

test("prepareReferenceImage downsizes to the reference edge and yields JPEG", async () => {
  const { default: sharp } = await import("sharp");
  const big = await sharp({ create: { width: 2000, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toBuffer();
  const out = await prepareReferenceImage(big);
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, REFERENCE_MAX_PX);
  assert.equal(meta.height, REFERENCE_MAX_PX / 2);
  const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#123456" } }).png().toBuffer();
  const meta2 = await sharp(await prepareReferenceImage(small)).metadata();
  assert.equal(meta2.width, 300, "never enlarged");
});

test("loadReferenceImages drops failures and keeps order", async () => {
  const ok = (body, type = "image/jpeg") => ({
    ok: true,
    headers: { get: () => type },
    arrayBuffer: async () => Buffer.from(body),
  });
  const fetchImpl = async (url) => {
    if (url.endsWith("404")) return { ok: false, headers: { get: () => "" } };
    if (url.endsWith("html")) return ok("<html>", "text/html");
    if (url.endsWith("boom")) throw new Error("boom");
    return ok("img-" + url);
  };
  const refs = await loadReferenceImages(
    [
      { label: "a", url: "https://x/a", role: "new" },
      { label: "b", url: "https://x/404", role: "new" },
      { label: "c", url: "https://x/html", role: "new" },
      { label: "d", url: "https://x/boom", role: "owned" },
      { label: "e", url: "https://x/e", role: "owned" },
    ],
    { fetchImpl, prepare: async (b) => b }
  );
  assert.deepEqual(refs.map((r) => r.label), ["a", "e"]);
  assert.equal(refs[0].bytes.toString(), "img-https://x/a");
});
