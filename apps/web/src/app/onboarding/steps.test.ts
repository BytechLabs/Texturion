import { describe, expect, it } from "vitest";

import type { RegistrationRow, SubscriptionStatus } from "@/lib/api/types";

import {
  applicableSteps,
  brandRowComplete,
  campaignRowComplete,
  draftOwesUsRegistration,
  hasPaid,
  owesUsRegistration,
  pathForLocation,
  previousStepHref,
  resolveOnboardingLocation,
  setupComplete,
  stepAllowed,
  stepProgress,
  type OnboardingDraft,
  type OnboardingSnapshot,
} from "./steps";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function row(overrides: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    id: "reg-1",
    kind: "brand",
    status: "draft",
    sole_proprietor: false,
    rejection_reason: null,
    submission_count: 0,
    submitted_at: null,
    approved_at: null,
    rejected_at: null,
    deactivated_at: null,
    ...overrides,
  };
}

const COMPLETE_BRAND_DATA = {
  displayName: "Mike's Plumbing",
  email: "mike@example.com",
  phone: "(416) 555-0182",
  vertical: "PROFESSIONAL",
  street: "1 Main St",
  city: "Toronto",
  state: "ON",
  postalCode: "M1M 1M1",
  country: "CA",
  companyName: "Mike's Plumbing Inc.",
  ein: "123456789",
  website: "https://mikesplumbing.com",
};

const COMPLETE_CAMPAIGN_DATA = {
  messageFlow:
    "Customers text our business number first, or ask us in person / by phone to text them.",
  sample1: "Hi, it's Mike — we can fit you in tomorrow at 9am.",
  sample2: "Your quote is ready: $180 for the full job.",
};

interface SnapshotOptions {
  company?: {
    country?: "US" | "CA";
    usTexting?: boolean;
    status?: SubscriptionStatus;
    numbers?: { status: string }[];
    campaign?: Partial<RegistrationRow> | null;
  } | null;
  brand?: Partial<RegistrationRow> | null;
  campaign?: Partial<RegistrationRow> | null;
  draft?: OnboardingDraft;
}

function snapshot(options: SnapshotOptions = {}): OnboardingSnapshot {
  const brand =
    options.brand === undefined || options.brand === null
      ? null
      : row({ kind: "brand", ...options.brand });
  const campaign =
    options.campaign === undefined || options.campaign === null
      ? null
      : row({ kind: "campaign", ...options.campaign });
  const c = options.company;
  return {
    company:
      c === null || c === undefined
        ? null
        : {
            country: c.country ?? "US",
            us_texting_enabled: c.usTexting ?? true,
            subscription_status: c.status ?? "incomplete",
            numbers: c.numbers ?? [],
            registration: {
              brand: brand,
              campaign:
                c.campaign === undefined
                  ? campaign
                  : c.campaign === null
                    ? null
                    : row({ kind: "campaign", ...c.campaign }),
            },
          },
    registration:
      options.brand === undefined && options.campaign === undefined
        ? null
        : { brand, campaign },
    draft: options.draft ?? {},
  };
}

const COMPLETE_DRAFT: OnboardingDraft = {
  name: "Mike's Plumbing",
  country: "US",
  areaCode: "212",
};

// ---------------------------------------------------------------------------
// owed-registration + completeness mirrors
// ---------------------------------------------------------------------------

describe("owesUsRegistration", () => {
  it("US companies always owe", () => {
    expect(
      owesUsRegistration({ country: "US", us_texting_enabled: true }),
    ).toBe(true);
  });
  it("CA owes only with US texting on", () => {
    expect(
      owesUsRegistration({ country: "CA", us_texting_enabled: true }),
    ).toBe(true);
    expect(
      owesUsRegistration({ country: "CA", us_texting_enabled: false }),
    ).toBe(false);
  });
});

describe("draftOwesUsRegistration", () => {
  it("US drafts owe; CA defaults to owing until declined", () => {
    expect(draftOwesUsRegistration({ country: "US" })).toBe(true);
    expect(draftOwesUsRegistration({ country: "CA" })).toBe(true);
    expect(draftOwesUsRegistration({ country: "CA", usTexting: false })).toBe(
      false,
    );
  });
});

