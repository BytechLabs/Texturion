import { describe, expect, it, vi } from "vitest";

// use-port-wizard is a "use client" module: its hook pulls next/navigation and
// the onboarding-state chain (react-query → @/env). portStepProgress itself is
// pure (derives from ../steps), so stub those so the import stays a node unit.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined }),
}));
vi.mock("../use-onboarding-state", () => ({
  useOnboardingState: () => ({}),
}));

import type { OnboardingSnapshot } from "../steps";
import { portStepProgress } from "./use-port-wizard";

/** Minimal snapshot; only company country/US-texting + draft drive the count. */
function snap(partial: Partial<OnboardingSnapshot>): OnboardingSnapshot {
  return {
    company: null,
    registration: null,
    draft: {},
    ...partial,
  } as OnboardingSnapshot;
}

function company(
  country: "US" | "CA",
  usTexting: boolean,
): OnboardingSnapshot["company"] {
  return {
    country,
    us_texting_enabled: usTexting,
    subscription_status: "incomplete",
    numbers: [],
    registration: { brand: null, campaign: null },
  } as unknown as OnboardingSnapshot["company"];
}

describe("portStepProgress", () => {
  it("is always the top-level 'number' step (index 2, never a sub-step count)", () => {
    // Whatever the branch, the port detour is the second dot — name is first.
    expect(portStepProgress(snap({ draft: { country: "US" } })).index).toBe(2);
    expect(
      portStepProgress(snap({ draft: { country: "CA", usTexting: false } }))
        .index,
    ).toBe(2);
  });

  it("totals 5 for a US signup (owes US registration)", () => {
    expect(portStepProgress(snap({ draft: { country: "US" } }))).toEqual({
      index: 2,
      total: 5,
    });
  });

  it("totals 3 for a CA signup that declined US texting", () => {
    expect(
      portStepProgress(snap({ draft: { country: "CA", usTexting: false } })),
    ).toEqual({ index: 2, total: 3 });
  });

  it("totals 5 for a CA signup that keeps US texting (explicit or default)", () => {
    expect(
      portStepProgress(snap({ draft: { country: "CA", usTexting: true } }))
        .total,
    ).toBe(5);
    // CA defaults to US texting on until explicitly declined.
    expect(
      portStepProgress(snap({ draft: { country: "CA" } })).total,
    ).toBe(5);
  });

  it("reads the company view once it exists (port creates it on sub-step 1)", () => {
    // CA-no-US company → 3; US company → 5. The draft may be empty by now, so
    // the total must come from the persisted company, not a hardcoded 5.
    expect(
      portStepProgress(snap({ company: company("CA", false) })).total,
    ).toBe(3);
    expect(
      portStepProgress(snap({ company: company("US", true) })).total,
    ).toBe(5);
  });
});
