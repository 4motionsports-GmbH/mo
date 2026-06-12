import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EMAIL_OFFERS_PER_CONVERSATION,
  shouldForceEmailOfferStep,
} from "./email-offer-trigger.mjs";

// A turn that hit the checkout moment: the model emitted the product card and
// the direct-checkout button, but no email offer.
const CHECKOUT_TURN = ["update_customer_profile", "show_product", "add_to_cart"];

test("two-ask cap constant is 2", () => {
  assert.equal(MAX_EMAIL_OFFERS_PER_CONVERSATION, 2);
});

test("full gating matrix (email present/absent × cap reached/not × declined/not), add_to_cart called", () => {
  for (const emailCaptured of [false, true]) {
    for (const offersMade of [0, 1, 2]) {
      for (const declined of [false, true]) {
        const fires = shouldForceEmailOfferStep({
          emailCaptured,
          offersMade,
          declined,
          toolNamesCalled: CHECKOUT_TURN,
        });
        const expected =
          !emailCaptured &&
          !declined &&
          offersMade < MAX_EMAIL_OFFERS_PER_CONVERSATION;
        assert.equal(
          fires,
          expected,
          `emailCaptured=${emailCaptured} offersMade=${offersMade} declined=${declined}`
        );
      }
    }
  }
});

test("fires at the checkout moment when fully eligible", () => {
  assert.equal(
    shouldForceEmailOfferStep({
      emailCaptured: false,
      offersMade: 0,
      declined: false,
      toolNamesCalled: CHECKOUT_TURN,
    }),
    true
  );
});

test("the forced ask may be the second of the two allowed asks", () => {
  // One prior (soft, model-initiated) offer in an earlier turn does not block
  // the deterministic checkout-moment ask — it becomes ask #2 of 2.
  assert.equal(
    shouldForceEmailOfferStep({
      emailCaptured: false,
      offersMade: 1,
      declined: false,
      toolNamesCalled: CHECKOUT_TURN,
    }),
    true
  );
});

test("never fires past the two-ask cap, even far past it", () => {
  for (const offersMade of [2, 3, 10]) {
    assert.equal(
      shouldForceEmailOfferStep({
        emailCaptured: false,
        offersMade,
        declined: false,
        toolNamesCalled: CHECKOUT_TURN,
      }),
      false
    );
  }
});

test("never fires without a checkout-intent (add_to_cart) call this turn", () => {
  for (const toolNamesCalled of [
    [],
    ["show_product"],
    ["update_customer_profile", "search_products", "show_product"],
    ["show_contact_form"],
  ]) {
    assert.equal(
      shouldForceEmailOfferStep({
        emailCaptured: false,
        offersMade: 0,
        declined: false,
        toolNamesCalled,
      }),
      false
    );
  }
});

test("never fires when the model already offered on its own this turn", () => {
  assert.equal(
    shouldForceEmailOfferStep({
      emailCaptured: false,
      offersMade: 0,
      declined: false,
      toolNamesCalled: [...CHECKOUT_TURN, "offer_email_summary"],
    }),
    false
  );
  // …regardless of call order within the turn.
  assert.equal(
    shouldForceEmailOfferStep({
      emailCaptured: false,
      offersMade: 0,
      declined: false,
      toolNamesCalled: ["offer_email_summary", ...CHECKOUT_TURN],
    }),
    false
  );
});

test("a decline suppresses the forced ask even at checkout intent", () => {
  assert.equal(
    shouldForceEmailOfferStep({
      emailCaptured: false,
      offersMade: 0,
      declined: true,
      toolNamesCalled: CHECKOUT_TURN,
    }),
    false
  );
});

test("a captured email suppresses the forced ask regardless of everything else", () => {
  assert.equal(
    shouldForceEmailOfferStep({
      emailCaptured: true,
      offersMade: 0,
      declined: false,
      toolNamesCalled: CHECKOUT_TURN,
    }),
    false
  );
});
