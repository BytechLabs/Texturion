/**
 * eventSentence — the one switch every timeline system line flows through.
 * #129 pins the call lines (the thread must read as the full history, texts
 * AND calls) and the forward-compat null for unknown types.
 */
import { describe, expect, it, vi } from "vitest";

import type { ConversationEvent } from "@/lib/api/types";

// D43: SystemLine renders the voicemail player, whose data hook chains to the
// env-validated API client — mocked out so this stays a pure-sentence test.
vi.mock("@/components/calls/voicemail-player", () => ({
  VoicemailPlayer: () => null,
}));

import { NARRATED_PAYMENT_EVENT_TYPES } from "./payment-line";
import { eventSentence } from "./system-line";

function event(
  type: string,
  payload: Record<string, unknown> = {},
): ConversationEvent {
  return {
    id: "e-1",
    conversation_id: "c-1",
    actor_user_id: null,
    type: type as ConversationEvent["type"],
    payload,
    created_at: "2026-07-10T15:00:00Z",
  };
}

const noMember = () => null;

describe("eventSentence — #129 call lines", () => {
  it("narrates an answered call with its talk time", () => {
    expect(
      eventSentence(
        event("call_completed", { outcome: "answered", forward_seconds: 272 }),
        noMember,
      ),
    ).toBe("Call answered · 4m 32s");
  });

  it("narrates an answered call without a duration plainly", () => {
    expect(
      eventSentence(
        event("call_completed", { outcome: "answered", forward_seconds: 0 }),
        noMember,
      ),
    ).toBe("Call answered");
  });

  it("names who picked the call up (#517)", () => {
    // "Call answered" left out the one thing the rest of the crew wanted to
    // know: whether anyone actually dealt with it, and which of them.
    const named = (userId: string | null) =>
      userId === "u1" ? "Sam Ortiz" : null;
    expect(
      eventSentence(
        event("call_completed", {
          outcome: "answered",
          forward_seconds: 272,
          answered_by_user_id: "u1",
        }),
        named,
      ),
    ).toBe("Call answered by Sam Ortiz · 4m 32s");
  });

  it("falls back to the bare line when the answerer cannot be named", () => {
    // A call answered before the server started reporting it, or answered by
    // somebody since off the roster. "Call answered by " with nothing after it
    // is worse than the line it replaced.
    expect(
      eventSentence(
        event("call_completed", {
          outcome: "answered",
          forward_seconds: 0,
          answered_by_user_id: "gone",
        }),
        noMember,
      ),
    ).toBe("Call answered");
  });

  it("narrates voicemail and missed outcomes", () => {
    expect(
      eventSentence(
        event("call_completed", { outcome: "voicemail", forward_seconds: 31 }),
        noMember,
      ),
    ).toBe("Call went to voicemail");
    expect(
      eventSentence(
        event("call_completed", { outcome: "missed", forward_seconds: 0 }),
        noMember,
      ),
    ).toBe("Missed call");
  });

  it("keeps the missed_call text-back line untouched", () => {
    expect(eventSentence(event("missed_call"), noMember)).toBe(
      "This customer called and no one picked up, so we texted them back",
    );
  });

  it("narrates outbound bridge calls from the crew's side (D38)", () => {
    expect(
      eventSentence(
        event("call_completed", {
          outcome: "answered",
          forward_seconds: 192,
          direction: "outbound",
        }),
        noMember,
      ),
    ).toBe("You called · 3m 12s");
    expect(
      eventSentence(
        event("call_completed", {
          outcome: "missed",
          forward_seconds: 0,
          direction: "outbound",
        }),
        noMember,
      ),
    ).toBe("Called, no answer");
  });

  it("renders nothing for unknown event types (forward compatibility)", () => {
    expect(
      eventSentence(event("some_future_event_type"), noMember),
    ).toBeUndefined();
  });
});

/**
 * #607 A3 — the five payment lines.
 *
 * THE DEFECT THESE EXIST FOR. Every one of these rows has always been written
 * to `conversation_events` and returned by the API, and web narrated none of
 * them: the labels were missing from `ConversationEventType`, `eventSentence`
 * fell off the end of its switch, and `SystemLine` rendered null. The phones
 * rendered `event.type` with the underscores taken out ("Payment refunded") —
 * so one insert produced three different screens, and the worst of the three
 * was on the device the crew actually carries.
 *
 * The sentences are asserted VERBATIM because they are the shared decision:
 * identical on web, Android (`Timeline.kt` `paymentLine`) and iOS
 * (`Timeline.swift` `paymentEventLine`). A reword on one client is a defect,
 * not a preference, so a test that only checked "some sentence came back" would
 * miss the thing worth checking. `eventSentence`'s default `t` reads the real
 * English catalogue, so these run end to end through `sections/thread.ts`.
 */
