import { describe, expect, it } from "vitest";

import {
  DEFAULT_REVIEW_MESSAGE,
  previewAwayMessage,
  previewMissedCallText,
  SAMPLE_FIRST_NAME,
} from "./away-preview";

describe("previewAwayMessage", () => {
  it("resolves {first_name} (sample) and {business_name}", () => {
    expect(
      previewAwayMessage(
        "Hi {first_name}, thanks for texting {business_name}. Reply URGENT for a no-heat emergency.",
        "Ace HVAC",
      ),
    ).toBe(
      `Hi ${SAMPLE_FIRST_NAME}, thanks for texting Ace HVAC. Reply URGENT for a no-heat emergency.`,
    );
  });

  it("drops {review_link} cleanly when no link is supplied", () => {
    expect(
      previewAwayMessage("Thanks {first_name} — review: {review_link}", "Ace"),
    ).toBe(`Thanks ${SAMPLE_FIRST_NAME} — review:`);
  });

  it("degrades an empty message to empty", () => {
    expect(previewAwayMessage("", "Ace")).toBe("");
  });
});

describe("previewMissedCallText", () => {
  it("resolves {business_name}", () => {
    expect(
      previewMissedCallText(
        "Sorry we missed your call! This is {business_name}.",
        "Ace HVAC",
      ),
    ).toBe("Sorry we missed your call! This is Ace HVAC.");
  });

  it("drops {first_name} — the server sends with no contact name", () => {
    // Mirrors apps/api missed-call.ts (contactName: null): a missed call is
    // usually a brand-new caller, so the sample name must never appear.
    expect(
      previewMissedCallText("Hi {first_name}, we missed your call.", "Ace"),
    ).toBe("Hi, we missed your call.");
  });
});

describe("DEFAULT_REVIEW_MESSAGE (suggested review template)", () => {
  it("uses only supported merge fields", () => {
    expect(DEFAULT_REVIEW_MESSAGE).toContain("{business_name}");
    expect(DEFAULT_REVIEW_MESSAGE).toContain("{review_link}");
  });
});
