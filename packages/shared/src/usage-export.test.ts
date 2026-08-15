import { describe, expect, it } from "vitest";

import {
  EXPORT_USAGE_ACTION,
  EXPORT_USAGE_BLURB,
  EXPORT_USAGE_NOTE,
  lastCompleteMonth,
  USAGE_EXPORT_CAPABILITY,
} from "./usage-export";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/** #228 — the module names keys now, so the copy assertions resolve them. */
function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[
    name
  ];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

/**
 * #595 — the period three clients offer by default, and the words they offer it in.
 *
 * The cases below are chosen for what two implementations could DISAGREE about
 * rather than to be representative: month lengths, the year boundary, and the
 * three leap-year rules. `packages/shared/vectors` carries the same set to
 * Kotlin and Swift, so a hand-port that gets February wrong fails there rather
 * than shipping.
 */
describe("lastCompleteMonth", () => {
  it("gives the month before, whole", () => {
    expect(lastCompleteMonth(2026, 8)).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("does not offer the month still accruing", () => {
    // The bookkeeper's reason for this whole surface: a period that has not
    // finished produces a file that is out of date before it finishes building.
    const { from, to } = lastCompleteMonth(2026, 8);
    expect(from.startsWith("2026-08")).toBe(false);
    expect(to.startsWith("2026-08")).toBe(false);
  });

  it("rolls back across the year boundary", () => {
    expect(lastCompleteMonth(2026, 1)).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("knows a thirty-day month", () => {
    expect(lastCompleteMonth(2026, 5)).toEqual({
      from: "2026-04-01",
      to: "2026-04-30",
    });
  });

  it("knows February in a common year", () => {
    expect(lastCompleteMonth(2026, 3).to).toBe("2026-02-28");
  });

  it("knows February in a leap year", () => {
    expect(lastCompleteMonth(2024, 3).to).toBe("2024-02-29");
  });

  it("knows the century that is not a leap year", () => {
    // 2100 is divisible by 4 and by 100 and not by 400. A `% 4` shortcut is
    // right for every year this product will plausibly run and wrong here,
    // which is exactly the kind of wrong nobody would ever catch.
    expect(lastCompleteMonth(2100, 3).to).toBe("2100-02-28");
  });

  it("knows the century that is", () => {
    expect(lastCompleteMonth(2000, 3).to).toBe("2000-02-29");
  });

  it("pads every part to a sortable width", () => {
    const { from, to } = lastCompleteMonth(2026, 10);
    for (const day of [from, to]) {
      expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("the words and the gate", () => {
  it("asks for billing.manage, not the capability that guards customer data", () => {
    // The whole point of the bookkeeper role: they answer for the money and
    // never see the inbox. Gating this on `contacts.bulk` — which the workspace
    // and contact-history exports correctly use — would lock out the one person
    // this document exists for. The API agrees; see routes/exports.ts.
    expect(USAGE_EXPORT_CAPABILITY).toBe("billing.manage");
  });

  it("says what the file is not, where the decision is made", () => {
    expect(look(WEB_EN, EXPORT_USAGE_NOTE)).toContain(
      "not a copy of your Stripe invoice",
    );
    // The same disclaimer in French. A bookkeeper expecting an invoice is the
    // person this sentence exists for, and they do not stop existing in Quebec.
    expect(look(WEB_FR, EXPORT_USAGE_NOTE)).toMatch(/pas une copie de votre facture/i);
  });

  it("names no customer data in the promise it makes", () => {
    expect(look(WEB_EN, EXPORT_USAGE_BLURB)).toContain("texts, calls and storage");
    expect(look(WEB_FR, EXPORT_USAGE_BLURB)).toMatch(/textos.*appels.*stockage/i);
  });

  it("has an action label short enough for a phone row, in both languages", () => {
    // A CAP PER LANGUAGE, not one cap, and the difference is not a fudge.
    //
    // This assertion only ever saw English, and the French that both phones
    // have shipped for months — "Exporter l'utilisation", 22 characters — is
    // six over the English limit. Nobody knew, because the constant it read
    // held the English and nothing else.
    //
    // French runs longer than English for the same meaning; 20-30% is the
    // usual figure and this pair is at 22/12. A single number would either
    // pass vacuously for English or force a worse French translation to fit a
    // limit derived from a shorter language. So each language gets the number
    // its own row can take, and both are asserted rather than one.
    expect(look(WEB_EN, EXPORT_USAGE_ACTION).length).toBeLessThanOrEqual(16);
    expect(look(WEB_FR, EXPORT_USAGE_ACTION).length).toBeLessThanOrEqual(24);
  });
});
