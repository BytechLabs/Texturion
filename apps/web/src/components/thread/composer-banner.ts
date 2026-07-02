import { lookupAreaCode } from "@jobtext/shared";

import type {
  CompanyView,
  SubscriptionStatus,
  Usage,
} from "@/lib/api/types";

/**
 * Banner states that REPLACE the composer (G5) — a pure precedence selector
 * so the rule is unit-testable. Order (most permanent / most specific wins):
 *
 *   1. opted_out             — per-contact, never unblocked by paying
 *   2. subscription          — past_due / canceled blocks every send (§1.3)
 *   3. registration_pending  — US destination before campaign approval (§4.4)
 *   4. usage_cap             — recoverable inline by the owner (§2)
 *
 * `null` = composer enabled. The API enforces every one of these
 * independently; this selector only decides what the user sees.
 */

export type ComposerBanner =
  | { kind: "opted_out" }
  | { kind: "subscription"; status: SubscriptionStatus }
  | { kind: "registration_pending" }
  | { kind: "usage_cap" }
  | null;

export interface ComposerGateInput {
  /** GET /v1/contacts/:id `opted_out`. */
  contactOptedOut: boolean;
  /** companies.subscription_status. */
  subscriptionStatus: SubscriptionStatus;
  /** Destination country from the NANP table; null = unknown yet. */
  destinationCountry: "US" | "CA" | null;
  /** Mirror of the API's getSendGates usApproved flag (see usSendApproved). */
  usApproved: boolean;
  /** GET /v1/usage — null while loading (cap banner needs real data). */
  usage: Pick<Usage, "used_segments" | "cap_segments"> | null;
}

export function selectComposerBanner(input: ComposerGateInput): ComposerBanner {
  if (input.contactOptedOut) return { kind: "opted_out" };
  if (input.subscriptionStatus !== "active") {
    return { kind: "subscription", status: input.subscriptionStatus };
  }
  if (input.destinationCountry === "US" && !input.usApproved) {
    return { kind: "registration_pending" };
  }
  if (
    input.usage !== null &&
    input.usage.cap_segments !== null &&
    input.usage.used_segments >= input.usage.cap_segments
  ) {
    return { kind: "usage_cap" };
  }
  return null;
}

/**
 * The §4.4 US-send gate exactly as the API computes it (getSendGates in
 * apps/api/src/telnyx/registration.ts): campaign approved, not deactivated,
 * and the company does US texting at all.
 */
export function usSendApproved(
  company: Pick<CompanyView, "country" | "us_texting_enabled" | "registration">,
): boolean {
  const campaign = company.registration.campaign;
  return (
    (company.country === "US" || company.us_texting_enabled) &&
    campaign !== null &&
    campaign.status === "approved" &&
    campaign.deactivated_at === null
  );
}

/** Destination country for a contact number, via the shared NANP table. */
export function destinationCountry(e164: string): "US" | "CA" | null {
  return lookupAreaCode(e164)?.country ?? null;
}
