/**
 * #228 — the wire's English and the catalogue's English are one sentence.
 *
 * `EXTRA_NUMBER_REASONS_EN` exists because the server cannot pick the reader's
 * language: it composes an `errorResponse` body that a client built last month
 * renders verbatim. So the same sentence is written twice — once here for the
 * wire, once in the web catalogue for the three clients that translate it.
 *
 * Two copies of a sentence with no check between them is exactly how #389
 * happened: `docs/DATA-INVENTORY.md` was updated when AI shipped and the
 * public page was not, and the page went on claiming something untrue for
 * months. This is the check.
 *
 * Read as TEXT rather than imported: `apps/api` does not import `apps/web`
 * source and should not start. Same move the client-parity guards make with
 * Kotlin and Swift.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXTRA_NUMBER_REASONS_EN } from "./extra-number-copy";

/** The web catalogue's English half, where the clients read these from. */
function catalogueEnglish(): string {
  const file = readFileSync(
    join(import.meta.dirname, "../../../../apps/web/src/i18n/sections/settingsMore.ts"),
    "utf8",
  );
  const start = file.indexOf("export const settingsMoreEn");
  const end = file.indexOf("export const settingsMoreFr");
  if (start < 0 || end < 0) {
    throw new Error("settingsMore.ts no longer has both language blocks");
  }
  return file.slice(start, end);
}

describe("#228 the extra-number refusals the wire sends", () => {
  it("say word for word what the catalogue says", () => {
    const catalogue = catalogueEnglish();
    const entries = Object.entries(EXTRA_NUMBER_REASONS_EN);
    // A count, so "they all match" is a claim with a number behind it. An
    // empty table would otherwise pass this loop in silence.
    expect(entries.length).toBe(3);
    for (const [key, sentence] of entries) {
      expect(
        catalogue.includes(JSON.stringify(sentence)),
        `${key} differs between the wire and the catalogue. The wire says:\n  ${sentence}`,
      ).toBe(true);
    }
  });

  it("names every key the shared module can return", () => {
    // A missing entry would be `undefined` on the wire — an empty refusal,
    // which reads as the button being broken rather than as a rule.
    for (const key of [
      "settingsMore.extraNumberUsTexting",
      "settingsMore.extraNumberStarterCap",
      "settingsMore.extraNumberCurrency",
    ] as const) {
      expect(EXTRA_NUMBER_REASONS_EN[key], key).toBeTruthy();
    }
  });

  it("leaves {max} for the caller to fill", () => {
    // The cap is STARTER_MAX_TOTAL_NUMBERS and the shared module owns it. A
    // figure typed into this sentence goes stale the day the cap moves, and
    // the wire would then state a limit the product does not enforce.
    expect(EXTRA_NUMBER_REASONS_EN["settingsMore.extraNumberStarterCap"]).toContain(
      "{max}",
    );
  });
});
