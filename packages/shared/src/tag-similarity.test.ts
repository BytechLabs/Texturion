/**
 * #298 — the suggestion has to catch real duplicates without crying wolf.
 *
 * Both failures are costly and only one is obvious. Missing "Warranty" when
 * somebody types "warranty" lets the sprawl happen. Offering "was" when
 * somebody types "gas" trains them to dismiss the prompt, after which it
 * catches nothing at all — and that failure is invisible, because a dismissed
 * prompt looks exactly like a prompt that was never needed.
 */
import { describe, expect, it } from "vitest";

import {
  TAG_SUGGEST_DISTANCE,
  editDistance,
  normalizeTagName,
  suggestExistingTag,
  tagNameDistance,
} from "./tag-similarity";

const tags = [
  { id: "1", name: "Warranty" },
  { id: "2", name: "Quote sent" },
  { id: "3", name: "Emergency" },
  { id: "4", name: "Gas" },
];

describe("#298 normalizeTagName", () => {
  it("treats case, punctuation and spacing as the same idea", () => {
    expect(normalizeTagName("Quote sent")).toBe("quotesent");
    expect(normalizeTagName("quote-sent")).toBe("quotesent");
    expect(normalizeTagName("  QUOTE  SENT  ")).toBe("quotesent");
  });

  it("survives a name that is only punctuation", () => {
    expect(normalizeTagName("!!!")).toBe("");
  });
});

describe("#298 editDistance", () => {
  it("counts the edits", () => {
    expect(editDistance("warranty", "warrenty")).toBe(1);
    expect(editDistance("emergency", "emergancy")).toBe(1);
    expect(editDistance("abc", "abc")).toBe(0);
  });

  it("bails past the cap rather than computing a number nobody reads", () => {
    // The answer is only ever compared against a small threshold, so anything
    // beyond it is work spent on a value that gets discarded.
    expect(editDistance("warranty", "completely different", 3)).toBeGreaterThan(3);
  });

  it("is symmetric", () => {
    expect(editDistance("scheduled", "schedule")).toBe(
      editDistance("schedule", "scheduled"),
    );
  });
});

describe("#298 suggestExistingTag", () => {
  it("catches the case and punctuation variants, exactly", () => {
    // The commonest real duplicate, and the one the create-on-attach RPC
    // already prevents — this makes the client say so before it happens.
    expect(suggestExistingTag("warranty", tags)).toMatchObject({
      tag: { id: "1" },
      exact: true,
    });
    expect(suggestExistingTag("quote-sent", tags)).toMatchObject({
      tag: { id: "2" },
      exact: true,
    });
  });

  it("catches a typo as a near match", () => {
    expect(suggestExistingTag("warrenty", tags)).toMatchObject({
      tag: { id: "1" },
      exact: false,
    });
    expect(suggestExistingTag("emergancy", tags)).toMatchObject({
      tag: { id: "3" },
      exact: false,
    });
  });

  it("does NOT fuzzy-match a short name", () => {
    // "was" against "gas" is one edit and a completely different word. Below
    // the length floor an edit distance of two is most of the word, and a
    // prompt people dismiss is a prompt that stops working.
    expect(suggestExistingTag("was", tags)).toBeNull();
    expect(suggestExistingTag("van", tags)).toBeNull();
  });

  it("leaves a genuinely new tag alone", () => {
    // The common path, and the one that must stay frictionless.
    expect(suggestExistingTag("Roof", tags)).toBeNull();
    expect(suggestExistingTag("Needs parts", tags)).toBeNull();
  });

  it("prefers an exact normalised match over a closer-looking fuzzy one", () => {
    const withBoth = [
      { id: "a", name: "Warrantys" },
      { id: "b", name: "warranty" },
    ];
    expect(suggestExistingTag("Warranty", withBoth)).toMatchObject({
      tag: { id: "b" },
      exact: true,
    });
  });

  it("picks the closest when several are near", () => {
    const near = [
      { id: "a", name: "scheduling" },
      { id: "b", name: "scheduled" },
    ];
    expect(suggestExistingTag("schedule", near)).toMatchObject({ tag: { id: "b" } });
  });

  it("never throws on empty or punctuation-only input", () => {
    expect(suggestExistingTag("", tags)).toBeNull();
    expect(suggestExistingTag("!!!", tags)).toBeNull();
    expect(suggestExistingTag("Roof", [{ id: "x", name: "!!!" }])).toBeNull();
  });

  it("stays within the stated threshold", () => {
    // The constant is the contract three clients port; a change here is a
    // change to how noisy the prompt is on every one of them.
    expect(TAG_SUGGEST_DISTANCE).toBe(2);
    expect(tagNameDistance("Warranty", "warrenty")).toBe(1);
  });
});
