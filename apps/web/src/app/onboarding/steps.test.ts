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

  it("#381: a US draft with no company goes to NUMBER, not business", () => {
    // The company is created on the number step for every path now. It used to
    // be created as a side effect of the business step, and that coupling is
    // the whole reason the last-4-of-SIN ask came before the paywall: checkout
    // needs a company, so identity had to precede payment.
    expect(
      resolveOnboardingLocation(
        snapshot({ company: null, draft: COMPLETE_DRAFT }),
      ),
    ).toEqual({ kind: "step", step: "number" });
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

  it("#381: a US company pre-checkout goes to PLAN, registration rows or not", () => {
    // Registration is submitted to Telnyx after payment (D2), so collecting it
    // first held a partial government identifier for every signup that
    // abandoned at the paywall — a company that never became a customer.
    expect(
      resolveOnboardingLocation(snapshot({ company: {} })),
    ).toEqual({ kind: "step", step: "plan" });
  });

  it("#381: PAID with brand complete and campaign missing → texting step", () => {
    // The registration pair still runs in order; it runs after payment now.
    expect(
      resolveOnboardingLocation(
        snapshot({
          company: { status: "active" },
          brand: { data: COMPLETE_BRAND_DATA },
          campaign: null,
        }),
      ),
    ).toEqual({ kind: "step", step: "texting" });
  });

  it("#381: PAID with nothing registered yet → business step", () => {
    expect(
      resolveOnboardingLocation(snapshot({ company: { status: "active" } })),
    ).toEqual({ kind: "step", step: "business" });
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
    // #381: the fixture now carries the registration ROWS as well as the
    // campaign state, because the paid branch checks them before falling
    // through to setting-up. A post-grace resubscribe has by definition
    // already registered — the campaign was deactivated, not un-filed — so
    // supplying them is what makes this fixture describe the real situation
    // rather than a company that never registered at all.
    expect(
      resolveOnboardingLocation(
        snapshot({
          company: {
            status: "active",
            numbers: [{ status: "active" }],
            campaign: { status: "approved", deactivated_at: "2026-06-01T00:00:00Z" },
          },
          brand: { data: COMPLETE_BRAND_DATA },
          campaign: { kind: "campaign", data: COMPLETE_CAMPAIGN_DATA },
        }),
      ),
    ).toEqual({ kind: "setting-up" });
  });
});

// ---------------------------------------------------------------------------
// Step gating
// ---------------------------------------------------------------------------

describe("stepAllowed", () => {
  it("name locks at creation; number stays editable until checkout (#79)", () => {
    const before = snapshot({ company: null });
    expect(stepAllowed("name", before)).toBe(true);
    expect(stepAllowed("number", before)).toBe(true);
    // Company exists but unpaid: the workspace name is fixed at creation, but the
    // number/country step stays open so a wrong-country pick can be switched (#79).
    const unpaid = snapshot({ company: {} });
    expect(stepAllowed("name", unpaid)).toBe(false);
    expect(stepAllowed("number", unpaid)).toBe(true);
    // Once paid, provisioning has begun and the number step locks too.
    const paid = snapshot({ company: { status: "active" } });
    expect(stepAllowed("number", paid)).toBe(false);
    // 'incomplete_expired' never checked out → still editable; 'canceled' already
    // ordered its number (server 409s the edit) → locks like a paid company.
    expect(
      stepAllowed("number", snapshot({ company: { status: "incomplete_expired" } })),
    ).toBe(true);
    expect(
      stepAllowed("number", snapshot({ company: { status: "canceled" } })),
    ).toBe(false);
  });

  it("#381: NOTHING is reachable before the company exists", () => {
    // Which is what stops an abandoned signup leaving identity data behind:
    // there is no longer a pre-company step that asks for any.
    expect(stepAllowed("business", snapshot({ company: null }))).toBe(false);
    expect(
      stepAllowed("business", snapshot({ company: null, draft: COMPLETE_DRAFT })),
    ).toBe(false);
    expect(stepAllowed("texting", snapshot({ company: null }))).toBe(false);
    expect(stepAllowed("plan", snapshot({ company: null }))).toBe(false);
  });

  it("#381: registration OPENS after payment and closes for CA-no-US", () => {
    const caOnly = snapshot({ company: { country: "CA", usTexting: false } });
    expect(stepAllowed("business", caOnly)).toBe(false);
    expect(stepAllowed("texting", caOnly)).toBe(false);
    expect(stepAllowed("plan", caOnly)).toBe(true);

    // The inversion: unpaid closes the registration steps, paid opens them.
    const unpaid = snapshot({ company: {} });
    expect(stepAllowed("business", unpaid)).toBe(false);

    const paid = snapshot({ company: { status: "active" } });
    expect(stepAllowed("business", paid)).toBe(true);
    expect(stepAllowed("texting", paid)).toBe(true);
    expect(stepAllowed("plan", paid)).toBe(false);
  });

  it("#381: plan is reachable as soon as the company exists", () => {
    // It used to be gated on the registration drafts being complete. That gate
    // was the coupling that put a SIN fragment before the paywall, and the
    // checkout route never needed it — D2 submits registration after payment.
    expect(stepAllowed("plan", snapshot({ company: {} }))).toBe(true);
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
    // #381: registration comes after plan. Same five steps, ordered so the
    // most sensitive ask sits behind the commitment that justifies it.
    expect(applicableSteps(snapshot({ company: null, draft: COMPLETE_DRAFT })))
      .toEqual(["name", "number", "plan", "business", "texting"]);
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
    // #381: plan is 3 of 5 now; business is 4.
    expect(stepProgress("plan", us)).toEqual({ index: 3, total: 5 });
    expect(stepProgress("business", us)).toEqual({ index: 4, total: 5 });
  });
});

describe("previousStepHref (honest Back navigation)", () => {
  it("walks back to number on plan for CA-no-US (editable until checkout, #79)", () => {
    // Formerly null (name/number locked at creation); #79 keeps the number step
    // open pre-checkout, so Back now honestly reaches it.
    const caOnly = snapshot({ company: { country: "CA", usTexting: false } });
    expect(previousStepHref("plan", caOnly)).toBe("/onboarding/number");
  });

  it("#381: walks back to the nearest EDITABLE step for a US company", () => {
    // The order inverted, so Back did too: plan now sits between number and
    // the registration pair.
    const unpaid = snapshot({ company: {} });
    expect(previousStepHref("plan", unpaid)).toBe("/onboarding/number");

    // Once paid, the registration pair is the reachable tail. Plan is closed
    // behind them (they have already paid), so Back from business honestly
    // reaches the number step rather than offering a second checkout.
    const paid = snapshot({ company: { status: "active" } });
    expect(previousStepHref("texting", paid)).toBe("/onboarding/business");
  });

  it("walks back to number on business once the company exists (editable until checkout, #79)", () => {
    // #381: reached post-payment now, and the number step locks once paid, so
    // there is nothing editable behind it to offer.
    expect(previousStepHref("business", snapshot({ company: { status: "active" } }))).toBe(
      null,
    );
  });

  it("still allows Back to number pre-company (name/number editable until creation)", () => {
    const draftUs = snapshot({ company: null, draft: COMPLETE_DRAFT });
    expect(previousStepHref("business", draftUs)).toBe("/onboarding/number");
    expect(previousStepHref("number", draftUs)).toBe("/onboarding/name");
  });

  it("hides Back on the number step while editing an existing company (name is locked)", () => {
    // From the number step, the only preceding step is name, which stays locked
    // at creation — so an editing user has no honest Back target.
    expect(previousStepHref("number", snapshot({ company: {} }))).toBeNull();
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
