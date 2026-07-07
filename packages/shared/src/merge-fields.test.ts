import { describe, expect, it } from "vitest";

import {
  applyMergeFields,
  hasMergeFields,
  MERGE_FIELD_TOKENS,
} from "./merge-fields";

describe("applyMergeFields — substitution", () => {
  it("substitutes {first_name} with the first token of the contact name", () => {
    expect(
      applyMergeFields("Hi {first_name}, on my way!", {
        contactName: "Dana Whitfield",
      }),
    ).toBe("Hi Dana, on my way!");
  });

  it("substitutes {business_name}", () => {
    expect(
      applyMergeFields("Thanks from {business_name}", {
        businessName: "Ace Plumbing",
      }),
    ).toBe("Thanks from Ace Plumbing");
  });

  it("handles a single-word name", () => {
    expect(applyMergeFields("Hi {first_name}", { contactName: "Sam" })).toBe(
      "Hi Sam",
    );
  });

  it("collapses surrounding whitespace in the name", () => {
    expect(
      applyMergeFields("Hi {first_name}!", { contactName: "   Jo   Ann  " }),
    ).toBe("Hi Jo!");
  });

  it("leaves text without tokens byte-for-byte unchanged", () => {
    const text = "No tokens here — just a plain message.";
    expect(applyMergeFields(text, { contactName: "Dana" })).toBe(text);
  });

  it("is case-insensitive on the token name", () => {
    expect(
      applyMergeFields("Hi {First_Name}", { contactName: "Dana Lee" }),
    ).toBe("Hi Dana");
  });
});

describe("applyMergeFields — graceful degradation", () => {
  it("drops {first_name} cleanly when the name is missing (no literal braces)", () => {
    const out = applyMergeFields("Hi {first_name}, thanks for calling.", {
      contactName: null,
    });
    expect(out).toBe("Hi, thanks for calling.");
    expect(out).not.toContain("{first_name}");
  });

  it("drops {first_name} when the name is empty/whitespace", () => {
    expect(
      applyMergeFields("Hi {first_name}, thanks.", { contactName: "   " }),
    ).toBe("Hi, thanks.");
  });

  it("drops a trailing token cleanly with no dangling space", () => {
    expect(
      applyMergeFields("Call {business_name}", { businessName: null }),
    ).toBe("Call");
  });

  it("drops unknown tokens without rendering the literal braces", () => {
    expect(
      applyMergeFields("Hi {first_name}, your {gizmo} is ready", {
        contactName: "Dana",
      }),
    ).toBe("Hi Dana, your is ready");
  });

  it("degrades multiple missing tokens at once", () => {
    expect(
      applyMergeFields("{first_name} — {business_name}", {}),
    ).toBe("—");
  });

  it("never emits a literal supported token even when all values absent", () => {
    const out = applyMergeFields("{first_name} {business_name}", {});
    for (const token of MERGE_FIELD_TOKENS) {
      expect(out).not.toContain(`{${token}}`);
    }
  });
});

describe("hasMergeFields", () => {
  it("detects supported tokens", () => {
    expect(hasMergeFields("Hi {first_name}")).toBe(true);
    expect(hasMergeFields("Business: {business_name}")).toBe(true);
  });

  it("ignores unknown tokens and brace-free text", () => {
    expect(hasMergeFields("Hi {gizmo}")).toBe(false);
    expect(hasMergeFields("plain text")).toBe(false);
    expect(hasMergeFields("a { b } c")).toBe(false);
  });
});
