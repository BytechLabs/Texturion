import { describe, expect, it } from "vitest";

import { insertMention, resolveMentions } from "./mentions";

describe("resolveMentions", () => {
  it("sends the id that was picked, not one guessed from the text", () => {
    // Two teammates share a display name. Parsing "@Sam" cannot say which one
    // the author meant, so only the pick counts.
    const ids = resolveMentions("@Sam can you look?", [
      { userId: "sam-rivera", name: "Sam" },
    ]);
    expect(ids).toEqual(["sam-rivera"]);
  });

  it("withdraws a mention whose name was deleted from the draft", () => {
    const ids = resolveMentions("never mind", [
      { userId: "sam-rivera", name: "Sam" },
    ]);
    expect(ids).toEqual([]);
  });

  it("keeps only the surviving names when one of several is removed", () => {
    const ids = resolveMentions("@Dana take this one", [
      { userId: "sam", name: "Sam" },
      { userId: "dana", name: "Dana" },
    ]);
    expect(ids).toEqual(["dana"]);
  });

  it("counts a teammate named twice as one mention", () => {
    const ids = resolveMentions("@Sam and again @Sam", [
      { userId: "sam", name: "Sam" },
      { userId: "sam", name: "Sam" },
    ]);
    expect(ids).toEqual(["sam"]);
  });
});

describe("insertMention", () => {
  it("replaces the @ that opened the picker", () => {
    const result = insertMention("hey @", 5, "Sam");
    expect(result.text).toBe("hey @Sam ");
    expect(result.caret).toBe(9);
  });

  it("inserts mid-draft and leaves the caret after the name", () => {
    const result = insertMention("hey @ can you look?", 5, "Sam");
    expect(result.text).toBe("hey @Sam can you look?");
    // No space was added (the draft already had one), so the caret sits
    // directly after the name rather than past a space that is not ours.
    expect(result.caret).toBe(8);
  });

  it("does not double the space when one already follows", () => {
    const result = insertMention("@ rest", 1, "Dana");
    expect(result.text).toBe("@Dana rest");
  });

  it("inserts without a trigger when the picker was opened another way", () => {
    const result = insertMention("hey ", 4, "Sam");
    expect(result.text).toBe("hey @Sam ");
  });
});
