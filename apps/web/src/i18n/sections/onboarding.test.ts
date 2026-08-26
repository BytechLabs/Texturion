import { describe, expect, it } from "vitest";

import { onboardingEn, onboardingFr } from "./onboarding";

describe("carrier-review defaults", () => {
  it.each([
    "textingDefaultMessageFlow",
    "textingDefaultSample1",
    "textingDefaultSample2",
  ] as const)("keeps %s in the English required by the US registry", (key) => {
    expect(onboardingFr[key]).toBe(onboardingEn[key]);
  });
});
