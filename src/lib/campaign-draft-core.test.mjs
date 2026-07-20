import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldReuseCampaignDraft,
  moPromoBlockText,
  moPromoIntroText,
  moPromoCtaLabel,
} from "./campaign-draft-core.mjs";

test("draft idempotency: same depth + no regenerate → reuse", () => {
  assert.equal(shouldReuseCampaignDraft({ discountPercent: 10 }, 10, false), true);
  assert.equal(shouldReuseCampaignDraft({ discountPercent: 0 }, 0, false), true);
});

test("draft idempotency: changed depth overwrites (text + code must never disagree)", () => {
  assert.equal(shouldReuseCampaignDraft({ discountPercent: 10 }, 15, false), false);
  assert.equal(shouldReuseCampaignDraft({ discountPercent: 0 }, 10, false), false);
});

test("draft idempotency: explicit regenerate always overwrites; no draft → generate", () => {
  assert.equal(shouldReuseCampaignDraft({ discountPercent: 10 }, 10, true), false);
  assert.equal(shouldReuseCampaignDraft(null, 10, false), false);
  assert.equal(shouldReuseCampaignDraft(undefined, 0, false), false);
});

test("Mo promo block: both languages end with the exact deep link", () => {
  const url = "https://motionsports.de/?mo=open&utm_source=campaign&utm_medium=email";
  for (const lang of ["de", "en"]) {
    const block = moPromoBlockText(lang, url);
    assert.ok(block.endsWith(`\n${url}`), `${lang} block must end with the deep link`);
    assert.ok(block.startsWith(moPromoIntroText(lang)));
  }
});

test("Mo promo copy: calm — no urgency/countdown vocabulary", () => {
  for (const lang of ["de", "en"]) {
    const text = moPromoIntroText(lang).toLowerCase();
    for (const banned of ["nur noch", "countdown", "jetzt schnell", "hurry", "only today"]) {
      assert.ok(!text.includes(banned), `"${banned}" must not appear`);
    }
  }
  assert.equal(moPromoCtaLabel("de"), "Beratung mit Mo starten");
  assert.equal(moPromoCtaLabel("en"), "Start your consultation with Mo");
});
