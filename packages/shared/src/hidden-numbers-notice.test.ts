/**
 * #286 — the sentence that turns a silent absence into an explanation.
 *
 * HN-3 is the one that matters. The whole point of this notice is to explain
 * an access rule, and naming the numbers would undo the rule it is explaining.
 * A member does not need to know WHICH line exists to understand that one
 * does.
 */
import { describe, expect, it } from "vitest";

import { hiddenNumbersNotice } from "./hidden-numbers-notice";

describe("#286 telling a member a number is hidden", () => {
  it("HN-1: says nothing when nothing is hidden", () => {
    // The overwhelming default — most workspaces have no access rules at all
    // — and a notice that appeared for everybody would be noise on the one
    // screen a crew uses to send from.
    expect(hiddenNumbersNotice(0)).toBeNull();
    expect(hiddenNumbersNotice(-1)).toBeNull();
  });

  it("HN-2: counts, and reads as English at one", () => {
    // "1 more numbers" is the kind of detail that makes a product feel
    // unfinished on the screen where a new member is deciding whether to
    // trust it.
    expect(hiddenNumbersNotice(1)).toMatch(/^One more number is/);
    expect(hiddenNumbersNotice(1)).toMatch(/if you need it\.$/);
    expect(hiddenNumbersNotice(2)).toMatch(/^2 more numbers are/);
    expect(hiddenNumbersNotice(2)).toMatch(/if you need them\.$/);
  });

  it("HN-3: never leaks what it is explaining", () => {
    // A count and nothing else. If this ever grows a parameter for the
    // numbers themselves, it has become the leak the access rule exists to
    // prevent — so the signature is the guard.
    expect(hiddenNumbersNotice.length).toBe(1);
    for (const count of [1, 2, 5]) {
      const notice = hiddenNumbersNotice(count)!;
      expect(notice).not.toMatch(/\+?\d{7,}/); // no phone number, in any shape
      expect(notice).not.toMatch(/\(\d{3}\)/);
    }
  });

  it("HN-4: points at the person who can actually change it", () => {
    // The member cannot, and sending them to look for a setting they do not
    // have is worse than saying nothing — it is a search that ends in the
    // same confusion, later.
    expect(hiddenNumbersNotice(1)).toMatch(/Ask an owner/);
  });

  it("HN-5: says these are numbers on THIS account, not numbers in general", () => {
    // The distinction a new member needs: this is not "you cannot add
    // numbers", it is "the shop has more lines than you can see".
    expect(hiddenNumbersNotice(3)).toMatch(/on this account/);
    expect(hiddenNumbersNotice(3)).toMatch(/not shared with you/);
  });
});
