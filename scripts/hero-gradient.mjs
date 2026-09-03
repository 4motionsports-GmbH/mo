// Apply the Performance hero's legibility gradient to any picture — the same
// overlay generateHeroImage composites over every AI-rendered hero. Useful for
// preparing a replacement default asset (public/email-hero-default.jpg) or
// for checking what the overlay does to a given scene.
//
//   node scripts/hero-gradient.mjs <input> <output.png>

import { readFileSync, writeFileSync } from "node:fs";
import { applyHeroGradient } from "../src/lib/email-hero-gradient.mjs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node scripts/hero-gradient.mjs <input> <output.png>");
  process.exit(1);
}
const out = await applyHeroGradient(readFileSync(input));
writeFileSync(output, out);
console.log(`written ${output} (${out.length} bytes)`);
