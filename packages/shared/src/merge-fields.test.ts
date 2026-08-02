import { describe, expect, it } from "vitest";

import {
  applyMergeFields,
  hasMergeFields,
  mergeFieldsNeeded,
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

  it("detects an unknown token too (applyMergeFields strips it → composed text differs)", () => {
    expect(hasMergeFields("Hi {gizmo}")).toBe(true);
  });

  it("is false for brace-free or malformed (spaced) tokens", () => {
    expect(hasMergeFields("plain text")).toBe(false);
    expect(hasMergeFields("a { b } c")).toBe(false);
  });
});

describe("#274 the tokens that make a template do real work", () => {
  const full = {
    contactName: "Dana Reyes",
    businessName: "Ace Plumbing",
    contactAddress: "18 Rosewood Ave",
    senderName: "Sam Okafor",
    ourNumber: "(415) 555-0142",
    jobDay: "Tuesday",
    jobTime: "2:00 PM",
  };

  it("expresses the two messages a crew actually repeats", () => {
    // The issue's own examples, and the reason two tokens were not enough.
    expect(applyMergeFields("On my way to {address}", full)).toBe(
      "On my way to 18 Rosewood Ave",
    );
    expect(
      applyMergeFields("Confirming {job_day} at {job_time}", full),
    ).toBe("Confirming Tuesday at 2:00 PM");
  });

  it("signs with the person, not the company", () => {
    // {my_name} is a FIRST name for the same reason {first_name} is: "Sam" is
    // how a tech signs a text, and "Sam Okafor" reads like a letter.
    expect(applyMergeFields("- {my_name}", full)).toBe("- Sam");
  });

  it("gives the customer a number to reply to", () => {
    expect(applyMergeFields("Reply here or call {our_number}", full)).toBe(
      "Reply here or call (415) 555-0142",
    );
  });

  it("keeps a multi-line address on one line", () => {
    // It lands mid-sentence. A stored address with a newline in it would
    // otherwise break the message in two.
    expect(
      applyMergeFields("On my way to {address}", {
        ...full,
        contactAddress: "18 Rosewood Ave\nUnit 4",
      }),
    ).toBe("On my way to 18 Rosewood Ave, Unit 4");
  });

  it("degrades exactly as the original two did", () => {
    // The contract that must not change: a missing value drops the token and
    // the punctuation closes up behind it. Nobody ever sees a literal brace.
    expect(applyMergeFields("On my way to {address}", {})).toBe("On my way to");
    expect(applyMergeFields("Hi {first_name}, we're at {address}.", {})).toBe(
      "Hi, we're at.",
    );
    expect(applyMergeFields("Call {our_number} today", {})).not.toContain("{");
  });

  it("resolves a token the sender typed in capitals", () => {
    // The pattern has always been case-insensitive; a new token that was not
    // would be a trap only somebody shouting would find.
    expect(applyMergeFields("On my way to {ADDRESS}", full)).toBe(
      "On my way to 18 Rosewood Ave",
    );
  });
});

describe("#274 mergeFieldsNeeded — pay only for what a message asks for", () => {
  it("names the supported tokens present", () => {
    expect(mergeFieldsNeeded("Hi {first_name}, on my way to {address}")).toEqual(
      new Set(["first_name", "address"]),
    );
  });

  it("is empty for a message with no tokens, which is almost all of them", () => {
    // The point of the helper: the common send path must pay nothing. Three of
    // the new tokens cost a read to resolve.
    expect(mergeFieldsNeeded("On our way!").size).toBe(0);
    expect(mergeFieldsNeeded("").size).toBe(0);
  });

  it("ignores an unknown token, because nothing needs fetching for it", () => {
    expect(mergeFieldsNeeded("Hello {nonsense}").size).toBe(0);
  });

  it("reports a token once however often it appears", () => {
    expect(mergeFieldsNeeded("{my_name} and {my_name}")).toEqual(
      new Set(["my_name"]),
    );
  });

  it("does not disturb hasMergeFields' shared regex state", () => {
    // TOKEN_PATTERN is a module-level /g regex, so a helper that walked it and
    // left lastIndex parked would make the NEXT caller miss a match. That
    // failure is intermittent and looks like anything but its cause.
    const text = "Hi {first_name}";
    mergeFieldsNeeded(text);
    expect(hasMergeFields(text)).toBe(true);
    mergeFieldsNeeded(text);
    expect(hasMergeFields(text)).toBe(true);
  });
});