describe("brandRowComplete / campaignRowComplete", () => {
  it("missing row or draft without data is incomplete", () => {
    expect(brandRowComplete(null)).toBe(false);
    expect(brandRowComplete(row())).toBe(false);
    expect(campaignRowComplete(row({ kind: "campaign" }))).toBe(false);
  });

  it("draft/rejected rows are complete only with every canonical key", () => {
    expect(brandRowComplete(row({ data: COMPLETE_BRAND_DATA }))).toBe(true);
    expect(
      brandRowComplete(
        row({ status: "rejected", data: COMPLETE_BRAND_DATA }),
      ),
    ).toBe(true);
    const missingEin: Record<string, unknown> = { ...COMPLETE_BRAND_DATA };
    delete missingEin.ein;
    expect(brandRowComplete(row({ data: missingEin }))).toBe(false);
  });

  it("sole-prop drafts require the person fields instead of companyName", () => {
    const soleData: Record<string, unknown> = {
      ...COMPLETE_BRAND_DATA,
      firstName: "Mike",
      lastName: "Rivera",
      ein: "1234",
      mobilePhone: "+14165550182",
    };
    delete soleData.companyName;
    delete soleData.website;
    expect(
      brandRowComplete(row({ sole_proprietor: true, data: soleData })),
    ).toBe(true);
    const noMobile: Record<string, unknown> = { ...soleData };
    delete noMobile.mobilePhone;
    expect(
      brandRowComplete(row({ sole_proprietor: true, data: noMobile })),
    ).toBe(false);
  });

  it("submitted/pending/approved rows count as complete without data", () => {
    for (const status of ["submitted", "pending", "approved"] as const) {
      expect(brandRowComplete(row({ status }))).toBe(true);
      expect(campaignRowComplete(row({ kind: "campaign", status }))).toBe(true);
    }
  });

  it("campaign completeness keys on messageFlow + both samples", () => {
    expect(
      campaignRowComplete(
        row({ kind: "campaign", data: COMPLETE_CAMPAIGN_DATA }),
      ),
    ).toBe(true);
    const partial: Record<string, unknown> = { ...COMPLETE_CAMPAIGN_DATA };
    delete partial.sample2;
    expect(campaignRowComplete(row({ kind: "campaign", data: partial }))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Resume routing — every phase of SPEC §4.1 maps to one surface
// ---------------------------------------------------------------------------

describe("resolveOnboardingLocation", () => {
  it("fresh account → name step", () => {
    expect(resolveOnboardingLocation(snapshot({ company: null }))).toEqual({
      kind: "step",
      step: "name",
    });
  });

  it("name saved locally → number step", () => {
    expect(
      resolveOnboardingLocation(
        snapshot({ company: null, draft: { name: "Mike's" } }),
      ),
    ).toEqual({ kind: "step", step: "number" });
  });

  it("US draft with area code but no company → business step", () => {
    expect(
      resolveOnboardingLocation(
        snapshot({ company: null, draft: COMPLETE_DRAFT }),
      ),
    ).toEqual({ kind: "step", step: "business" });
  });

  it("CA-no-US draft without a company → back to the number step (company is created there)", () => {
    expect(
      resolveOnboardingLocation(
        snapshot({
          company: null,
          draft: { name: "Mike's", country: "CA", areaCode: "416", usTexting: false },
        }),
      ),
    ).toEqual({ kind: "step", step: "number" });
  });

  it("US company pre-checkout without registration rows → business step", () => {
    expect(
      resolveOnboardingLocation(snapshot({ company: {} })),
    ).toEqual({ kind: "step", step: "business" });
  });

  it("brand complete but campaign missing → texting step", () => {
    expect(
      resolveOnboardingLocation(
        snapshot({
          company: {},
          brand: { data: COMPLETE_BRAND_DATA },
          campaign: null,
        }),
      ),
    ).toEqual({ kind: "step", step: "texting" });
  });

  it("both drafts complete pre-checkout → plan step", () => {
    expect(
      resolveOnboardingLocation(
        snapshot({
          company: {},
          brand: { data: COMPLETE_BRAND_DATA },
          campaign: { kind: "campaign", data: COMPLETE_CAMPAIGN_DATA },
        }),
      ),
    ).toEqual({ kind: "step", step: "plan" });
  });

  it("CA company with US texting off → straight to plan (wizard skipped)", () => {
    expect(
      resolveOnboardingLocation(
        snapshot({ company: { country: "CA", usTexting: false } }),
      ),
    ).toEqual({ kind: "step", step: "plan" });
  });

  it("canceled subscription resumes at the plan step (resubscribe)", () => {
    expect(
      resolveOnboardingLocation(
        snapshot({
          company: { status: "canceled" },
          brand: { status: "approved" },
          campaign: { kind: "campaign", status: "approved" },
        }),
      ),
    ).toEqual({ kind: "step", step: "plan" });
  });

  it("paid + number provisioning → setting-up", () => {
    expect(
      resolveOnboardingLocation(
        snapshot({
          company: {
            status: "active",
            numbers: [{ status: "provisioning" }],
          },
          brand: { status: "submitted" },
          campaign: { kind: "campaign", status: "submitted" },
        }),
      ),
    ).toEqual({ kind: "setting-up" });
  });

  it("paid US, number active, campaign still pending → setting-up", () => {
    expect(
      resolveOnboardingLocation(
        snapshot({
          company: {
            status: "active",
            numbers: [{ status: "active" }],
            campaign: { status: "pending" },
          },
          brand: { status: "approved" },
          campaign: { kind: "campaign", status: "pending" },
        }),
      ),
    ).toEqual({ kind: "setting-up" });
  });

  it("paid US, number active, campaign approved → inbox", () => {
    expect(
      resolveOnboardingLocation(
        snapshot({
          company: {
            status: "active",
            numbers: [{ status: "active" }],
            campaign: { status: "approved" },
          },
          brand: { status: "approved" },
          campaign: { kind: "campaign", status: "approved" },
        }),
      ),
    ).toEqual({ kind: "inbox" });
  });

  it("paid CA-only with an active number → inbox (no registration wait)", () => {
    expect(
      resolveOnboardingLocation(
        snapshot({
          company: {
            country: "CA",
            usTexting: false,
            status: "active",
            numbers: [{ status: "active" }],
            campaign: null,
          },
        }),
      ),
    ).toEqual({ kind: "inbox" });
  });

  it("deactivated campaign (post-grace resubscribe) keeps setting-up honest", () => {
    expect(
      resolveOnboardingLocation(
        snapshot({
          company: {
            status: "active",
            numbers: [{ status: "active" }],
            campaign: { status: "approved", deactivated_at: "2026-06-01T00:00:00Z" },
          },
        }),
      ),
    ).toEqual({ kind: "setting-up" });
  });
});

// ---------------------------------------------------------------------------
// Step gating
// ---------------------------------------------------------------------------

describe("stepAllowed", () => {
  it("name/number only exist before the company does", () => {
    const before = snapshot({ company: null });
    expect(stepAllowed("name", before)).toBe(true);
    expect(stepAllowed("number", before)).toBe(true);
    const after = snapshot({ company: {} });
    expect(stepAllowed("name", after)).toBe(false);
    expect(stepAllowed("number", after)).toBe(false);
  });

  it("business needs a complete local draft when the company is missing", () => {
    expect(stepAllowed("business", snapshot({ company: null }))).toBe(false);
    expect(
      stepAllowed(
        "business",
        snapshot({ company: null, draft: COMPLETE_DRAFT }),
      ),
    ).toBe(true);
  });

  it("registration steps close for CA-no-US companies and after payment", () => {
    const caOnly = snapshot({ company: { country: "CA", usTexting: false } });
    expect(stepAllowed("business", caOnly)).toBe(false);
    expect(stepAllowed("texting", caOnly)).toBe(false);
    expect(stepAllowed("plan", caOnly)).toBe(true);

    const paid = snapshot({ company: { status: "active" } });
    expect(stepAllowed("business", paid)).toBe(false);
    expect(stepAllowed("plan", paid)).toBe(false);
  });

  it("plan mirrors the checkout draft gate for owing companies", () => {
    expect(stepAllowed("plan", snapshot({ company: {} }))).toBe(false);
    expect(
      stepAllowed(
        "plan",
        snapshot({
          company: {},
          brand: { data: COMPLETE_BRAND_DATA },
          campaign: { kind: "campaign", data: COMPLETE_CAMPAIGN_DATA },
        }),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dots, helpers, paths
// ---------------------------------------------------------------------------

describe("applicableSteps / stepProgress", () => {
  it("US signups walk 5 steps; CA-no-US walks 3", () => {
    expect(applicableSteps(snapshot({ company: null, draft: COMPLETE_DRAFT })))
      .toEqual(["name", "number", "business", "texting", "plan"]);
    expect(
      applicableSteps(
        snapshot({ company: { country: "CA", usTexting: false } }),
      ),
    ).toEqual(["name", "number", "plan"]);
  });

  it("progress is 1-based within the applicable steps", () => {
    const ca = snapshot({ company: { country: "CA", usTexting: false } });
    expect(stepProgress("plan", ca)).toEqual({ index: 3, total: 3 });
    const us = snapshot({ company: {} });
    expect(stepProgress("business", us)).toEqual({ index: 3, total: 5 });
  });
});

describe("previousStepHref (honest Back navigation)", () => {
  it("returns null on plan for CA-no-US — the only steps behind are the locked name/number (the reported 'Back does nothing')", () => {
    const caOnly = snapshot({ company: { country: "CA", usTexting: false } });
    expect(previousStepHref("plan", caOnly)).toBeNull();
  });

  it("walks back to the nearest EDITABLE step for a US company", () => {
    const us = snapshot({ company: {} });
    // plan → texting (editable while owing US registration), texting → business.
    expect(previousStepHref("plan", us)).toBe("/onboarding/texting");
    expect(previousStepHref("texting", us)).toBe("/onboarding/business");
  });

  it("returns null on business once the company exists — name/number are locked", () => {
    expect(previousStepHref("business", snapshot({ company: {} }))).toBeNull();
  });

  it("still allows Back to number pre-company (name/number editable until creation)", () => {
    const draftUs = snapshot({ company: null, draft: COMPLETE_DRAFT });
    expect(previousStepHref("business", draftUs)).toBe("/onboarding/number");
    expect(previousStepHref("number", draftUs)).toBe("/onboarding/name");
  });

  it("returns null on the first step", () => {
    expect(previousStepHref("name", snapshot({ company: null }))).toBeNull();
  });
});

describe("hasPaid / setupComplete / pathForLocation", () => {
  it("paid statuses are active, past_due, unpaid", () => {
    expect(hasPaid("active")).toBe(true);
    expect(hasPaid("past_due")).toBe(true);
    expect(hasPaid("unpaid")).toBe(true);
    expect(hasPaid("incomplete")).toBe(false);
    expect(hasPaid("canceled")).toBe(false);
  });

  it("setupComplete needs an active number and an open US gate", () => {
    expect(
      setupComplete(
        snapshot({
          company: { status: "active", numbers: [{ status: "provisioning" }] },
        }),
      ),
    ).toBe(false);
    expect(
      setupComplete(
        snapshot({
          company: {
            country: "CA",
            usTexting: false,
            status: "active",
            numbers: [{ status: "active" }],
            campaign: null,
          },
        }),
      ),
    ).toBe(true);
  });

  it("locations map to routes", () => {
    expect(pathForLocation({ kind: "inbox" })).toBe("/inbox");
    expect(pathForLocation({ kind: "setting-up" })).toBe(
      "/onboarding/setting-up",
    );
    expect(pathForLocation({ kind: "step", step: "texting" })).toBe(
      "/onboarding/texting",
    );
  });
});
