import { test } from "node:test";
import assert from "node:assert/strict";
import { isRecipientActionLink, neutralizeRecipientLinks } from "./email-preview-links.mjs";

test("recognises every link that acts on the recipient", () => {
  for (const href of [
    "https://chat.motionsports.de/api/unsubscribe?token=abc.def&locale=en",
    "https://chat.motionsports.de/api/erase-data?token=abc.def",
    "https://chat.motionsports.de/api/confirm-marketing?token=x",
    "https://chat.motionsports.de/api/r/AbC123",
    "/api/unsubscribe?token=a",
  ]) {
    assert.equal(isRecipientActionLink(href), true, href);
  }
});

test("leaves shop, product and asset links alone", () => {
  for (const href of [
    "https://motionsports.de/products/rack",
    "https://chat.motionsports.de/api/email-hero-image/1.png",
    "https://chat.motionsports.de/api/unsubscribe-info",
    "mailto:service@motionsports.de",
    "#",
    "",
  ]) {
    assert.equal(isRecipientActionLink(href), false, href);
  }
  assert.equal(isRecipientActionLink(null), false);
});

test("neutralizes action hrefs in both quote styles and keeps the label", () => {
  const html =
    '<a href="https://x.de/api/unsubscribe?token=a.b&amp;locale=en">Abmelden</a> ' +
    "<a HREF='https://x.de/api/erase-data?token=c.d'>Daten löschen</a> " +
    '<a href="https://x.de/api/r/tok">Zum Warenkorb</a> ' +
    '<a href="https://motionsports.de/products/rack">Rack</a>';
  const out = neutralizeRecipientLinks(html);
  assert.equal(
    out,
    '<a href="#">Abmelden</a> ' +
      "<a HREF='#'>Daten löschen</a> " +
      '<a href="#">Zum Warenkorb</a> ' +
      '<a href="https://motionsports.de/products/rack">Rack</a>'
  );
  assert.ok(!out.includes("token="));
});

test("non-string input yields an empty string", () => {
  assert.equal(neutralizeRecipientLinks(undefined), "");
});
