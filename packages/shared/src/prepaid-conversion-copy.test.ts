/**
 * #583 / D131 — the promise itself, where it is written.
 *
 * The parity vectors hold Kotlin and Swift to this file. Nothing holds this file to
 * anything, so what it must never say is asserted here rather than assumed — the
 * ports would faithfully reproduce a wrong promise.
 */
import { describe, expect, it } from "vitest";

import { prepaidConversionCopy } from "./prepaid-conversion-copy";

describe("#583 what the prepaid-conversion copy promises", () => {
  it("names the amount coming back, in the sentence and again on the tick", () => {
    const copy = prepaidConversionCopy("starter", "pro", "$217.50");
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
      const copy = prepaidConversionCopy("starter", "pro", credit);
      const said = `${copy.heading} ${copy.explanation} ${copy.acknowledgement}`;
      expect(said).not.toMatch(/free/i);
      expect(said).not.toMatch(/months? of/i);
    }
    expect(prepaidConversionCopy("starter", "pro", "$1").explanation).toMatch(
      /as credit, which comes off your next invoices/,
    );
  });

  it("promises no number when it has none", () => {
    // A row written before the conversion columns existed sends no figure. Anything
    // that interpolated the null anyway would say "puts  back on your account" —
    // broken, and a promise about an amount nobody named.
    const copy = prepaidConversionCopy("pro", "starter", null);
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
    const copy = prepaidConversionCopy("pro", "starter", "$592.50");
    expect(copy.heading).toContain("Pro");
    expect(copy.explanation).toContain("normal Starter monthly price");
  });
});
