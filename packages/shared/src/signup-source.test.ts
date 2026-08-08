import { describe, expect, it } from "vitest";

import {
  SIGNUP_SOURCES,
  SIGNUP_SOURCE_HINT,
  SIGNUP_SOURCE_LABELS,
  SIGNUP_SOURCE_PROMPT,
  isSignupSource,
} from "./signup-source";

describe("#288 signup source", () => {
  it("keeps the list inside what a person will read", () => {
    // Chunking: three to four. A longer list produces better taxonomy and worse
    // data, because the cost of answering rises and the skip rate with it.
    expect(SIGNUP_SOURCES.length).toBeLessThanOrEqual(4);
  });

  it("has a label for every source, and no blank ones", () => {
    // A missing label renders an empty chip — a control with nothing on it,
    // which is worse than the question not being asked.
    for (const source of SIGNUP_SOURCES) {
      expect(SIGNUP_SOURCE_LABELS[source]?.trim().length ?? 0).toBeGreaterThan(0);
    }
    expect(Object.keys(SIGNUP_SOURCE_LABELS)).toHaveLength(SIGNUP_SOURCES.length);
  });

  it("can see word of mouth, which is the entire reason it exists", () => {
    // Without this bucket the question answers nothing #296 could not already
    // answer passively.
    expect(SIGNUP_SOURCES).toContain("another_business");
  });

  it("does not use the word 'referral' in front of the owner", () => {
    // It would invite them to answer about our programme — "did I use a link?"
    // — when what is being asked is whether a human recommended us at all.
    expect(SIGNUP_SOURCE_LABELS.another_business.toLowerCase()).not.toContain(
      "referral",
    );
  });

  it("says out loud that answering is optional", () => {
    // An optional question in a signup flow reads as required unless it says
    // otherwise, and a required one here is friction on the screen that can
    // least afford it.
    expect(SIGNUP_SOURCE_HINT.toLowerCase()).toContain("optional");
    expect(SIGNUP_SOURCE_PROMPT.endsWith("?")).toBe(true);
  });

  it("rejects a value it does not know rather than storing it", () => {
    expect(isSignupSource("another_business")).toBe(true);
    expect(isSignupSource("Another_Business")).toBe(false);
    expect(isSignupSource("")).toBe(false);
    expect(isSignupSource("billboard")).toBe(false);
  });
});
