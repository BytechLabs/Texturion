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
  /**
   * #423: the carrier suspended a registration that WAS approved.
   *
   * Its own kind for the same reason `us_texting_off` is: the
   * `registration_pending` copy promises approval is coming, and for a
   * suspended workspace that is false — they were approved, nothing is under
   * review, and waiting achieves nothing. A banner that misdescribes the state
   * is worse than no banner, because it sends the reader off to wait for an
   * outcome that cannot arrive.
   */
  | { kind: "registration_suspended" }
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
  /**
   * #363: this member may read the thread and write internal notes, but may
   * not text the customer on this number (`number_access.level = 'note'`).
   *
   * The one send-blocking condition that had no banner. Every other blocked
   * send says why on screen; this one just quietly had no text composer, which
   * looks like the product is broken rather than like a permission — and the
   * worse version is a tech who believes they replied and did not.
   */
  | { kind: "number_access" }
  /**
   * #315: this person may READ the workspace and change nothing in it — the
   * read-only observer (an owner's partner, an accountant, a consultant).
   *
   * Its own kind rather than reusing `number_access`, because the two are
   * different facts with different remedies: number access is about ONE
   * number and an owner can widen it; this is about the role and only a role
   * change fixes it. Telling an accountant to "ask for access to this number"
   * would send them to the wrong conversation.
   */
  | { kind: "read_only" }
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
  /** #423: the campaign was approved and the carrier took it away. */
  usSuspended: boolean;
  /** GET /v1/usage — null while loading (cap banner needs real data). */
  usage: Pick<Usage, "used_segments" | "cap_segments"> | null;
  /** #396: conversations.opt_out_hint_at — a plain-English opt-out was seen. */
  optOutHint: boolean;
  /**
   * #106/#363: this caller's level on THIS conversation's number. 'note' may
   * read and annotate but not text; 'text' is unrestricted.
   */
  viewerLevel: "text" | "note";
  /**
   * #315: the viewer holds `conversations.read` and nothing else. Checked
   * before every other gate for the same reason `number_access` is — it is a
   * fact about the READER, true in every conversation, and no amount of
   * resolving a customer-specific problem changes it.
   */
  viewerReadOnly: boolean;
}

export function selectComposerBanner(input: ComposerGateInput): ComposerBanner {
  // #363 FIRST, and the reason is worth stating: every other banner describes
  // a fact about the CONVERSATION or the workspace, and this one describes a
  // fact about the READER. A note-only member who is told "your subscription
  // is past due" learns something true, irrelevant and unfixable by them —
  // they could not text on this number either way, and they cannot pay the
  // bill. "Ask your owner for access" is the only line here they can act on.
  //
  // It is also the only one that stays true in every other conversation on
  // this number, so learning it once is worth more than learning it after
  // resolving a customer-specific problem and hitting a second wall.
  if (input.viewerReadOnly) {
    return { kind: "read_only" };
  }
  if (input.viewerLevel === "note") {
    return { kind: "number_access" };
  }
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
    // Order is most-specific-to-this-reader. `us_texting_off` first because a
    // workspace that never turned US texting on has no live registration to
    // discuss; then #423 suspension, which is a state they WERE out of; then
    // the ordinary pre-approval wait.
    if (input.usTextingOff) return { kind: "us_texting_off" };
    if (input.usSuspended) return { kind: "registration_suspended" };
    return { kind: "registration_pending" };
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
 * #423: the carrier suspended a registration that had been approved.
 *
 * Read off the same campaign row `usSendApproved` reads, so the two can never
 * disagree about which state the workspace is in.
 */
export function usSuspended(
  company: Pick<CompanyView, "registration">,
): boolean {
  return company.registration.campaign?.status === "suspended";
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
