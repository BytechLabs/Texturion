import { describe, expect, it } from "vitest";

import {
  PAYMENT_MAX_CENTS,
  PAYMENT_MIN_CENTS,
  paymentAmountProblem,
  paymentRequestCancellable,
  paymentRequestLabel,
  paymentRequestState,
  payoutReadiness,
  payoutReadinessCopy,
  payoutRequirementCopy,
} from "./payments";
import { paymentAmountProblemCopy, paymentRequestSms } from "./payments-copy";

/**
 * #224 — the vectors the Kotlin and Swift ports are checked against.
 *
 * Three clients hand-port this file, and #548 is the standing lesson: a rule
 * written three times drifts. Every case below is one a port has to reproduce,
 * and the state-precedence block is the one that decides whether a crew chases
 * a customer for money they already paid.
 */
describe("paymentRequestState", () => {
  it("reads a plain open request as waiting", () => {
    expect(paymentRequestState({ status: "requested" })).toBe("requested");
  });

  it("reads paid from either the status or the stamp", () => {
    expect(paymentRequestState({ status: "paid" })).toBe("paid");
    expect(
      paymentRequestState({ status: "requested", paid_at: "2026-08-01T00:00:00Z" }),
    ).toBe("paid");
  });

  it("puts a dispute above a refund, because a chargeback needs somebody", () => {
    expect(
      paymentRequestState({
        status: "paid",
        paid_at: "2026-08-01T00:00:00Z",
        refunded_at: "2026-08-02T00:00:00Z",
        disputed_at: "2026-08-03T00:00:00Z",
      }),
    ).toBe("disputed");
  });

  it("puts a refund above paid", () => {
    expect(
      paymentRequestState({
        status: "paid",
        paid_at: "2026-08-01T00:00:00Z",
        refunded_at: "2026-08-02T00:00:00Z",
      }),
    ).toBe("refunded");
  });

  /**
   * THE case. A cancelled request whose link somehow still took a payment must
   * read as PAID — the money is real, and telling a crew otherwise is how a
   * customer gets chased for a bill they already settled.
   */
  it("reads a cancelled-but-paid request as paid", () => {
    expect(
      paymentRequestState({
        status: "cancelled",
        paid_at: "2026-08-01T00:00:00Z",
      }),
    ).toBe("paid");
  });

  it("reads cancelled and expired straight through", () => {
    expect(paymentRequestState({ status: "cancelled" })).toBe("cancelled");
    expect(paymentRequestState({ status: "expired" })).toBe("expired");
  });
});

