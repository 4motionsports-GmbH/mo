import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGermanNumber,
  parseKurztextSpecs,
  extractKurztextDimensions,
} from "./kurztext.mjs";

test("parseGermanNumber handles German formats", () => {
  assert.equal(parseGermanNumber("2300"), 2300);
  assert.equal(parseGermanNumber("2.195"), 2195); // thousands dot
  assert.equal(parseGermanNumber("1.234,5"), 1234.5);
  assert.equal(parseGermanNumber("2,5"), 2.5);
  assert.equal(parseGermanNumber("172.5"), 172.5); // decimal dot (metafield style)
  assert.equal(parseGermanNumber("650 kg"), 650);
  assert.equal(parseGermanNumber("kein Wert"), null);
  assert.equal(parseGermanNumber(""), null);
  assert.equal(parseGermanNumber(null), null);
});

test("parseKurztextSpecs splits the single-line run-on format", () => {
  const pairs = parseKurztextSpecs(
    "Marke: ATX Serie: 700 Breite: 2000 mm Höhe: 2300 mm Belastbarkeit: Rahmenlast 650 kg"
  );
  assert.deepEqual(pairs, [
    ["Marke", "ATX"],
    ["Serie", "700"],
    ["Breite", "2000 mm"],
    ["Höhe", "2300 mm"],
    ["Belastbarkeit", "Rahmenlast 650 kg"],
  ]);
});

test("parseKurztextSpecs handles one pair per line and multi-word keys", () => {
  const pairs = parseKurztextSpecs(
    "Marke: ATX\nLochung / Raster: 25 mm\nGewicht ca.: 456 kg\nHöhe: 2.195 mm"
  );
  assert.deepEqual(pairs, [
    ["Marke", "ATX"],
    ["Lochung / Raster", "25 mm"],
    ["Gewicht ca.", "456 kg"],
    ["Höhe", "2.195 mm"],
  ]);
});

test("parseKurztextSpecs tolerates junk", () => {
  assert.deepEqual(parseKurztextSpecs(""), []);
  assert.deepEqual(parseKurztextSpecs(null), []);
  assert.deepEqual(parseKurztextSpecs("nur freier text ohne paare"), []);
  // Empty value between two keys is dropped, the rest survives.
  assert.deepEqual(parseKurztextSpecs("Marke: Serie: 700"), [["Serie", "700"]]);
});

test("extractKurztextDimensions normalises mm/cm/m to cm", () => {
  const dims = extractKurztextDimensions([
    ["Breite", "2000 mm"],
    ["Höhe", "2300 mm"],
    ["Tiefe", "1,8 m"],
    ["Gewicht", "456 kg"],
  ]);
  assert.deepEqual(dims, { widthCm: 200, heightCm: 230, depthCm: 180, weightKg: 456 });
});

test("extractKurztextDimensions: unit-less values >400 are treated as mm", () => {
  const dims = extractKurztextDimensions([
    ["Höhe", "2300"], // bare mm (ATX style)
    ["Breite", "110"], // bare cm
  ]);
  assert.equal(dims.heightCm, 230);
  assert.equal(dims.widthCm, 110);
});

test("extractKurztextDimensions: Tiefe wins over Länge, first value wins per key", () => {
  const dims = extractKurztextDimensions([
    ["Länge", "2200 mm"],
    ["Tiefe", "1800 mm"],
    ["Höhe", "2000 mm"],
    ["Höhe", "9999 mm"],
  ]);
  assert.equal(dims.depthCm, 180);
  assert.equal(dims.heightCm, 200);
});

test("extractKurztextDimensions ignores non-dimension and non-numeric keys", () => {
  const dims = extractKurztextDimensions([
    ["Höhe verstellbar", "10 - 20"],
    ["Belastbarkeit", "650 kg"],
    ["Höhe", "verstellbar"],
  ]);
  assert.deepEqual(dims, { widthCm: null, heightCm: null, depthCm: null, weightKg: null });
});

test("extractKurztextDimensions accepts Produkthöhe / ca. variants", () => {
  const dims = extractKurztextDimensions([
    ["Produkthöhe", "2300 mm"],
    ["Gewicht ca.", "88,5 kg"],
  ]);
  assert.equal(dims.heightCm, 230);
  assert.equal(dims.weightKg, 88.5);
});
