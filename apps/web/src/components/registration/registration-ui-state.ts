import type {
  NumberSource,
  NumberStatus,
  RegistrationStatus,
  SubscriptionStatus,
} from "@/lib/api/types";

/**
 * Registration-state → UI-state mapping (SPEC §4.4 customer-facing states,
 * DESIGN.md G7). Pure so the full state table is unit-testable; the status
 * banner, the inbox activation empty state, and the setting-up checklist all
 * render from this.
 *
 * FEATURE-GAPS voice wave: the derivation is source-aware. A
 * `phone_numbers[source=hosted]` row is a keep-your-number text-enablement
 * under multi-day CARRIER review — never the "under a minute" provisioning
 * promise. When the only live (non-released) numbers are hosted, the honest
 * hosted-review line shows instead (kind `number_hosted_review`, linking to
 * /settings/numbers).
 */

/** The slice of a number row the deriver reads (source optional — pre-wave
 * cached shapes lack it and read as "provisioned"). */
export interface NumberRowInput {
  status: NumberStatus;
  source?: NumberSource;
}

export interface RegistrationRowInput {
  status: RegistrationStatus;
  sole_proprietor: boolean;
  rejection_reason: string | null;
  deactivated_at: string | null;
}

export interface RegistrationUiInput {
  country: "US" | "CA";
  usTextingEnabled: boolean;
  subscriptionStatus: SubscriptionStatus;
  numbers: NumberRowInput[];
  brand: RegistrationRowInput | null;
  campaign: RegistrationRowInput | null;
}

export type RegistrationUiState =
  /** Nothing to say: pre-checkout, canceled, or CA company with US texting off. */
  | { kind: "none" }
  | { kind: "number_provisioning" }
  | { kind: "number_delayed" }
  /** No live number except a hosted text-enablement in carrier review (days). */
  | { kind: "number_hosted_review" }
  | { kind: "otp_pending" }
  | { kind: "rejected"; reason: string | null }
  | { kind: "registration_pending" }
  /** Campaign approved and live — banner hides; approval toast fires on the transition. */
  | { kind: "approved" };

/**
 * True when no number is active and every live (non-released) row is a
 * hosted text-enablement — i.e. the only thing "coming" is a multi-day
 * carrier review, so an "under a minute" promise would be dishonest. Shared
 * by the deriver and the inbox activation empty state. A live NON-hosted row
 * alongside (a provisioning purchased number) keeps the normal provisioning
 * states: that number genuinely arrives in about a minute.
 */
export function hostedReviewOnly(
  numbers: readonly NumberRowInput[],
): boolean {
  const live = numbers.filter((n) => n.status !== "released");
  return (
    live.length > 0 &&
    !live.some((n) => n.status === "active") &&
    live.every((n) => n.source === "hosted")
  );
}

function owesUsRegistration(input: RegistrationUiInput): boolean {
  return (
    input.country === "US" || (input.country === "CA" && input.usTextingEnabled)
  );
}

/**
 * Priority: pre/post-subscription silence → number states → US-registration
 * states. Every SPEC §4.4 banner row maps to exactly one kind (see the test
 * table in registration-ui-state.test.ts).
 */
export function deriveRegistrationUiState(
  input: RegistrationUiInput,
): RegistrationUiState {
  // Pre-payment the onboarding wizard owns the surface; canceled companies
  // get billing surfaces, not a registration nag.
  if (
    input.subscriptionStatus === "incomplete" ||
    input.subscriptionStatus === "incomplete_expired" ||
    input.subscriptionStatus === "canceled"
  ) {
    return { kind: "none" };
  }

  // Number lifecycle first (§4.4 rows 1–2): nothing else matters until the
  // number exists. No row yet (webhook still processing) reads as provisioning.
  const hasActive = input.numbers.some((n) => n.status === "active");
  if (!hasActive) {
    // Voice wave: only a hosted text-enablement in flight → the honest
    // multi-day carrier-review line, never the under-a-minute promise.
    if (hostedReviewOnly(input.numbers)) {
      return { kind: "number_hosted_review" };
    }
    const failed = input.numbers.some((n) => n.status === "provision_failed");
    return failed ? { kind: "number_delayed" } : { kind: "number_provisioning" };
  }

  if (!owesUsRegistration(input)) return { kind: "none" };

  const { brand, campaign } = input;

  if (
    campaign?.status === "approved" &&
    campaign.deactivated_at === null
  ) {
    return { kind: "approved" };
  }

  // §4.4 R4: either row rejected → fix-and-resubmit banner.
  if (campaign?.status === "rejected" || brand?.status === "rejected") {
    return {
      kind: "rejected",
      reason:
        (campaign?.status === "rejected"
          ? campaign.rejection_reason
          : brand?.rejection_reason) ?? null,
    };
  }

  // §4.2: sole-prop brand submitted but not yet verified = OTP outstanding
  // (verification flips the brand to approved via refresh/webhook/poll).
  if (
    brand?.sole_proprietor &&
    (brand.status === "submitted" || brand.status === "pending")
  ) {
    return { kind: "otp_pending" };
  }

  // Everything else on the paid path — draft awaiting auto-submission,
  // submitted, pending, approved-brand-with-campaign-in-review, or a
  // deactivated campaign being re-submitted — is honestly "in review".
  return { kind: "registration_pending" };
}
