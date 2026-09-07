import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_DIGITAL_SOURCE_TYPE,
  aiImageExif,
  aiImageXmp,
  markAsAiGenerated,
  readAiMarking,
} from "./email-hero-marking.mjs";

test("the XMP packet carries the IPTC digital source type and bilingual descriptions", () => {
  const xmp = aiImageXmp({ tool: "gpt-image-2", createdAt: new Date("2026-09-04T10:00:00Z") });
  assert.match(xmp, /Iptc4xmpExt:DigitalSourceType="http:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/trainedAlgorithmicMedia"/);
  assert.match(xmp, /xmp:CreatorTool="gpt-image-2"/);
  assert.match(xmp, /xmp:CreateDate="2026-09-04T10:00:00\.000Z"/);
  assert.match(xmp, /xml:lang="en">AI-generated image \(gpt-image-2\)</);
  assert.match(xmp, /xml:lang="de">KI-generiertes Bild \(gpt-image-2\)</);
  assert.match(xmp, /<dc:publisher><rdf:Bag><rdf:li>motion sports</);
  // A tool name with markup cannot break the packet.
  assert.match(aiImageXmp({ tool: 'x<"&>' }), /xmp:CreatorTool="x&lt;&quot;&amp;&gt;"/);
});

test("the EXIF tags say the same", () => {
  assert.deepEqual(aiImageExif({ tool: "gpt-image-2" }), {
    IFD0: { ImageDescription: "AI-generated image (gpt-image-2) / KI-generiertes Bild", Software: "gpt-image-2" },
  });
});

test("a JPEG written through markAsAiGenerated carries XMP + EXIF marking that survives re-reading", async () => {
  const { default: sharp } = await import("sharp");
  const src = sharp({ create: { width: 64, height: 32, channels: 3, background: "#888888" } });
  const jpeg = await markAsAiGenerated(src, { tool: "gpt-image-2" }).jpeg({ quality: 80 }).toBuffer();
  const marking = await readAiMarking(jpeg);
  assert.deepEqual(marking, { digitalSourceType: true, xmpDescription: true, exifDescription: true });
  const meta = await sharp(jpeg).metadata();
  assert.ok(Buffer.from(meta.xmp).toString("utf8").includes(AI_DIGITAL_SOURCE_TYPE));
  // An unmarked file reads as unmarked (the check is not vacuous).
  const plain = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).jpeg().toBuffer();
  assert.deepEqual(await readAiMarking(plain), { digitalSourceType: false, xmpDescription: false, exifDescription: false });
});
