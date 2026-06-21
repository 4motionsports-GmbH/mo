// One-off generator for the German prompt golden snapshot used by
// src/lib/system-prompt-core.test.mjs. Run after an INTENTIONAL change to the
// German prompt copy (and only then):
//
//   node scripts/gen-prompt-golden.mjs
//
// It re-emits src/lib/system-prompt-core.de.golden.txt from the shared fixtures.
// The byte-identity guarantee is: a change to German output fails the test
// until the golden is regenerated on purpose — never silently.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSystemPrompt } from "../src/lib/system-prompt-core.mjs";
import { goldenCases, SEP } from "../src/lib/system-prompt-core.fixtures.mjs";

const out = goldenCases()
  .map((c) => buildSystemPrompt({ ...c, locale: "de" }))
  .join(SEP);

const target = fileURLToPath(
  new URL("../src/lib/system-prompt-core.de.golden.txt", import.meta.url)
);
writeFileSync(target, out, "utf8");
console.log(`Wrote ${out.length} bytes to ${target}`);
