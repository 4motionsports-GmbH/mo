// npm run gif:shrink -- <datei.gif> [<ziel.gif>]
//
// Makes an animated GIF fit a mail template (≤ 1,200 px wide, ≤ 2 MB) on your
// own machine — the same steps as „Bild hochladen“ in Vorlagen and Rundmails
// (narrower, then compressed harder, then fewer frames of a video-like GIF at
// the same duration; mail-template-gif.mjs decides, mail-template-gif-encode.mjs
// encodes), but without the upload's 4 MB limit (Vercel caps a request at
// 4.5 MB) and with more time. Writes <name>-mail.gif next to the file: upload
// that one, it is stored unchanged. docs/EMAIL_TEMPLATES.md §7.

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { GIF_ENCODE_OPTIONS, gifShrunkWarning, planAnimatedGif, shrinkAnimatedGif, sizeLabel } from "../src/lib/mail-template-gif.mjs";
import { encodeAnimatedGifVariant } from "../src/lib/mail-template-gif-encode.mjs";

/** Seconds the steps may take here (the upload has 150). */
const BUDGET_SECONDS = 900;

const [input, target] = process.argv.slice(2);
if (!input) {
  console.error("Aufruf: npm run gif:shrink -- <datei.gif> [<ziel.gif>]");
  process.exit(1);
}
const bytes = fs.readFileSync(input);
// The first frame only (the pixel limit counts per frame, as in the upload).
const meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
if (meta.format !== "gif" || !(meta.pages > 1)) {
  console.error(`${input}: kein animiertes GIF.`);
  process.exit(1);
}
const frames = meta.pages;
const gif = {
  width: meta.width,
  height: meta.pageHeight ?? meta.height,
  frames,
  delays: Array.isArray(meta.delay) && meta.delay.length === frames ? meta.delay : undefined,
};
console.log(`${path.basename(input)}: ${gif.width} × ${gif.height} px, ${frames} Einzelbilder, ${sizeLabel(bytes.length)}`);

const plan = planAnimatedGif({ ...gif, bytes: bytes.length, budgetSeconds: BUDGET_SECONDS });
if (plan.action === "keep") {
  console.log("Passt schon (höchstens 1200 px breit und 2 MB) — so hochladen, es bleibt unverändert.");
  process.exit(0);
}
if (plan.action === "refuse") {
  console.error(plan.message);
  process.exit(1);
}

const res = await shrinkAnimatedGif({
  gif,
  firstWidth: plan.width,
  budgetSeconds: BUDGET_SECONDS,
  encode: async (variant) => {
    const started = Date.now();
    const data = await encodeAnimatedGifVariant(bytes, variant, {
      frames,
      delays: gif.delays,
      loop: meta.loop ?? 0,
      limitInputPixels: gif.width * gif.height * frames + 1,
    });
    const every = variant.frameStep > 1 ? `, nur jedes ${variant.frameStep}. Einzelbild` : "";
    console.log(
      `  ${variant.width} px, Toleranz ${variant.interFrameMaxError}${every}: ${sizeLabel(data.length)} (${((Date.now() - started) / 1000).toFixed(1)} s)`
    );
    return data;
  },
});
if (!res.ok) {
  console.error(res.message);
  process.exit(1);
}
const out = target ?? path.join(path.dirname(input), `${path.basename(input, path.extname(input))}-mail.gif`);
fs.writeFileSync(out, res.data);
console.log(
  gifShrunkWarning({
    fromWidth: gif.width,
    toWidth: res.width,
    fromBytes: bytes.length,
    toBytes: res.data.length,
    frames,
    keptFrames: res.keptFrames,
    compressed: res.interFrameMaxError > GIF_ENCODE_OPTIONS.interFrameMaxError,
  })
);
console.log(`→ ${out}\n  Diese Datei im Bild-Baustein hochladen.`);
