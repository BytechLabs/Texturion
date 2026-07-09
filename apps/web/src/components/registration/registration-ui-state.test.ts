import { describe, expect, it } from "vitest";

import { HONEST_TIMELINE, REGISTRATION_COPY } from "./copy";
import {
  deriveRegistrationUiState,
  hostedReviewOnly,
  type RegistrationRowInput,
  type RegistrationUiInput,
} from "./registration-ui-state";

/**
 * The SPEC §4.4 mapping table: every customer-facing registration state has
 * a screen/banner, and the copy is the spec's exact strings.
 */

function row(
  overrides: Partial<RegistrationRowInput> = {},
): RegistrationRowInput {
  return {
    status: "submitted",
    sole_proprietor: false,
    rejection_reason: null,
    deactivated_at: null,
    ...overrides,
  };
}

function input(overrides: Partial<RegistrationUiInput> = {}): RegistrationUiInput {
  return {
    country: "US",
    usTextingEnabled: true,
    subscriptionStatus: "active",
    role: "owner",
    numbers: [{ status: "active" }],
    brand: row(),
    campaign: row(),
    ...overrides,
  };
}

describe("SPEC §4.4 banner copy — exact strings", () => {
  it("matches the spec table verbatim", () => {
    expect(REGISTRATION_COPY.numberProvisioning).toBe(
      "Setting up your business number, usually under a minute.",
    );
    expect(REGISTRATION_COPY.numberDelayed).toBe(
      "We're still setting up your number. This is taking a little longer than usual.",
    );
    // The lie is gone: a delayed provision never claims there's nothing to do.
    expect(REGISTRATION_COPY.numberDelayed).not.toMatch(
      /don't need to do anything/i,
    );
    expect(REGISTRATION_COPY.numberActionNeeded("416")).toBe(
      "We couldn't get a number in area code 416. Choose another to finish setup.",
    );
    expect(REGISTRATION_COPY.registrationPending).toBe(
      "US texting activates in ~3 to 7 business days (carrier approval). Receiving texts and texting Canadian numbers already work.",
    );
    expect(REGISTRATION_COPY.otpPending("(416) 555-0182")).toBe(
      "One step left: enter the verification code we sent to (416) 555-0182 to finish US registration.",
    );
    expect(REGISTRATION_COPY.rejected("brand address mismatch")).toBe(
      "US registration needs a fix: brand address mismatch. Update and resubmit. It takes 2 minutes.",
    );
    expect(REGISTRATION_COPY.approved).toBe("US texting is live.");
  });

  it("keeps the hosted-review line honest — multi-day, never 'under a minute'", () => {
    expect(REGISTRATION_COPY.hostedReview).toBe(
      "Text-enabling your existing number. Carrier review usually takes a few business days. Calls keep working the whole time.",
    );
    expect(REGISTRATION_COPY.hostedReview).not.toMatch(/under a minute/);
  });

  it("keeps the SPEC §4.1 checkout copy verbatim on the timeline card", () => {
    expect(HONEST_TIMELINE).toEqual([
      "Receiving texts works the moment your number is ready (minutes).",
      "Texting Canadian numbers works immediately.",
      "Texting US numbers activates after carrier approval, typically 3 to 7 business days. We'll email you the moment you're approved.",
    ]);
  });
});

