/**
 * #523 — why a suspended number is suspended, and what that licenses us to say.
 *
 * The interesting assertions here are the two REFUSALS: the resolver must not
 * re-derive the server's `reason` when it could not read it, and it must not
 * carry a workspace-level reason onto a row the server did not name.
 */
import { describe, expect, it } from "vitest";

import type { HeldNumbersView } from "@/lib/api/billing";
import type {
  CompanyView,
  PhoneNumberSummary,
  PortRequest,
} from "@/lib/api/types";

import { holdForPort, numberHoldState } from "./number-hold";

function view(over: Partial<HeldNumbersView> = {}): HeldNumbersView {
  return {
    plan: "starter",
    included: 1,
    paid_extras: 0,
    allowance: 1,
    max_total: 2,
    reason: "over_plan_allowance",
    held: [{ id: "n2", number_e164: "+14155550102", suspended_at: null }],
    extra_number_cents: 500,
    extra_number_currency: "usd",
    can_reinstate: true,
    can_upgrade: true,
    ...over,
  };
}

describe("numberHoldState", () => {
  it("says nothing about a number that is not suspended", () => {
    expect(
      numberHoldState({
        status: "active",
        numberId: "n2",
        subscriptionActive: true,
        held: view(),
      }),
    ).toBeNull();
  });

  it("uses the server's answer, with the allowance it served", () => {
    expect(
      numberHoldState({
        status: "suspended",
        numberId: "n2",
        subscriptionActive: true,
        held: view({ allowance: 1 }),
      }),
    ).toEqual({ kind: "over_allowance", allowance: 1 });
  });

  it("does not carry the workspace's reason onto a row the server did not name", () => {
    // `reason` describes the WORKSPACE. A number that is suspended but absent
    // from `held` has not been explained by this answer, and claiming it is
    // over the allowance would be inventing a cause.
    expect(
      numberHoldState({
        status: "suspended",
        numberId: "someone-else",
        subscriptionActive: true,
        held: view(),
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("treats the grace window as its own state, not as an allowance hold", () => {
    expect(
      numberHoldState({
        status: "suspended",
        numberId: "n2",
        subscriptionActive: false,
        held: undefined,
      }),
    ).toEqual({ kind: "subscription_inactive" });
  });

  it("answers 'unknown' for a reader who could not ask — never a guess", () => {
    // A MEMBER. `GET /v1/billing/held-numbers` is behind `billing.manage`, so
    // there is no answer to read. The subscription is live, so the old copy
    // would have sent them to update a payment method that is working. The
    // whole point of this branch is that it declines to name a cause.
    expect(
      numberHoldState({
        status: "suspended",
        numberId: "n2",
        subscriptionActive: true,
        held: undefined,
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("does not treat a grace-window answer as an allowance hold", () => {
    // The server distinguishes the two reasons precisely so this cannot
    // happen. If `reason` is ever ignored here, the win-back card and this row
    // start giving a cancelled workspace two different explanations.
    expect(
      numberHoldState({
        status: "suspended",
        numberId: "n2",
        subscriptionActive: false,
        held: view({ reason: "subscription_inactive" }),
      }),
    ).toEqual({ kind: "subscription_inactive" });
  });
});

/**
 * #523 — the same question, asked from the port stepper.
 *
 * A transferred-in number is de-duplicated out of the `NumberCard` list, so its
 * stepper is the only card it has. The stepper reads the PORT row, which knows
 * the transfer completed and nothing about whether the line still works — which
 * is how a held ported number came to read "Live on Loonext" over a number that
 * cannot send.
 */
function portRow(over: Partial<PortRequest> = {}): PortRequest {
  return {
    id: "port-1",
    phone_e164: "+14165550142",
    status: "ported",
    messaging_port_status: "ported",
    ...over,
  } as unknown as PortRequest;
}

function numberRow(over: Partial<PhoneNumberSummary> = {}): PhoneNumberSummary {
  return {
    id: "n2",
    status: "suspended",
    number_e164: "+14165550142",
    source: "ported",
    requested_area_code: null,
    ...over,
  } as unknown as PhoneNumberSummary;
}

const live = { subscription_status: "active" } as CompanyView;

describe("holdForPort", () => {
  it("explains a held transferred line exactly as the number card would", () => {
    expect(holdForPort(portRow(), [numberRow()], live, view())).toEqual({
      kind: "over_allowance",
      allowance: 1,
    });
  });

  it("says nothing about a line that is working", () => {
    expect(
      holdForPort(portRow(), [numberRow({ status: "active" })], live, view()),
    ).toBeNull();
  });

  it("says nothing while the number has not arrived", () => {
    // Mid-transfer there is no E.164 on the row, so nothing matches and nothing
    // is claimed. This is what lets the card replace its transfer banner
    // outright when a hold IS resolved.
    expect(
      holdForPort(
        portRow({ status: "in-process" }),
        [numberRow({ status: "provisioning", number_e164: null })],
        live,
        undefined,
      ),
    ).toBeNull();
  });

  it("declines to name a cause it could not read", () => {
    // The billing route is behind `billing.manage` and can also simply fail.
    // The stepper must not fall back to the payment-method guess here any more
    // than the number card does.
    expect(holdForPort(portRow(), [numberRow()], live, undefined)).toEqual({
      kind: "unknown",
    });
  });
});
