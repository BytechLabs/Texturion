/**
 * #260 — the checkout idempotency key must describe the cart it is sent with.
 *
 * The key used to be assembled from a hand-listed set of inputs (plan +
 * modules). The $29 US-registration line depends on none of them, and the two
 * inputs it does depend on are editable on the plan step between attempts BY
 * DESIGN — so a customer who changed their US answer sent the same key with
 * different parameters, Stripe answered `idempotency_error`, and checkout was
 * hard-blocked for roughly a day. Retrying reused the key, and with no offerable
 * add-ons there was no other cart input they could change to escape.
 */
import { describe, expect, it } from "vitest";

import { cartSignature, idempotencyKey } from "./idempotency";

const LICENSED = "price_licensed";
const METERED = "price_metered";
const US_FEE = "price_us_fee";

describe("idempotencyKey", () => {
  it("joins the company, the intent and its discriminators", () => {
    expect(idempotencyKey("co_1", "checkout", "a", "b")).toBe(
      "co_1:checkout:a:b",
    );
  });

  it("separates two intents for the same company", () => {
    expect(idempotencyKey("co_1", "checkout")).not.toBe(
      idempotencyKey("co_1", "us_registration_fee"),
    );
  });
});

describe("cartSignature", () => {
  it("changes when the $29 fee line appears — the bug", () => {
    // Same plan, same modules, one extra line. These MUST NOT collide, or
    // Stripe rejects the second attempt and the customer is stuck for a day.
    const without = cartSignature([
      { price: LICENSED, quantity: 1 },
      { price: METERED },
    ]);
    const withFee = cartSignature([
      { price: LICENSED, quantity: 1 },
      { price: METERED },
      { price: US_FEE, quantity: 1 },
    ]);
    expect(withFee).not.toBe(without);
  });

  it("is stable across the order lines were pushed", () => {
    // Two identical carts assembled in a different order are the same cart, and
    // must collapse to one Checkout Session — that is what the key is FOR.
    const a = cartSignature([
      { price: LICENSED, quantity: 1 },
      { price: US_FEE, quantity: 1 },
    ]);
    const b = cartSignature([
      { price: US_FEE, quantity: 1 },
      { price: LICENSED, quantity: 1 },
    ]);
    expect(a).toBe(b);
  });

  it("treats a missing quantity as one, so metered lines are stable", () => {
    // A metered price carries NO quantity by requirement (SPEC §9). If undefined
    // and 1 signed differently, an unchanged cart would look changed.
    expect(cartSignature([{ price: METERED }])).toBe(
      cartSignature([{ price: METERED, quantity: 1 }]),
    );
  });

  it("distinguishes a different quantity of the same price", () => {
    expect(cartSignature([{ price: LICENSED, quantity: 1 }])).not.toBe(
      cartSignature([{ price: LICENSED, quantity: 2 }]),
    );
  });

  it("distinguishes a different price", () => {
    expect(cartSignature([{ price: LICENSED }])).not.toBe(
      cartSignature([{ price: US_FEE }]),
    );
  });

  it("survives a line with no price rather than throwing", () => {
    // Defensive: a malformed line should still produce a key, because failing
    // here would turn a cart-building mistake into a 500 at checkout.
    expect(cartSignature([{}])).toBe("?x1");
  });

  it("covers a future line by construction, which is the point", () => {
    // The class fix: nobody has to remember to add the next line item to the
    // key, because adding it to the cart changes the signature.
    const base = cartSignature([{ price: LICENSED, quantity: 1 }]);
    const grown = cartSignature([
      { price: LICENSED, quantity: 1 },
      { price: "price_something_new", quantity: 1 },
    ]);
    expect(grown).not.toBe(base);
  });
});
