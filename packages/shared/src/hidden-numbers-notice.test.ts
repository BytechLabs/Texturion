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


describe("#286 telling a member a number is hidden", () => {
  it("HN-1: says nothing when nothing is hidden", () => {
    // The overwhelming default — most workspaces have no access rules at all
    // — and a notice that appeared for everybody would be noise on the one
    // screen a crew uses to send from.
    expect(hiddenNumbersNotice(0, sayEn)).toBeNull();
    expect(hiddenNumbersNotice(-1, sayEn)).toBeNull();
  });

  it("HN-2: counts, and reads as English at one", () => {
    // "1 more numbers" is the kind of detail that makes a product feel
    // unfinished on the screen where a new member is deciding whether to
    // trust it.
    expect(hiddenNumbersNotice(1, sayEn)).toMatch(/^One more number is/);
    expect(hiddenNumbersNotice(1, sayEn)).toMatch(/if you need it\.$/);
    expect(hiddenNumbersNotice(2, sayEn)).toMatch(/^2 more numbers are/);
    expect(hiddenNumbersNotice(2, sayEn)).toMatch(/if you need them\.$/);
  });

  it("HN-3: never leaks what it is explaining", () => {
    // A count and nothing else. If this ever grows a parameter for the
    // numbers themselves, it has become the leak the access rule exists to
    // prevent — so the signature is the guard.
    // #228 moved this from 1 to 2: the second is the reader's resolver.
    // The guard is unchanged in what it defends — a THIRD parameter is the
    // one that would carry the numbers, and this still fails on it.
    expect(hiddenNumbersNotice.length).toBe(2);
    for (const count of [1, 2, 5]) {
      const notice = hiddenNumbersNotice(count, sayEn)!;
      expect(notice).not.toMatch(/\+?\d{7,}/); // no phone number, in any shape
      expect(notice).not.toMatch(/\(\d{3}\)/);
    }
  });

  it("HN-4: points at the person who can actually change it", () => {
    // The member cannot, and sending them to look for a setting they do not
    // have is worse than saying nothing — it is a search that ends in the
    // same confusion, later.
    expect(hiddenNumbersNotice(1, sayEn)).toMatch(/Ask an owner/);
  });

  it("HN-5: says these are numbers on THIS account, not numbers in general", () => {
    // The distinction a new member needs: this is not "you cannot add
    // numbers", it is "the shop has more lines than you can see".
    expect(hiddenNumbersNotice(3, sayEn)).toMatch(/on this account/);
    expect(hiddenNumbersNotice(3, sayEn)).toMatch(/not shared with you/);
  });
});

describe("#228 the notice in French", () => {
  it("agrees the verb with the count", () => {
    // "Un autre numéro SE TROUVE" against "{count} autres numéros SE
    // TROUVENT" — the verb changes, not just the noun, so one template with a
    // number in it could not have carried both.
    expect(hiddenNumbersNotice(1, sayFr)).toContain("se trouve sur ce compte");
    expect(hiddenNumbersNotice(3, sayFr)).toContain("se trouvent sur ce compte");
    expect(hiddenNumbersNotice(3, sayFr)).toContain("3");
  });

  it("keeps the one useful action in both languages", () => {
    // The point of the sentence: there is nothing to click, so it names the
    // person to ask. A translation that dropped that leaves a dead end.
    expect(hiddenNumbersNotice(2, sayEn)).toMatch(/ask an owner/i);
    expect(hiddenNumbersNotice(2, sayFr)).toMatch(/propriétaire/i);
  });

  it("says nothing when there is nothing hidden, in either language", () => {
    expect(hiddenNumbersNotice(0, sayEn)).toBeNull();
    expect(hiddenNumbersNotice(0, sayFr)).toBeNull();
  });
});
