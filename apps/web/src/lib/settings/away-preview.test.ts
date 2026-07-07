import { describe, expect, it } from "vitest";

import {
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