describe("deriveRegistrationUiState — number lifecycle (§4.4 rows 1–2)", () => {
  it("provisioning number → number_provisioning", () => {
    expect(
      deriveRegistrationUiState(
        input({ numbers: [{ status: "provisioning" }] }),
      ),
    ).toEqual({ kind: "number_provisioning", createdAt: null });
  });

  it("carries created_at so the banner copy de-escalates over time", () => {
    expect(
      deriveRegistrationUiState(
        input({
          numbers: [{ status: "provisioning", created_at: "2026-07-09T00:00:00.000Z" }],
        }),
      ),
    ).toEqual({
      kind: "number_provisioning",
      createdAt: "2026-07-09T00:00:00.000Z",
    });
  });

  it("no number row yet (webhook processing) reads as provisioning", () => {
    expect(deriveRegistrationUiState(input({ numbers: [] }))).toEqual({
      kind: "number_provisioning",
      createdAt: null,
    });
  });

  it("transient provision_failed (still retrying) → number_delayed", () => {
    expect(
      deriveRegistrationUiState(
        input({ numbers: [{ status: "provision_failed" }] }),
      ),
    ).toEqual({ kind: "number_delayed" });
    // A carrier blip with attempts still left is transient, not action-needed.
    expect(
      deriveRegistrationUiState(
        input({
          numbers: [
            {
              status: "provision_failed",
              failure_reason: "carrier",
              provision_attempts: 2,
            },
          ],
        }),
      ),
    ).toEqual({ kind: "number_delayed" });
  });

  it("no-inventory provision_failed → number_action_needed (choose a number)", () => {
    expect(
      deriveRegistrationUiState(
        input({
          numbers: [
            {
              status: "provision_failed",
              failure_reason: "no_inventory",
              requested_area_code: "416",
            },
          ],
        }),
      ),
    ).toEqual({ kind: "number_action_needed", areaCode: "416" });
  });

  it("out of attempts → number_action_needed even without no_inventory", () => {
    expect(
      deriveRegistrationUiState(
        input({
          numbers: [
            {
              status: "provision_failed",
              failure_reason: "carrier",
              provision_attempts: 5,
              requested_area_code: "212",
            },
          ],
        }),
      ),
      // Out of attempts → action needed, but the area code isn't the problem for
      // a carrier failure, so it reads the honest generic line (areaCode null).
    ).toEqual({ kind: "number_action_needed", areaCode: null });
  });

  it("an active number silences the number states", () => {
    expect(
      deriveRegistrationUiState(
        input({
          numbers: [{ status: "active" }, { status: "provisioning" }],
        }),
      ).kind,
    ).not.toBe("number_provisioning");
  });
});

describe("deriveRegistrationUiState — hosted text-enablement rows (voice wave)", () => {
  const hostedProvisioning = {
    status: "provisioning",
    source: "hosted",
  } as const;

  it("released provisioned + provisioning hosted → the honest hosted-review state", () => {
    expect(
      deriveRegistrationUiState(
        input({
          numbers: [
            { status: "released", source: "provisioned" },
            hostedProvisioning,
          ],
        }),
      ),
    ).toEqual({ kind: "number_hosted_review" });
  });

  it("hosted only → hosted review, never the under-a-minute promise", () => {
    expect(
      deriveRegistrationUiState(input({ numbers: [hostedProvisioning] })),
    ).toEqual({ kind: "number_hosted_review" });
  });

  it("a provisioning PURCHASED number alongside keeps the provisioning promise (that one really is minutes away)", () => {
    expect(
      deriveRegistrationUiState(
        input({
          numbers: [
            { status: "provisioning", source: "provisioned" },
            hostedProvisioning,
          ],
        }),
      ),
    ).toEqual({ kind: "number_provisioning", createdAt: null });
  });

  it("a failed purchased provision alongside a hosted row still reads delayed", () => {
    expect(
      deriveRegistrationUiState(
        input({
          numbers: [
            { status: "provision_failed", source: "provisioned" },
            hostedProvisioning,
          ],
        }),
      ),
    ).toEqual({ kind: "number_delayed" });
  });

  it("an ACTIVE hosted number silences the number states like any active number", () => {
    expect(
      deriveRegistrationUiState(
        input({ numbers: [{ status: "active", source: "hosted" }] }),
      ).kind,
    ).toBe("registration_pending");
  });

  it("hostedReviewOnly — the shared predicate the inbox empty state renders from", () => {
    expect(hostedReviewOnly([hostedProvisioning])).toBe(true);
    expect(
      hostedReviewOnly([
        { status: "released", source: "provisioned" },
        hostedProvisioning,
      ]),
    ).toBe(true);
    // A live non-hosted row (or an active one) turns it off…
    expect(
      hostedReviewOnly([
        { status: "provisioning", source: "provisioned" },
        hostedProvisioning,
      ]),
    ).toBe(false);
    expect(hostedReviewOnly([{ status: "active", source: "hosted" }])).toBe(
      false,
    );
    // …and with nothing live there is nothing to review.
    expect(hostedReviewOnly([])).toBe(false);
    expect(
      hostedReviewOnly([{ status: "released", source: "hosted" }]),
    ).toBe(false);
  });
});

