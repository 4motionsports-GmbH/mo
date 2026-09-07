// Machine-readable marking of the generated hero files (EU AI Act, Art. 50
// transparency): the image model's own provenance data (C2PA) does not
// survive our re-encoding — sharp writes fresh JPEGs without any metadata —
// so every stored hero gets the established photo-industry marking written
// back in:
//
//   XMP   Iptc4xmpExt:DigitalSourceType = trainedAlgorithmicMedia
//         (the IPTC vocabulary term for "created by a generative AI model"),
//         plus dc:description and xmp:CreatorTool naming the model;
//   EXIF  ImageDescription / Software with the same statement.
//
// Visible disclosure for the reader is the design's job (the "KI-generiertes
// Bild" label in performance.ts); this is the part machines and platforms
// read. Pure helpers here are tested; the sharp application too.

export const AI_DIGITAL_SOURCE_TYPE =
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

export const AI_IMAGE_DESCRIPTION_EN = "AI-generated image";
export const AI_IMAGE_DESCRIPTION_DE = "KI-generiertes Bild";

const escapeXml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * The XMP packet embedded in every hero file.
 * @param {{ tool?: string, createdAt?: Date, publisher?: string }} [opts]
 * @returns {string}
 */
export function aiImageXmp(opts = {}) {
  const tool = opts.tool ?? "generative AI";
  const created = (opts.createdAt ?? new Date()).toISOString();
  const publisher = opts.publisher ?? "motion sports";
  const description = `${AI_IMAGE_DESCRIPTION_EN} (${tool}) / ${AI_IMAGE_DESCRIPTION_DE}`;
  return (
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about=""` +
    ` xmlns:dc="http://purl.org/dc/elements/1.1/"` +
    ` xmlns:xmp="http://ns.adobe.com/xap/1.0/"` +
    ` xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"` +
    ` xmp:CreatorTool="${escapeXml(tool)}"` +
    ` xmp:CreateDate="${escapeXml(created)}"` +
    ` Iptc4xmpExt:DigitalSourceType="${AI_DIGITAL_SOURCE_TYPE}">` +
    `<dc:description><rdf:Alt>` +
    `<rdf:li xml:lang="x-default">${escapeXml(description)}</rdf:li>` +
    `<rdf:li xml:lang="en">${escapeXml(`${AI_IMAGE_DESCRIPTION_EN} (${tool})`)}</rdf:li>` +
    `<rdf:li xml:lang="de">${escapeXml(`${AI_IMAGE_DESCRIPTION_DE} (${tool})`)}</rdf:li>` +
    `</rdf:Alt></dc:description>` +
    `<dc:publisher><rdf:Bag><rdf:li>${escapeXml(publisher)}</rdf:li></rdf:Bag></dc:publisher>` +
    `</rdf:Description></rdf:RDF></x:xmpmeta>` +
    `<?xpacket end="w"?>`
  );
}

/**
 * The EXIF tags written alongside (sharp's withExif shape).
 * @param {{ tool?: string }} [opts]
 */
export function aiImageExif(opts = {}) {
  const tool = opts.tool ?? "generative AI";
  return {
    IFD0: {
      ImageDescription: `${AI_IMAGE_DESCRIPTION_EN} (${tool}) / ${AI_IMAGE_DESCRIPTION_DE}`,
      Software: tool,
    },
  };
}

/**
 * Apply the marking to a sharp pipeline (chain before the encoder).
 * @template T
 * @param {T} pipeline a sharp instance
 * @param {{ tool?: string, createdAt?: Date }} [opts]
 * @returns {T}
 */
export function markAsAiGenerated(pipeline, opts = {}) {
  return pipeline.withMetadata().withExif(aiImageExif(opts)).withXmp(aiImageXmp(opts));
}

/** Does a file carry our marking? (For tests and the compare script.) */
export async function readAiMarking(image) {
  const { default: sharp } = await import("sharp");
  const meta = await sharp(image).metadata();
  const xmp = meta.xmp ? Buffer.from(meta.xmp).toString("utf8") : "";
  const exif = meta.exif ? Buffer.from(meta.exif).toString("latin1") : "";
  return {
    digitalSourceType: xmp.includes(AI_DIGITAL_SOURCE_TYPE),
    xmpDescription: xmp.includes(AI_IMAGE_DESCRIPTION_EN),
    exifDescription: exif.includes(AI_IMAGE_DESCRIPTION_EN),
  };
}
