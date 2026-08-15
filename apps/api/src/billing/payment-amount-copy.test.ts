/**
 * #228 — the wire's English and the catalogue's English are one sentence.
 *
 * The second table of its kind (see `extra-number-copy.test.ts`), and the
 * reasoning is identical: the server composes an `ApiError` message a client
 * built last month renders verbatim, so the English is written twice and
 * something has to compare the copies.
 *
 * Read as TEXT rather than imported: `apps/api` does not import `apps/web`
 * source and should not start.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PAYMENT_AMOUNT_REASONS_EN } from "./payment-amount-copy";

/** The web catalogue's `paymentsEn` block, where the clients read these from. */
function paymentsEnglish(): string {
  const file = readFileSync(
    join(import.meta.dirname, "../../../../apps/web/src/i18n/catalog.ts"),
    "utf8",
  );
  const start = file.indexOf("const paymentsEn");
  const end = file.indexOf("const paymentsFr");
  if (start < 0 || end < 0) {
    throw new Error("catalog.ts no longer has both payments blocks");
  }
  return file.slice(start, end);
}

describe("#228 the amount refusals the wire sends", () => {
  it("say word for word what the catalogue says", () => {
    const catalogue = paymentsEnglish();
    const entries = Object.entries(PAYMENT_AMOUNT_REASONS_EN);
    // A count, so "they all match" has a number behind it rather than being
    // an impression of an empty loop.
    expect(entries.length).toBe(3);
    for (const [key, sentence] of entries) {
      expect(
        catalogue.includes(JSON.stringify(sentence)),
        `${key} differs between the wire and the catalogue. The wire says:\n  ${sentence}`,
      ).toBe(true);
    }
  });

  it("leaves {amount} for the caller to fill", () => {
    // `formatMoney` knows the currency and this table does not. A figure typed
    // in here would be the USD one shown to a Canadian workspace — the bug the
    // currency parameter exists to prevent.
    for (const key of [
      "payments.amountTooSmall",
      "payments.amountTooLarge",
    ] as const) {
      expect(PAYMENT_AMOUNT_REASONS_EN[key], key).toContain("{amount}");
    }
    // And the third one names no figure at all, so it must not carry a slot
    // nothing fills.
    expect(PAYMENT_AMOUNT_REASONS_EN["payments.amountNotWhole"]).not.toContain("{");
  });
});
