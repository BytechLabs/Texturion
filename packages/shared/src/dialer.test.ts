/**
 * #459 — the keypad as a name search.
 *
 * The behaviour that has to hold: nothing about number matching changes, names
 * become reachable, and the shared book beats a personal phone entry for the
 * same person.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_DIALER_MATCHES,
  bestDialerMatch,
  nationalDigits,
  rankDialerCandidates,
  scoreDialerCandidate,
  t9Words,
  type DialerCandidate,
} from "./dialer";

const app = (name: string | null, number: string, contactId = "c1"): DialerCandidate => ({
  name,
  number,
  source: "app",
  contactId,
});

const device = (name: string | null, number: string): DialerCandidate => ({
  name,
  number,
  source: "device",
});

describe("nationalDigits", () => {
  it("makes the three ways of writing one number compare equal", () => {
    expect(nationalDigits("+14165550123")).toBe("4165550123");
    expect(nationalDigits("14165550123")).toBe("4165550123");
    expect(nationalDigits("(416) 555-0123")).toBe("4165550123");
  });

  it("leaves a non-NANP length alone rather than guessing", () => {
    // Dropping a leading 1 from an eleven-digit number is a NANP rule, not a
    // general one. A ten-digit number starting with 1 keeps every digit.
    expect(nationalDigits("+447700900123")).toBe("447700900123");
    expect(nationalDigits("1234567890")).toBe("1234567890");
  });
});

describe("t9Words", () => {
  it("spells a name the way the keypad is printed", () => {
    expect(t9Words("Bob")).toEqual(["262"]);
    expect(t9Words("Dana Whitcomb")).toEqual(["3262", "94482662"]);
  });

  it("splits on anything that is not a letter or a digit", () => {
    // "Mc Coy", "O'Brien" and "Smith-Jones" are all names people have, and all
    // three must be reachable by typing the second part.
    expect(t9Words("O'Brien")).toEqual(["6", "27436"]);
    expect(t9Words("Smith-Jones")).toEqual(["76484", "56637"]);
  });

  it("keeps digits that are already in the name", () => {
    expect(t9Words("A1 Plumbing")).toEqual(["21", "75862464"]);
  });

  it("returns nothing for a name with no letters or digits at all", () => {
    expect(t9Words("&&&")).toEqual([]);
    expect(t9Words("")).toEqual([]);
  });
});

describe("scoreDialerCandidate — numbers behave exactly as before", () => {
  it("ranks an exact number above a tail above a substring", () => {
    const exact = scoreDialerCandidate("4165550123", app(null, "+14165550123"));
    const tail = scoreDialerCandidate("5550123", app(null, "+14165550123"));
    const inside = scoreDialerCandidate("6555", app(null, "+14165550123"));
    expect(exact).toBeGreaterThan(tail);
    expect(tail).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(0);
  });

  it("will not match a number on fewer than four digits", () => {
    // Below four, every contact in the book matches and the list is noise.
    expect(scoreDialerCandidate("416", app(null, "+14165550123"))).toBe(0);
  });
});

describe("scoreDialerCandidate — names, which is the new part", () => {
  it("finds a first name from its keypad letters", () => {
    // B-O-B is 2-6-2. This is the whole feature in one assertion.
    expect(scoreDialerCandidate("262", app("Bob Vance", "+14165550123"))).toBeGreaterThan(0);
  });

  it("ranks a first-word match above a later-word one", () => {
    const first = scoreDialerCandidate("3262", app("Dana Whitcomb", "+14165550123"));
    const later = scoreDialerCandidate("94482662", app("Dana Whitcomb", "+14165550123"));
    expect(first).toBeGreaterThan(later);
    expect(later).toBeGreaterThan(0);
  });

  it("does NOT match in the middle of a word", () => {
    // "Alaska" contains L-A-S (5-2-7) mid-word. Matching there returns a list
    // nobody trusts, and an untrusted list is one people stop reading.
    expect(scoreDialerCandidate("527", app("Alaska Roofing", "+14165550123"))).toBe(0);
  });

  it("is case-insensitive and ignores punctuation between words", () => {
    expect(scoreDialerCandidate("56637", app("SMITH-JONES", "+14165550123"))).toBeGreaterThan(0);
  });

  it("needs two digits, so a single keypress does not match the whole book", () => {
    expect(scoreDialerCandidate("2", app("Bob Vance", "+14165550123"))).toBe(0);
    expect(scoreDialerCandidate("26", app("Bob Vance", "+14165550123"))).toBeGreaterThan(0);
  });

  it("scores a number-only contact on its number alone", () => {
    expect(scoreDialerCandidate("262", app(null, "+14165550123"))).toBe(0);
    expect(scoreDialerCandidate("5550123", app(null, "+14165550123"))).toBeGreaterThan(0);
  });

  it("lets an exact number beat a name that also matches", () => {
    const exactNumber = scoreDialerCandidate("4165550123", app("Zoe", "+14165550123"));
    const nameOnly = scoreDialerCandidate("963", app("Zoe", "+14165559999"));
    expect(exactNumber).toBeGreaterThan(nameOnly);
  });
});

describe("rankDialerCandidates", () => {
  it("returns matches best first", () => {
    const ranked = rankDialerCandidates("5550123", [
      // Contains the typed digits but does not end with them: a real but weak
      // match, listed first so ordering rather than input order is proven.
      app("Far Away", "+15555012399"),
      app("Dana Whitcomb", "+14165550123"),
    ]);
    expect(ranked[0].label).toBe("Dana Whitcomb");
  });

  it("lets the shared book win over a personal phone entry for one person", () => {
    // The founder's rule: a device contact SUPPLEMENTS ours. Same number, same
    // quality of match, our row wins and the duplicate never renders.
    const ranked = rankDialerCandidates("5550123", [
      app("Dana Whitcomb", "+14165550123"),
      device("Dana (roofer)", "+1 416-555-0123"),
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].label).toBe("Dana Whitcomb");
    expect(ranked[0].source).toBe("app");
  });

  it("lets our book win the tie NO MATTER which order they arrive in", () => {
    // The regression this exists to stop: collapsing duplicates before sorting
    // keeps whichever row came first, which hands the tie to the device
    // contact whenever the caller happens to list it first. The rule is that
    // our book wins the tie, not that it is passed first.
    const ranked = rankDialerCandidates("5550123", [
      device("Dana (roofer)", "+1 416-555-0123"),
      app("Dana Whitcomb", "+14165550123"),
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].label).toBe("Dana Whitcomb");
  });

  it("keeps a device contact that our book does not have", () => {
    const ranked = rankDialerCandidates("262", [
      app("Dana Whitcomb", "+14165550123"),
      device("Bob Vance", "+14165550188"),
    ]);
    expect(ranked.map((m) => m.label)).toEqual(["Bob Vance"]);
    expect(ranked[0].source).toBe("device");
  });

  it("caps the list, because four rows is a glance and ten is a directory", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      app(`Bobby ${i}`, `+1416555${String(1000 + i)}`, `c${i}`),
    );
    expect(rankDialerCandidates("262", many)).toHaveLength(MAX_DIALER_MATCHES);
  });

  it("drops a candidate with no dialable digits rather than showing a dead row", () => {
    expect(rankDialerCandidates("262", [app("Bob Vance", "")])).toEqual([]);
  });

  it("labels a number-only contact with its number", () => {
    const ranked = rankDialerCandidates("5550123", [app("  ", "+14165550123")]);
    expect(ranked[0].label).toBe("+14165550123");
  });

  it("carries our contact id through, and never invents one for a device row", () => {
    const ranked = rankDialerCandidates("262", [
      app("Bob Vance", "+14165550123", "contact-1"),
      device("Bobbi Sky", "+14165550188"),
    ]);
    expect(ranked[0].contactId).toBe("contact-1");
    expect(ranked[1].contactId).toBeNull();
  });

  it("returns nothing when nothing was typed", () => {
    expect(rankDialerCandidates("", [app("Bob Vance", "+14165550123")])).toEqual([]);
  });
});

describe("bestDialerMatch", () => {
  it("is the top of the same ranking, or null", () => {
    const candidates = [app("Dana Whitcomb", "+14165550123")];
    expect(bestDialerMatch("5550123", candidates)?.label).toBe("Dana Whitcomb");
    expect(bestDialerMatch("9999999", candidates)).toBeNull();
  });
});