describe("eventSentence — #607 payment lines", () => {
  const SAM = "88888888-8888-8888-8888-888888888888";
  const crew = (userId: string | null) => (userId === SAM ? "Sam Ortiz" : null);

  /** A payment row as the API writes it: actor for the two a member performs. */
  function payment(
    type: string,
    payload: Record<string, unknown>,
    actor: string | null = null,
  ): ConversationEvent {
    return { ...event(type, payload), actor_user_id: actor };
  }

  const CHARGE = { amount_cents: 25_000, currency: "usd" };

  it("narrates every type it is given — none falls off the switch", () => {
    // The A3 defect itself, as one assertion. Iterated from the shipped list
    // rather than a retyped set of five, so a sixth payment type added to the
    // product cannot be silently un-narrated here.
    for (const type of NARRATED_PAYMENT_EVENT_TYPES) {
      const sentence = eventSentence(payment(type, CHARGE, SAM), crew);
      expect(sentence, type).toBeTruthy();
      // And it is a SENTENCE, not the machine label the phones used to show.
      expect(sentence, type).not.toContain("_");
    }
  });

  it("says the shared wording for each of the five", () => {
    const said = (type: string, payload: Record<string, unknown>) =>
      eventSentence(payment(type, payload, SAM), crew);

    expect(said("payment_requested", CHARGE)).toBe("Sam Ortiz asked for $250");
    expect(said("payment_paid", CHARGE)).toBe("They paid $250");
    expect(said("payment_cancelled", CHARGE)).toBe(
      "Sam Ortiz called off the $250 request",
    );
    expect(
      said("payment_refunded", { ...CHARGE, amount_refunded_cents: 25_000 }),
    ).toBe("$250 went back to them");
    expect(said("payment_disputed", CHARGE)).toBe("Their bank pulled back $250");
  });

  it("names nobody on the three the workspace did not do", () => {
    // `actor_user_id` is null on paid/refunded/disputed because the customer,
    // the business's own Stripe dashboard and the customer's bank did them. The
    // `by` fallback is the product name, so a line that took it would read
    // "Loonext paid $250" — us, credited with the customer's money.
    for (const type of ["payment_paid", "payment_refunded", "payment_disputed"]) {
      const sentence = eventSentence(payment(type, CHARGE, SAM), crew);
      expect(sentence, type).not.toContain("Sam Ortiz");
      expect(sentence, type).not.toContain("Loonext");
    }
    // …and the two a crew member really does perform carry the name.
    for (const type of ["payment_requested", "payment_cancelled"]) {
      expect(eventSentence(payment(type, CHARGE, SAM), crew), type).toContain(
        "Sam Ortiz",
      );
    }
  });

  it("appends what the money was for, when the crew typed one", () => {
    expect(
      eventSentence(
        payment("payment_paid", { ...CHARGE, description: "Deposit" }),
        noMember,
      ),
    ).toBe("They paid $250 — Deposit");
    // Blank is not a description. Trailing " — " with nothing after it is the
    // sentence-with-a-hole this rule exists to avoid.
    expect(
      eventSentence(
        payment("payment_paid", { ...CHARGE, description: "   " }),
        noMember,
      ),
    ).toBe("They paid $250");
  });

  it("reports what WENT BACK on a refund, not what was charged", () => {
    // A partial refund is the ordinary case — a deposit returned less a
    // call-out fee — and quoting the charge would tell the crew the customer
    // got more back than they did.
    expect(
      eventSentence(
        payment("payment_refunded", {
          ...CHARGE,
          amount_refunded_cents: 15_000,
        }),
        noMember,
      ),
    ).toBe("$150 went back to them");
    // Zero is ABSENT, not "nothing moved": the column is nullable and a stored
    // zero means the webhook did not know the figure.
    expect(
      eventSentence(
        payment("payment_refunded", { ...CHARGE, amount_refunded_cents: 0 }),
        noMember,
      ),
    ).toBe("$250 went back to them");
  });

  it("quotes the charge on a dispute, never the refunded column", () => {
    // `settle()` passes `amount: null` for a chargeback, so the refunded column
    // is not the disputed figure. A row carrying both must still say the charge.
    expect(
      eventSentence(
        payment("payment_disputed", {
          ...CHARGE,
          amount_refunded_cents: 15_000,
        }),
        noMember,
      ),
    ).toBe("Their bank pulled back $250");
  });

  it("says the amount-less twin rather than a sentence with a hole in it", () => {
    // The payload is untyped jsonb and one writer reads its figures out of an
    // optional RPC result (`webhooks/stripe-connect.ts`), so a missing figure is
    // real. A string where a number belongs is the #270 shape and reads as
    // absent too.
    expect(
      eventSentence(payment("payment_requested", { currency: "usd" }, SAM), crew),
    ).toBe("Sam Ortiz asked for a payment");
    expect(
      eventSentence(payment("payment_paid", { currency: "usd" }), noMember),
    ).toBe("They paid");
    expect(
      eventSentence(payment("payment_cancelled", {}, SAM), crew),
    ).toBe("Sam Ortiz called off the request");
    expect(
      eventSentence(
        payment("payment_refunded", { amount_cents: "25000" }),
        noMember,
      ),
    ).toBe("The money went back to them");
    expect(eventSentence(payment("payment_disputed", {}), noMember)).toBe(
      "Their bank pulled this payment back",
    );
  });

  it("reads the money in the connected account's own currency", () => {
    // The figure is in the STRIPE account's currency, and the reader IS that
    // account — so no "CA$" qualifier, which is the same call the strip makes.
    // An unknown or absent code reads as USD rather than losing the figure.
    expect(
      eventSentence(
        payment("payment_paid", { amount_cents: 25_000, currency: "cad" }),
        noMember,
      ),
    ).toBe("They paid $250");
    expect(
      eventSentence(
        payment("payment_paid", { amount_cents: 25_000, currency: "EUR" }),
        noMember,
      ),
    ).toBe("They paid $250");
    // Cents survive: a part-dollar payment keeps them. (Deliberately not a
    // figure from the plan price book — `price-surfaces.test.ts` forbids typing
    // one anywhere under src/, and a test fixture is not an exemption.)
    expect(
      eventSentence(
        payment("payment_paid", { amount_cents: 4_250, currency: "usd" }),
        noMember,
      ),
    ).toBe("They paid $42.50");
  });
});
