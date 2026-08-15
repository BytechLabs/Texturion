/**
 * #583 / D131 — the promise itself, where it is written.
 *
 * The parity vectors hold Kotlin and Swift to this file. Nothing holds this file to
 * anything, so what it must never say is asserted here rather than assumed — the
 * ports would faithfully reproduce a wrong promise.
 */
import { describe, expect, it } from "vitest";

import { prepaidConversionCopy } from "./prepaid-conversion-copy";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/** #228 — the module names keys now, so the tests resolve them. */
function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[name];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

const sayEn = (key: string): string => look(WEB_EN, key);
const sayFr = (key: string): string => look(WEB_FR, key);


describe("#583 what the prepaid-conversion copy promises", () => {
  it("names the amount coming back, in the sentence and again on the tick", () => {
    const copy = prepaidConversionCopy("starter", "pro", "$217.50", sayEn);
    expect(copy.heading).toBe("You have a prepaid Starter year running.");
    expect(copy.explanation).toContain("$217.50");
    // The tick carries the figure it agrees to. "End my prepaid year" alone asks
    // somebody to consent to a number they have to go back up the dialog to find.
    expect(copy.acknowledgement).toBe("End my prepaid year and credit me $217.50");
  });

  it("says CREDIT, and never months of free service", () => {
    // THE PROMISE THE MECHANISM CANNOT KEEP. Stripe applies a customer credit
    // balance to the whole invoice — overage, modules, extra numbers — so a heavy
    // month spends it and the plan fee still lands on the card. "Two months of Pro
    // free" is exactly the promise D107 rejected customer credit for making at the
    // other end of this feature, and repeating it here would resurrect that defect
    // in the customer's understanding rather than in the code.
    for (const credit of ["$217.50", "CA$298", null]) {
      const copy = prepaidConversionCopy("starter", "pro", credit, sayEn);
      const said = `${copy.heading} ${copy.explanation} ${copy.acknowledgement}`;
      expect(said).not.toMatch(/free/i);
      expect(said).not.toMatch(/months? of/i);
    }
    expect(prepaidConversionCopy("starter", "pro", "$1", sayEn).explanation).toMatch(
      /as credit, which comes off your next invoices/,
    );
  });

  it("promises no number when it has none", () => {
    // A row written before the conversion columns existed sends no figure. Anything
    // that interpolated the null anyway would say "puts  back on your account" —
    // broken, and a promise about an amount nobody named.
    const copy = prepaidConversionCopy("pro", "starter", null, sayEn);
    expect(copy.explanation).toBe(
      "Switching ends the prepaid year. You then pay the normal Starter monthly price.",
    );
    expect(copy.acknowledgement).toBe("End my prepaid year");
    expect(copy.explanation).not.toContain("undefined");
    expect(copy.explanation).not.toContain("null");
    // No stray double space where the amount would have gone.
    expect(copy.explanation).not.toMatch(/ {2}/);
  });

  it("names the plan they are leaving and the plan they are joining, separately", () => {
    // Reading one where the other belongs is the mistake a two-plan product makes,
    // and it is invisible when both happen to be the same word.
    const copy = prepaidConversionCopy("pro", "starter", "$592.50", sayEn);
    expect(copy.heading).toContain("Pro");
    expect(copy.explanation).toContain("normal Starter monthly price");
  });
});

describe("#228 the consent a French reader gives", () => {
  it("keeps the plan name untranslated inside a translated sentence", () => {
    // "Pro" and "Starter" are what the plans are called on the pricing page,
    // in Stripe and on an invoice. A French reader picks "Pro" too, so the
    // name rides in as a variable and only the sentence around it changes.
    const copy = prepaidConversionCopy("starter", "pro", "$120.00", sayFr);
    expect(copy.heading).toBe("Vous avez une année prépayée Starter en cours.");
    expect(copy.explanation).toContain("forfait Pro");
    expect(copy.explanation, "a variable survived").not.toMatch(/\{/);
  });

  it("still says CREDIT and an amount, never months of free service", () => {
    // The promise the mechanism can keep. Stripe spends a credit balance on
    // the whole invoice, so "two months free" is a claim it cannot honour —
    // and a translation that reached for the friendlier phrasing would make
    // exactly the promise D107 rejected.
    const copy = prepaidConversionCopy("pro", "starter", "$240.00", sayFr);
    expect(copy.explanation).toContain("$240.00");
    expect(copy.explanation).toMatch(/crédit/i);
    expect(copy.explanation).not.toMatch(/mois gratuit/i);
    expect(copy.acknowledgement).toContain("$240.00");
  });

  it("promises no number when the server sent none", () => {
    // Null means no figure was recorded. The sentences say the year ends and
    // name nothing, which is the only honest thing to say without one — in
    // either language.
    for (const say of [sayEn, sayFr]) {
      const copy = prepaidConversionCopy("pro", "starter", null, say);
      expect(copy.explanation).not.toMatch(/\d/);
      expect(copy.acknowledgement).not.toMatch(/\d/);
      expect(copy.acknowledgement).not.toMatch(/\{/);
    }
  });
});
