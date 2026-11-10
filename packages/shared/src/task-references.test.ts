import { describe, expect, it } from "vitest";

import {
  parseReferenceTokens,
  recordReferenceText,
  referenceQueryAt,
  taskNumberLabel,
  taskReferenceText,
} from "./task-references";

describe("parseReferenceTokens", () => {
  it("finds a task, a contact and a conversation", () => {
    const tokens = parseReferenceTokens("see #T-142, #contact-1A2B3C4D and #conv-abcdef01.");
    expect(tokens.map((t) => [t.kind, t.key])).toEqual([
      ["task", "142"],
      ["contact", "1a2b3c4d"],
      ["conversation", "abcdef01"],
    ]);
    expect(tokens[0]).toMatchObject({ start: 4, end: 10, raw: "#T-142" });
  });
  it("reads t-7 and leading zeros as number 7", () => {
    expect(parseReferenceTokens("#t-007")[0].key).toBe("7");
  });
  it("starts a line, follows punctuation, and follows a space", () => {
    expect(parseReferenceTokens("#T-1")).toHaveLength(1);
    expect(parseReferenceTokens("(#T-1)")).toHaveLength(1);
    expect(parseReferenceTokens("a,#T-1 #T-2")).toHaveLength(2);
  });
  it("is not a reference inside a word, after a hash, or before a letter or digit", () => {
    expect(parseReferenceTokens("a#T-1")).toHaveLength(0);
    expect(parseReferenceTokens("##T-1")).toHaveLength(0);
    expect(parseReferenceTokens("#T-1x")).toHaveLength(0);
    expect(parseReferenceTokens("#T-1234567890")).toHaveLength(0);
    expect(parseReferenceTokens("#contact-1a2b3c4")).toHaveLength(0);
    expect(parseReferenceTokens("#contact-1a2b3c4d5")).toHaveLength(0);
    expect(parseReferenceTokens("#contact-zzzzzzzz")).toHaveLength(0);
  });
  it("ignores a bare hash and a hashtag", () => {
    expect(parseReferenceTokens("# #urgent #T- #T")).toEqual([]);
  });
  it("says nothing for text with no tokens", () => {
    expect(parseReferenceTokens("")).toEqual([]);
    expect(parseReferenceTokens("Call back about order #4412 please")).toEqual([]);
  });
});

describe("the text a picker inserts", () => {
  it("is what the scan reads back", () => {
    expect(taskReferenceText(142)).toBe("#T-142");
    expect(taskNumberLabel(142)).toBe("T-142");
    const id = "1a2b3c4d-0000-4000-8000-000000000001";
    expect(recordReferenceText("contact", id)).toBe("#contact-1a2b3c4d");
    expect(recordReferenceText("conversation", id)).toBe("#conv-1a2b3c4d");
    expect(parseReferenceTokens(recordReferenceText("conversation", id))[0].key).toBe("1a2b3c4d");
  });
});

describe("referenceQueryAt", () => {
  it("opens on a hash at the caret and carries what follows", () => {
    expect(referenceQueryAt("hello #", 7)).toEqual({ start: 6, query: "" });
    expect(referenceQueryAt("hello #fur", 10)).toEqual({ start: 6, query: "fur" });
    expect(referenceQueryAt("#T-14", 5)).toEqual({ start: 0, query: "T-14" });
  });
  it("is closed when the caret is not in a hash word", () => {
    expect(referenceQueryAt("hello world", 11)).toBeNull();
    expect(referenceQueryAt("hello # world", 13)).toBeNull();
  });
  it("is closed for a hash inside a word or after another hash", () => {
    expect(referenceQueryAt("No4#4", 5)).toBeNull();
    expect(referenceQueryAt("##", 2)).toBeNull();
  });
});
