import { describe, expect, it } from "vitest";

import { HONEST_TIMELINE, REGISTRATION_COPY } from "./copy";
import {
  deriveRegistrationUiState,
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
    numbers: [{ status: "active" }],
    brand: row(),
    campaign: row(),
    ...overrides,
  };
}

describe("SPEC §4.4 banner copy — exact strings", () => {
  it("matches the spec table verbatim", () => {
    expect(REGISTRATION_COPY.numberProvisioning).toBe(
      "Setting up your business number — usually under a minute.",
    );
    expect(REGISTRATION_COPY.numberDelayed).toBe(
      "We're setting up your number — this is taking longer than usual. You don't need to do anything.",
    );
    expect(REGISTRATION_COPY.registrationPending).toBe(
      "US texting activates in ~3–7 business days (carrier approval). Receiving texts and texting Canadian numbers already work.",
    );
    expect(REGISTRATION_COPY.otpPending("(416) 555-0182")).toBe(
      "One step left: enter the verification code we sent to (416) 555-0182 to finish US registration.",
    );
    expect(REGISTRATION_COPY.rejected("brand address mismatch")).toBe(
      "US registration needs a fix: brand address mismatch. Update and resubmit — it takes 2 minutes.",
    );
    expect(REGISTRATION_COPY.approved).toBe("🎉 US texting is live.");
  });

  it("keeps the SPEC §4.1 checkout copy verbatim on the timeline card", () => {
    expect(HONEST_TIMELINE).toEqual([
      "Receiving texts works the moment your number is ready (minutes).",
      "Texting Canadian numbers works immediately.",
      "Texting US numbers activates after carrier approval — typically 3–7 business days. We'll email you the moment you're approved.",
    ]);
  });
});

describe("deriveRegistrationUiState — number lifecycle (§4.4 rows 1–2)", () => {
  it("provisioning number → number_provisioning", () => {
    expect(
      deriveRegistrationUiState(
        input({ numbers: [{ status: "provisioning" }] }),
      ),
    ).toEqual({ kind: "number_provisioning" });
  });

  it("no number row yet (webhook processing) reads as provisioning", () => {
    expect(deriveRegistrationUiState(input({ numbers: [] }))).toEqual({
      kind: "number_provisioning",
    });
  });

  it("provision_failed → number_delayed (never a dead end)", () => {
    expect(
      deriveRegistrationUiState(
        input({ numbers: [{ status: "provision_failed" }] }),
      ),
    ).toEqual({ kind: "number_delayed" });
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

  it("pre-checkout and canceled subscriptions stay silent", () => {
    for (const subscriptionStatus of [
      "incomplete",
      "incomplete_expired",
      "canceled",
    ] as const) {
      expect(
        deriveRegistrationUiState(input({ subscriptionStatus, numbers: [] })),
      ).toEqual({ kind: "none" });
    }
  });

  it("past_due keeps the honest registration state visible", () => {
    expect(
      deriveRegistrationUiState(input({ subscriptionStatus: "past_due" })),
    ).toEqual({ kind: "registration_pending" });
  });
});
