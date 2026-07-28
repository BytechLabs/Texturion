import { lookupAreaCode } from "@loonext/shared";

import { isCarrierEnforcedOptOut } from "@/lib/api/types";
import type {
  CompanyView,
  OptOutSource,
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
  /**
   * `carrierBlocked` distinguishes the two opt-outs, because only one of them
   * has anything the reader can do about it. A STOP the customer sent is a
   * carrier block that only they can lift; an opt-out someone recorded by hand
   * comes off in a tap on the contact.
   */
  | { kind: "opted_out"; carrierBlocked: boolean }
  | { kind: "subscription"; status: SubscriptionStatus }
  | { kind: "registration_pending" }
  /**
   * A US destination in a workspace that does not do US texting at all: a
   * Canadian company that never added it. Split out of `registration_pending`
   * because no registration exists to approve, so the wait copy promised an
   * outcome that could not arrive however long the reader waited.
   */
  | { kind: "us_texting_off" }
  | { kind: "usage_cap" }
  /**
   * #396: an inbound message on this thread READ as a plain-English opt-out.
   *
   * The only banner here that does not describe a block — everything else says
   * why a message cannot go. This one says a message SHOULD not, and leaves the
   * decision with the person: an opt-out cannot be lifted by us (#331), so
   * acting on a guess would silence a real lead forever.
   */
  | { kind: "opt_out_hint" }
  | null;

export interface ComposerGateInput {
  /** GET /v1/contacts/:id `opted_out`. */
  contactOptedOut: boolean;
  /** GET /v1/contacts/:id `opt_out_source` — null when not opted out. */
  contactOptOutSource: OptOutSource | null;
  /** companies.subscription_status. */
  subscriptionStatus: SubscriptionStatus;
  /** Destination country from the NANP table; null = unknown yet. */
  destinationCountry: "US" | "CA" | null;
  /** Mirror of the API's getSendGates usApproved flag (see usSendApproved). */
  usApproved: boolean;
  /** This workspace does not do US texting at all (see usTextingOff). */
  usTextingOff: boolean;
  /** GET /v1/usage — null while loading (cap banner needs real data). */
  usage: Pick<Usage, "used_segments" | "cap_segments"> | null;
  /** #396: conversations.opt_out_hint_at — a plain-English opt-out was seen. */
  optOutHint: boolean;
}

export function selectComposerBanner(input: ComposerGateInput): ComposerBanner {
  if (input.contactOptedOut) {
    return {
      kind: "opted_out",
      // #331: two sources are carrier blocks, not one. Asking the predicate
      // rather than naming a literal is what keeps a third from being missed.
      carrierBlocked: isCarrierEnforcedOptOut(input.contactOptOutSource),
    };
  }
  if (input.subscriptionStatus !== "active") {
    return { kind: "subscription", status: input.subscriptionStatus };
  }
  if (input.destinationCountry === "US" && !input.usApproved) {
    return input.usTextingOff
      ? { kind: "us_texting_off" }
      : { kind: "registration_pending" };
  }
  if (
    input.usage !== null &&
    input.usage.cap_segments !== null &&
    input.usage.used_segments >= input.usage.cap_segments
  ) {
    return { kind: "usage_cap" };
  }
  // #396 LAST, and deliberately: every banner above says a message CANNOT go,
  // and where nothing can be sent no obligation can be breached. This one
  // matters exactly when the composer is otherwise open — the moment somebody
  // is about to reply to a person who asked them not to.
  if (input.optOutHint) {
    return { kind: "opt_out_hint" };
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

/**
 * The workspace does not do US texting at all, so `usSendApproved` is false
 * for a reason no amount of waiting fixes. Only Canadian companies can be in
 * this state: US texting is inherent to a US company (§4.2).
 */
export function usTextingOff(
  company: Pick<CompanyView, "country" | "us_texting_enabled">,
): boolean {
  return company.country === "CA" && !company.us_texting_enabled;
}

/** Destination country for a contact number, via the shared NANP table. */
export function destinationCountry(e164: string): "US" | "CA" | null {
  return lookupAreaCode(e164)?.country ?? null;
}
