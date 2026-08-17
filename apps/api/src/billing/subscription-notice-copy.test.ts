/**
 * #228 — the held-number notice is one sentence written in two places.
 *
 * The email keeps its English (`heldNumbersCopy`, next door: an address is not
 * a person whose language we have resolved) and the push is now composed per
 * reader, so the subject and the push title stopped being the same string and
 * became two copies of it. `heldNumbersCopy`'s own docblock says why that
 * matters — "one function so the email, the push and the billing surface cannot
 * describe the same state three different ways" — and the only thing that keeps
 * it true now they are apart is a check.
 *
 * The other half is cheaper and catches the failure #228 was written about: a
 * table whose French is still English. That is invisible at the call site,
 * because a site that takes a locale and ignores it looks exactly like one that
 * uses it.
 */
import { describe, expect, it } from "vitest";

import { heldNumbersCopy, type HeldNumber } from "./number-allowance";
import { SUBSCRIPTION_NOTICE_COPY } from "./subscription-notice-copy";

function held(count: number): HeldNumber[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `held-${index}`,
    number_e164: `+1415555010${index}`,
    suspended_at: "2026-07-30T00:00:00.000Z",
  }));
}

function subjectFor(count: number): string {
  return heldNumbersCopy({
    companyName: "523 Roofing",
    plan: "starter",
    allowance: 1,
    held: held(count),
  }).subject;
}

describe("#228 the held-number push title and the email subject", () => {
  it("say word for word the same English, on both sides of the plural", () => {
    const copy = SUBSCRIPTION_NOTICE_COPY.en;
    // Both arms, because the drift that matters most is a plural branch moving
    // in one file and not the other.
    expect(copy.numbersHeldTitle(1)).toBe(subjectFor(1));
    expect(copy.numbersHeldTitle(3)).toBe(subjectFor(3));
    // And the sentences themselves, so a matching pair of WRONG strings cannot
    // pass: the assertions above are satisfied by two identical mistakes.
    expect(copy.numbersHeldTitle(1)).toBe("One of your numbers is on hold");
    expect(copy.numbersHeldTitle(3)).toBe("3 of your numbers are on hold");
  });
});

describe("#228 the French half exists", () => {
  it("answers every notice in its own words, not in English", () => {
    const en = SUBSCRIPTION_NOTICE_COPY.en;
    const fr = SUBSCRIPTION_NOTICE_COPY["fr-CA"];

    expect(fr.cancellationTitle).not.toBe(en.cancellationTitle);
    expect(fr.cancellationBody).not.toBe(en.cancellationBody);
    expect(fr.numbersHeldTitle(1)).not.toBe(en.numbersHeldTitle(1));
    expect(fr.numbersHeldBody).not.toBe(en.numbersHeldBody);
  });

  it("branches on one-vs-many like the English does", () => {
    const fr = SUBSCRIPTION_NOTICE_COPY["fr-CA"];

    // « numéro est » / « numéros sont ». A French rendering that reused the
    // singular would read as broken grammar to the only people who can read it.
    expect(fr.numbersHeldTitle(1)).toBe("Un de vos numéros est en attente");
    expect(fr.numbersHeldTitle(4)).toBe("4 de vos numéros sont en attente");
  });

  it("keeps the deadline inside what a lock screen shows", () => {
    // The reason this title is shorter than the English rather than longer: at
    // roughly forty characters the OS stops drawing, and "30 jours" is the
    // entire notice. Pinned as a number so a later edit has to make the same
    // decision on purpose.
    expect(
      SUBSCRIPTION_NOTICE_COPY["fr-CA"].cancellationTitle.length,
    ).toBeLessThanOrEqual(40);
    expect(SUBSCRIPTION_NOTICE_COPY["fr-CA"].cancellationTitle).toContain(
      "30 jours",
    );
  });
});
