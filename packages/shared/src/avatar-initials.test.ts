import { describe, expect, it } from "vitest";

import { avatarInitials } from "./avatar-initials";

/**
 * #582 — the cases the five implementations disagreed on, pinned once.
 *
 * Each `describe` below is one of the disagreements from the issue, so a future
 * change that reintroduces one has a test named after it rather than a diff.
 */

describe("a name with a middle name", () => {
  it("takes the first and the LAST word", () => {
    // The disagreement that was visible on one screen: the conversation avatar said
    // AM and the assignee chip beside it said AR, for the same person.
    expect(avatarInitials("Ana Maria Rojas")).toBe("AR");
  });

  it("still reads an ordinary two-word name the same way", () => {
    expect(avatarInitials("Sam Founder")).toBe("SF");
  });

  it("keeps taking the outermost two however many are in between", () => {
    expect(avatarInitials("Maria de los Angeles Cruz")).toBe("MC");
  });
});

describe("a contact with no name", () => {
  it("shows a hash, not the punctuation a phone number starts with", () => {
    // The badge is handed the FORMATTED number, so the naive answer is `(5` — which
    // every unnamed contact on both phones wore on the busiest list in the app.
    expect(avatarInitials("(415) 555-0134")).toBe("#");
    expect(avatarInitials("+1 415 555 0134")).toBe("#");
  });

  it("shows a question mark when there is nothing at all", () => {
    // Distinct from `#` on purpose: one is "this contact has no name", the other is
    // "we were given nothing". An empty badge reads as a broken image.
    expect(avatarInitials("")).toBe("?");
    expect(avatarInitials("   ")).toBe("?");
  });

  it("treats punctuation-only as no name rather than as initials", () => {
    expect(avatarInitials("--")).toBe("#");
    expect(avatarInitials("()")).toBe("#");
  });
});

describe("one word", () => {
  it("takes its first two letters", () => {
    expect(avatarInitials("Cher")).toBe("CH");
  });

  it("copes with a single letter", () => {
    expect(avatarInitials("X")).toBe("X");
  });
});

describe("names that are not two plain English words", () => {
  it("keeps a leading digit, because a business is allowed to start with one", () => {
    // The recorded cost of first-plus-last: this was `4S` under the old
    // first-plus-second rule. Nothing can tell a business name from a person's, and a
    // middle name is far commoner than a three-word business name.
    expect(avatarInitials("4th Street Deli")).toBe("4D");
    expect(avatarInitials("24 Hour Plumbing")).toBe("2P");
  });

  it("skips a word that is only punctuation", () => {
    expect(avatarInitials("Jean - Rojas")).toBe("JR");
  });

  it("returns a WHOLE character for a letter outside the basic plane", () => {
    // Three of the five indexed by code unit, so a character built from a surrogate
    // pair came back as half of itself — a lone surrogate, which renders as a box.
    // U+1D49C is a LETTER, so it is a legitimate initial and must survive intact.
    expect(avatarInitials("\u{1D49C}lice Rojas")).toBe("\u{1D49C}R");
  });

  it("skips an emoji rather than using it as an initial", () => {
    // An emoji is neither a letter nor a digit, so a word made only of one is
    // skipped and the real name wins. Better than showing it: two letters are what
    // the badge is for, and decoration should fall through to what it decorates.
    expect(avatarInitials("🙂 Rojas")).toBe("RO");
    // Inside a word it is simply passed over.
    expect(avatarInitials("Ana🙂 Rojas")).toBe("AR");
  });

  it("takes the letter out of a composed accent, the same way everywhere", () => {
    // Precomposed É is one code point and shows as itself.
    expect(avatarInitials("\u00C9mile Zola")).toBe("\u00C9Z");
    // DECOMPOSED is E followed by a combining acute. The letter is the E, and that
    // is what all three clients show — code points, not grapheme clusters. Written
    // as an escape because the two spellings are indistinguishable by eye.
    expect(avatarInitials("E\u0301mile Zola")).toBe("EZ");
  });

  it("upper-cases whatever it found", () => {
    expect(avatarInitials("ana rojas")).toBe("AR");
  });
});
