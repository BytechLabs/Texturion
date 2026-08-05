/**
 * #523 — the one rule for giving a number up, and the words that go with it.
 *
 * Two properties, and both were broken on web before this.
 *
 * THE RULE. Three clients answered one irreversible question three ways. Web's
 * was the loosest — any status with digits — so it offered "give it up for good"
 * to a workspace whose numbers are suspended because a card was declined, where
 * the answer is the card and the press cannot be undone. Web's was also, in a
 * different place, the tightest: a ported line never reaches this control at
 * all, which is what left a held ported number with no way out of a browser.
 *
 * THE WORDS. The shipped confirmation promised a free replacement — "a number is
 * included, so you can set up a new one here afterward" — which is exactly false
 * under a hold, because a workspace is on hold BECAUSE the included number is
 * already in use. Believing it costs money: a paid extra, or a refusal at the
 * Starter cap after the number is already gone.
 */
import { describe, expect, it } from "vitest";

import type { NumberStatus } from "@/lib/api/types";

import type { NumberHoldState } from "./number-hold";
import { mayReleaseNumber, releaseNumberBody } from "./release-number";

const E164 = "+14155550142";

/**
 * Every status, and whether it may be released while the subscription is live.
 *
 * A `Record` keyed by the union rather than a list, so a new `NumberStatus`
 * cannot be added without someone deciding what happens to the one control on
 * this screen that cannot be taken back. A list would have silently defaulted it
 * to "not covered by any test".
 */
const RELEASABLE_ON_A_LIVE_SUBSCRIPTION: Record<NumberStatus, boolean> = {
  active: true,
  suspended: true,
  provisioning: false,
  provision_failed: false,
  released: false,
};

describe("mayReleaseNumber — one rule, three clients", () => {
  it("answers every status the same way on a live subscription", () => {
    for (const [status, expected] of Object.entries(
      RELEASABLE_ON_A_LIVE_SUBSCRIPTION,
    ) as [NumberStatus, boolean][]) {
      expect(mayReleaseNumber(status, E164, true), status).toBe(expected);
    }
  });

  it("lets an owner give up a HELD number — the D6 defect", () => {
    // Releasing is the only way to stop paying a held line's carrier rent, the
    // only way to free the Starter slot, and the only way through the
    // Pro-to-Starter downgrade gate. `DELETE /v1/numbers/:id` has always allowed
    // it.
    expect(mayReleaseNumber("suspended", E164, true)).toBe(true);
  });

  it("withholds it when the PAYMENT is the problem, not the plan", () => {
    // A past-due workspace has every number suspended and the fix is the card.
    // This is the clause web did not have and Android argued for.
    expect(mayReleaseNumber("suspended", E164, false)).toBe(false);
    // …and the clause is about the hold alone. A working number is still the
    // owner's to give up whatever the subscription is doing.
    expect(mayReleaseNumber("active", E164, false)).toBe(true);
  });

  it("refuses a row with no digits, whatever its status", () => {
    // More than cosmetic: the confirmation asks the reader to type the number
    // back, which nobody can do for a row that has none.
    for (const status of Object.keys(
      RELEASABLE_ON_A_LIVE_SUBSCRIPTION,
    ) as NumberStatus[]) {
      expect(mayReleaseNumber(status, null, true), status).toBe(false);
    }
  });
});

describe("releaseNumberBody — the promise it must not make under a hold", () => {
  /** The clause that costs money when it is read under a hold. */
  const FREE_REPLACEMENT = "you can set up a new one here afterward";

  it("keeps the replacement promise for the case it is true of", () => {
    const body = releaseNumberBody(null);
    expect(body).toContain(FREE_REPLACEMENT);
    expect(body).toContain("doesn't change your plan or what you pay");
  });

  it("never promises a replacement to anybody on hold", () => {
    // The whole defect, asserted across every hold there is rather than the one
    // that prompted it — a third `NumberHoldState` must not quietly reopen it.
    const holds: NumberHoldState[] = [
      { kind: "over_allowance", allowance: 1 },
      { kind: "over_allowance", allowance: null },
      { kind: "subscription_inactive" },
      { kind: "unknown" },
    ];
    for (const hold of holds) {
      expect(releaseNumberBody(hold), hold.kind).not.toContain(
        FREE_REPLACEMENT,
      );
    }
  });

  it("names the other way out of the hold, first", () => {
    // Bringing the number back leaves the line working and its control is a
    // link away on the same card. Somebody who reached the irreversible button
    // by process of elimination should be told there was no elimination to do.
    const body = releaseNumberBody({ kind: "over_allowance", allowance: 1 });
    expect(body).toContain("rather than by bringing it back");
    expect(body).toContain("stops being over its allowance");
    expect(body).toContain("what you pay doesn't change");
  });

  it("declines to explain a hold it could not establish", () => {
    // `unknown` means suspended on a live subscription with the billing route
    // unread. The allowance sentence would be a guess, and the replacement
    // promise a guess in the direction that costs money.
    const body = releaseNumberBody({ kind: "unknown" });
    expect(body).toContain("can't tell from here");
    expect(body).not.toContain("your plan doesn't cover");
  });

  it("still warns that the number is gone for good, in every branch", () => {
    // The one thing that is true of all of them, and the reason for the typed
    // confirmation. A rewrite that drops it from a branch is the failure this
    // catches.
    const bodies = [
      releaseNumberBody(null),
      releaseNumberBody({ kind: "over_allowance", allowance: 1 }),
      releaseNumberBody({ kind: "subscription_inactive" }),
      releaseNumberBody({ kind: "unknown" }),
    ];
    for (const body of bodies) {
      expect(body).toContain("can't get the same number back");
      expect(body).toContain("Type the number to confirm.");
    }
  });
});
