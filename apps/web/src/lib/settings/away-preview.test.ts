import { describe, expect, it } from "vitest";

import {
  DEFAULT_REVIEW_MESSAGE,
  previewAwayMessage,
  previewReviewAsk,
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

describe("previewReviewAsk", () => {
  it("fills the default template with the business name and link", () => {
    expect(previewReviewAsk("Ace Plumbing", "https://g.page/r/xyz")).toBe(
      "Thanks for choosing Ace Plumbing! A quick Google review means a lot: https://g.page/r/xyz",
    );
  });

  it("degrades the link token cleanly when no link is stored", () => {
    expect(previewReviewAsk("Ace Plumbing", null)).toBe(
      "Thanks for choosing Ace Plumbing! A quick Google review means a lot:",
    );
  });

  it("uses the same default template constant the API ships", () => {
    expect(DEFAULT_REVIEW_MESSAGE).toContain("{business_name}");
    expect(DEFAULT_REVIEW_MESSAGE).toContain("{review_link}");
  });
});