describe("deriveRegistrationUiState — every §4.4 registration status", () => {
  it("draft (paid, awaiting auto-submission) → registration_pending", () => {
    expect(
      deriveRegistrationUiState(
        input({ brand: row({ status: "draft" }), campaign: row({ status: "draft" }) }),
      ),
    ).toEqual({ kind: "registration_pending" });
  });

  it("submitted → registration_pending", () => {
    expect(deriveRegistrationUiState(input())).toEqual({
      kind: "registration_pending",
    });
  });

  it("pending → registration_pending", () => {
    expect(
      deriveRegistrationUiState(
        input({
          brand: row({ status: "approved" }),
          campaign: row({ status: "pending" }),
        }),
      ),
    ).toEqual({ kind: "registration_pending" });
  });

  it("approved campaign → approved (banner hides, toast on transition)", () => {
    expect(
      deriveRegistrationUiState(
        input({
          brand: row({ status: "approved" }),
          campaign: row({ status: "approved" }),
        }),
      ),
    ).toEqual({ kind: "approved" });
  });

  it("rejected campaign → rejected with the stored reason", () => {
    expect(
      deriveRegistrationUiState(
        input({
          campaign: row({
            status: "rejected",
            rejection_reason: "Website unreachable",
          }),
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "Website unreachable" });
  });

  it("rejected brand → rejected too", () => {
    expect(
      deriveRegistrationUiState(
        input({
          brand: row({ status: "rejected", rejection_reason: "EIN mismatch" }),
          campaign: row({ status: "draft" }),
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "EIN mismatch" });
  });

  it("deactivated approved campaign (post-grace) → registration_pending", () => {
    expect(
      deriveRegistrationUiState(
        input({
          campaign: row({
            status: "approved",
            deactivated_at: "2026-06-01T00:00:00Z",
          }),
        }),
      ),
    ).toEqual({ kind: "registration_pending" });
  });
});

describe("deriveRegistrationUiState — sole-prop OTP (§4.2)", () => {
  it("sole-prop brand submitted/pending → otp_pending", () => {
    for (const status of ["submitted", "pending"] as const) {
      expect(
        deriveRegistrationUiState(
          input({
            brand: row({ status, sole_proprietor: true }),
            campaign: row({ status: "draft" }),
          }),
        ),
      ).toEqual({ kind: "otp_pending" });
    }
  });

  it("verified sole-prop brand goes back to the pending sentence", () => {
    expect(
      deriveRegistrationUiState(
        input({
          brand: row({ status: "approved", sole_proprietor: true }),
          campaign: row({ status: "submitted" }),
        }),
      ),
    ).toEqual({ kind: "registration_pending" });
  });
});

describe("deriveRegistrationUiState — not-applicable and silence", () => {
  it("CA company with US texting off → none", () => {
    expect(
      deriveRegistrationUiState(
        input({
          country: "CA",
          usTextingEnabled: false,
          brand: null,
          campaign: null,
        }),
      ),
    ).toEqual({ kind: "none" });
  });

  it("pre-checkout stays silent for an owner (they're redirected to onboarding)", () => {
    for (const subscriptionStatus of [
      "incomplete",
      "incomplete_expired",
    ] as const) {
      expect(
        deriveRegistrationUiState(
          input({ subscriptionStatus, role: "owner", numbers: [] }),
        ),
      ).toEqual({ kind: "none" });
      expect(
        deriveRegistrationUiState(
          input({ subscriptionStatus, role: "admin", numbers: [] }),
        ),
      ).toEqual({ kind: "none" });
    }
  });
});

describe("deriveRegistrationUiState — subscription/billing states (issue #7)", () => {
  it("unpaid company viewed by a member → setup_unfinished_member (can't pay)", () => {
    for (const subscriptionStatus of [
      "incomplete",
      "incomplete_expired",
    ] as const) {
      expect(
        deriveRegistrationUiState(
          input({ subscriptionStatus, role: "member", numbers: [] }),
        ),
      ).toEqual({ kind: "setup_unfinished_member" });
    }
  });

  it("canceled subscription → subscription_canceled (was silent before)", () => {
    expect(
      deriveRegistrationUiState(input({ subscriptionStatus: "canceled" })),
    ).toEqual({ kind: "subscription_canceled" });
  });

  it("past_due and unpaid → payment_issue (outranks the registration line)", () => {
    for (const subscriptionStatus of ["past_due", "unpaid"] as const) {
      expect(
        deriveRegistrationUiState(input({ subscriptionStatus })),
      ).toEqual({ kind: "payment_issue" });
    }
  });
});