describe("paymentRequestLabel", () => {
  it("gives every state exactly one word", () => {
    const states = [
      "requested",
      "paid",
      "refunded",
      "disputed",
      "cancelled",
      "expired",
    ] as const;
    const labels = states.map((state) => paymentRequestLabel(state));
    expect(labels).toEqual([
      "Waiting",
      "Paid",
      "Refunded",
      "Disputed",
      "Cancelled",
      "Expired",
    ]);
    // No two states share a word: a reader must never have to guess which of
    // two situations a row is in.
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("paymentRequestCancellable", () => {
  it("offers cancel only while the request is genuinely open", () => {
    expect(paymentRequestCancellable({ status: "requested" })).toBe(true);
    expect(paymentRequestCancellable({ status: "paid" })).toBe(false);
    expect(paymentRequestCancellable({ status: "cancelled" })).toBe(false);
    // Expired is already dead. A Cancel on it would be a tap that does nothing,
    // which reads as a broken button rather than a settled state.
    expect(paymentRequestCancellable({ status: "expired" })).toBe(false);
  });
});

describe("paymentAmountProblem", () => {
  it("accepts an ordinary trade amount", () => {
    expect(paymentAmountProblem(25_000)).toBeNull();
  });

  it("refuses below Stripe's own floor", () => {
    expect(paymentAmountProblem(PAYMENT_MIN_CENTS - 1)).toBe("too_small");
    expect(paymentAmountProblem(PAYMENT_MIN_CENTS)).toBeNull();
  });

  it("refuses the missed decimal", () => {
    expect(paymentAmountProblem(PAYMENT_MAX_CENTS + 1)).toBe("too_large");
    expect(paymentAmountProblem(PAYMENT_MAX_CENTS)).toBeNull();
  });

  it("refuses a fractional cent", () => {
    expect(paymentAmountProblem(1000.5)).toBe("not_whole");
  });

  it("states the bound in the reader's own currency", () => {
    expect(paymentAmountProblemCopy("too_small", "cad")).toContain("$1");
    expect(paymentAmountProblemCopy("too_large", "usd")).toContain("$25,000");
  });
});

describe("paymentRequestSms", () => {
  const text = paymentRequestSms({
    businessName: "Northline Plumbing",
    amountCents: 25_000,
    currency: "usd",
    description: "Deposit for Tuesday",
    url: "https://app.loonext.com/pay/abc",
  });

  it("leads with the business, then the amount", () => {
    expect(text.startsWith("Northline Plumbing: $250 for Deposit for Tuesday.")).toBe(
      true,
    );
  });

  it("puts the link last and on its own line, so every phone linkifies it", () => {
    const lines = text.split("\n");
    expect(lines[lines.length - 1]).toBe("https://app.loonext.com/pay/abc");
  });

  it("says nothing a spam filter or a homeowner reads as pressure", () => {
    for (const banned of ["click here", "urgent", "immediately", "act now"]) {
      expect(text.toLowerCase()).not.toContain(banned);
    }
  });
});

describe("payoutReadiness", () => {
  const base = {
    connected: true,
    charges_enabled: false,
    details_submitted: false,
    disabled_reason: null,
    requirements_due: [],
  };

  it("is not_connected with no account at all", () => {
    expect(payoutReadiness(null)).toBe("not_connected");
    expect(payoutReadiness({ ...base, connected: false })).toBe("not_connected");
  });

  /**
   * `charges_enabled` decides, and it decides ALONE. A restricted account with
   * charges somehow still on is ready — because Stripe says it can take the
   * card, and Stripe is the only thing that knows.
   */
  it("is ready whenever Stripe says charges are enabled", () => {
    expect(payoutReadiness({ ...base, charges_enabled: true })).toBe("ready");
    expect(
      payoutReadiness({
        ...base,
        charges_enabled: true,
        disabled_reason: "requirements.past_due",
      }),
    ).toBe("ready");
  });

  it("names the reason when charges are off", () => {
    expect(
      payoutReadiness({ ...base, disabled_reason: "requirements.past_due" }),
    ).toBe("restricted");
    expect(payoutReadiness(base)).toBe("onboarding_incomplete");
    // Everything handed over, nothing outstanding, charges still off: Stripe is
    // looking at it, and there is nothing for the owner to do.
    expect(payoutReadiness({ ...base, details_submitted: true })).toBe(
      "pending_verification",
    );
  });
});

describe("payoutReadinessCopy", () => {
  it("offers an action for every state a person can act on", () => {
    for (const readiness of [
      "not_connected",
      "onboarding_incomplete",
      "restricted",
      "ready",
    ] as const) {
      expect(payoutReadinessCopy(readiness).action).toBeTruthy();
    }
  });

  it("offers NO action while Stripe is verifying, and says so", () => {
    const copy = payoutReadinessCopy("pending_verification");
    expect(copy.action).toBeNull();
    expect(copy.detail).toContain("nothing for you to do");
  });

  it("never promises the platform takes a cut", () => {
    expect(payoutReadinessCopy("not_connected").detail).toContain(
      "take nothing on top",
    );
  });
});

describe("payoutRequirementCopy", () => {
  it("turns Stripe's identifiers into words a plumber reads", () => {
    expect(payoutRequirementCopy("external_account")).toBe(
      "Your bank account details",
    );
    expect(payoutRequirementCopy("individual.verification.document")).toBe(
      "Photo ID for the business owner",
    );
  });

  /**
   * The fallback matters more than the table. Stripe adds requirement
   * identifiers without telling anybody, and an outstanding requirement nobody
   * can see is the state where an owner concludes the product is broken — so an
   * unknown identifier is made readable rather than dropped.
   */
  it("renders an unknown identifier rather than swallowing it", () => {
    expect(payoutRequirementCopy("company.owners_provided")).toBe(
      "Owners provided",
    );
    expect(payoutRequirementCopy("individual.political_exposure")).toBe(
      "Political exposure",
    );
  });
});
