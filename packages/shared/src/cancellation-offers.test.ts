/**
 * #277 follow-up — the offer table, and the four properties that keep it honest.
 *
 * THIS FILE IS THE FIXTURE the three clients build against. Kotlin and Swift
 * hand-port `cancellation-offers.ts`, so they hand-port these cases too. The
 * properties worth more than the string comparisons:
 *
 *   1. SILENCE IS A RESULT. Four of the seven reason/plan combinations return
 *      null, and each returns it for a stated reason. A future edit that fills
 *      one of them in with something invented fails here.
 *   2. NO PAUSE EXISTS. The seasonal answer is about a 30-day hold. Copy that
 *      says "pause", "freeze" or "suspend your plan" describes a feature this
 *      product does not have, and would be discovered as a lie by somebody who
 *      went looking for the button.
 *   3. THE FIGURES ARE READ, NOT TYPED. Every price and count in the output has
 *      to come from the price book and the plan limits, so a repricing moves the
 *      copy rather than stranding it.
 *   4. THE OFFER IS NEVER A STEP. Nothing here returns a route, and the one
 *      reason-with-no-control returns a null action, so no client can be handed
 *      a button it has to invent.
 */
import { describe, expect, it } from "vitest";

import { PLAN_PRICE_CENTS } from "./billing-currency";
import {
  CANCELLATION_GRACE_DAYS,
  CANCELLATION_REASON_CODES,
  cancellationOffer,
  isCancellationReasonCode,
  isWithinCancellationGrace,
  numberReleaseAt,
  type CancellationOfferInput,
  type CancellationOfferPhase,
} from "./cancellation-offers";
import { PLAN_NUMBERS, PLAN_SEATS } from "./seats";
import { SUPPORT_FIX_PROMISE, SUPPORT_RESPONSE_TIME } from "./support";

/** A US Pro workspace, the case with the most to say. */
const PRO_US: CancellationOfferInput = {
  reason: null,
  plan: "pro",
  billingCurrency: "usd",
  country: "US",
};

function offer(overrides: Partial<CancellationOfferInput>) {
  return cancellationOffer({ ...PRO_US, ...overrides });
}

/** Every string a client would put on screen for this input. */
function rendered(input: CancellationOfferInput): string {
  const result = cancellationOffer(input);
  if (result === null) return "";
  return [result.heading, result.body, result.actionLabel ?? ""].join(" ");
}

/** Every renderable string this module can produce, across every input. */
function allCopy(): string[] {
  const out: string[] = [];
  const phases: CancellationOfferPhase[] = ["before", "grace"];
  for (const reason of CANCELLATION_REASON_CODES) {
    for (const plan of ["starter", "pro", null]) {
      for (const phase of phases) {
        for (const billingCurrency of ["usd", "cad", null]) {
          for (const country of ["US", "CA"]) {
            for (const registrationFeePaidAt of [null, "2026-01-05T00:00:00Z"]) {
              out.push(
                rendered({
                  reason,
                  plan,
                  phase,
                  billingCurrency,
                  country,
                  registrationFeePaidAt,
                }),
              );
            }
          }
        }
      }
    }
  }
  return out.filter((line) => line !== "");
}

describe("saying nothing", () => {
  it("says nothing to a Starter workspace that finds it too expensive", () => {
    // THE CASE THE WHOLE MODULE IS JUDGED ON. There is no cheaper plan, so
    // there is no honest offer, and inventing one is the dishonesty #277
    // forbids.
    expect(offer({ reason: "too_expensive", plan: "starter" })).toBeNull();
    expect(
      offer({ reason: "too_expensive", plan: "starter", phase: "grace" }),
    ).toBeNull();
  });

  it("treats a workspace with no plan as Starter, and says nothing", () => {
    expect(offer({ reason: "too_expensive", plan: null })).toBeNull();
  });

  it.each(["switched", "not_using", "other"])(
    "says nothing to %s, on either plan and in both phases",
    (reason) => {
      for (const plan of ["starter", "pro"]) {
        for (const phase of ["before", "grace"] as CancellationOfferPhase[]) {
          expect(offer({ reason, plan, phase })).toBeNull();
        }
      }
    },
  );

  it("says nothing when no reason was given", () => {
    // The card records a row with no reason on purpose: nothing is required.
    expect(offer({ reason: null })).toBeNull();
    expect(offer({ reason: "" })).toBeNull();
    expect(offer({ reason: undefined })).toBeNull();
  });

  it("says nothing for a code this build has never heard of", () => {
    // A newer client sending a seventh reason must render nothing rather than
    // fall through to a guessed answer.
    expect(offer({ reason: "moving_to_carrier_pigeon" })).toBeNull();
    expect(offer({ reason: "TOO_EXPENSIVE" })).toBeNull();
  });
});

describe("too expensive, on Pro", () => {
  it("names Starter's real price, in the currency the workspace is charged", () => {
    const usd = offer({ reason: "too_expensive", billingCurrency: "usd" });
    expect(usd?.body).toContain("$29");
    expect(usd?.body).toContain("$79");

    const cad = offer({ reason: "too_expensive", billingCurrency: "cad" });
    expect(cad?.body).toContain("$39");
    expect(cad?.body).toContain("$109");
  });

  it("reads the figures from the price book rather than a literal", () => {
    // The guard that survives a repricing: if PLAN_PRICE_CENTS moves and the
    // copy does not, this fails.
    for (const currency of ["usd", "cad"] as const) {
      const body = offer({
        reason: "too_expensive",
        billingCurrency: currency,
      })!.body;
      const dollars = (cents: number) => String(cents / 100);
      expect(body).toContain(dollars(PLAN_PRICE_CENTS[currency].starter));
      expect(body).toContain(dollars(PLAN_PRICE_CENTS[currency].pro));
    }
  });

  it("falls back to the country's currency when none is stored", () => {
    // Every workspace predating #328 has a null billing_currency.
    expect(
      offer({ reason: "too_expensive", billingCurrency: null, country: "CA" })
        ?.body,
    ).toContain("$39");
    expect(
      offer({ reason: "too_expensive", billingCurrency: null, country: "US" })
        ?.body,
    ).toContain("$29");
    // An unrecognised stored currency is not trusted over the country either.
    expect(
      offer({
        reason: "too_expensive",
        billingCurrency: "gbp",
        country: "CA",
      })?.body,
    ).toContain("$39");
  });

  it("names the limits the API will actually enforce", () => {
    // Both are refusal conditions on POST /v1/billing/change-plan, so a figure
    // here that drifts from PLAN_LIMITS would be a promise the next click
    // refuses. The cross-source half of that is asserted at module load in
    // apps/api/src/routes/core/plans.ts; what is pinned here is that the copy
    // READS them rather than restating them.
    //
    // BEFORE PHASE ONLY, and the phase is spelled out rather than defaulted:
    // change-plan is the route that 409s over these, and it is the only one.
    const body = offer({ reason: "too_expensive", phase: "before" })!.body;
    expect(body).toContain(`${PLAN_SEATS.starter} people`);
    expect(body).toContain(`${PLAN_NUMBERS.starter} business number`);
    // ...and agrees with itself about how many that is. `toContain` alone
    // matches "1 business numbers" happily, which is the sort of thing that
    // ships because every assertion around it is green.
    const plural = PLAN_NUMBERS.starter === 1 ? "" : "s";
    expect(body).toContain(
      `${PLAN_NUMBERS.starter} business number${plural}.`,
    );
  });

  it("names no seat or number limit in the grace phase, where nothing applies one", () => {
    // THE DEFECT THIS PAIR EXISTS FOR. The grace action opens Stripe checkout,
    // whose only gates are "one live subscription" and the US registration
    // draft — it counts neither members nor numbers — and
    // `checkout.session.completed` then un-suspends every suspended number with
    // no plan filter. A Pro workspace with two numbers and eight members can
    // press a button captioned "covers 3 people and 1 business number" and land
    // on Starter holding two and eight, so that caption may not be printed
    // here. The price still is: checkout charges it.
    const grace = offer({ reason: "too_expensive", phase: "grace" })!;
    const copy = `${grace.heading} ${grace.body} ${grace.actionLabel}`;
    expect(copy).not.toContain(`${PLAN_SEATS.starter} people`);
    expect(copy).not.toContain("business number");
    expect(copy).not.toMatch(/\bseats?\b|\bcovers\b/i);
    expect(grace.body).toContain("$29");
  });

  it("does not promise the second number survives the downgrade", () => {
    // "your number and your message history stay exactly as they are" was true
    // for a workspace that fits Starter and false for the one being spoken to:
    // change-plan answers 409 "Release your extra phone number before
    // downgrading to Starter". The history does survive and is still promised.
    const body = offer({ reason: "too_expensive", phase: "before" })!.body;
    expect(body).not.toContain("stay exactly as they are");
    expect(body).toContain("message history comes with you");
    expect(body).toContain("a second number does not");
    expect(body).toContain("refused until you release it");
    expect(body).toContain(`back inside ${PLAN_SEATS.starter} seats`);
  });

  it("quotes no allowance figure — those live in the fair-use policy", () => {
    // #85/#121: the plan card on this same screen states allowances as a
    // fair-use line and puts the concrete numbers only in the policy. A count
    // here would be a second home for them.
    const body = offer({ reason: "too_expensive" })!.body;
    expect(body).toContain("fair-use policy");
    expect(body).not.toMatch(/\d{3,}/);
  });

  it("points at the plan switcher before cancelling, and at coming back after", () => {
    expect(offer({ reason: "too_expensive", phase: "before" })).toMatchObject({
      action: "change_plan",
      actionLabel: "Switch to Starter",
    });
    expect(offer({ reason: "too_expensive", phase: "grace" })).toMatchObject({
      action: "resubscribe_starter",
      actionLabel: "Come back on Starter",
    });
  });

  it("says when the switch lands, because it is not today", () => {
    // A downgrade applies at period end via a subscription schedule.
    expect(offer({ reason: "too_expensive", phase: "before" })?.body).toContain(
      "end of your current billing period",
    );
  });
});

describe("seasonal", () => {
  it("states the 30-day hold, read from the constant the job uses", () => {
    const body = offer({ reason: "seasonal" })!.body;
    expect(body).toContain(`${CANCELLATION_GRACE_DAYS} days`);
    expect(CANCELLATION_GRACE_DAYS).toBe(30);
  });

  it("says the number keeps receiving and that replying does not work", () => {
    // Both halves are checkable: numbers are suspended-but-receiving on
    // cancellation, and runPreSendGates answers 402 without an active
    // subscription. Stating only the first would let somebody plan a quiet
    // season around a product that answers their customers.
    const body = offer({ reason: "seasonal" })!.body;
    expect(body).toContain("receiving texts");
    expect(body).toContain("cannot reply");
  });

  it("promises the registration fee is not charged twice, only once it is paid", () => {
    const paid = offer({
      reason: "seasonal",
      registrationFeePaidAt: "2026-01-05T00:00:00Z",
    })!.body;
    expect(paid).toContain("once per workspace, ever");

    // Not yet paid: silence. They WILL be charged it on return, so a softened
    // version of this sentence would be false.
    for (const unpaid of [null, undefined, "", "   "]) {
      expect(
        offer({ reason: "seasonal", registrationFeePaidAt: unpaid })!.body,
      ).not.toContain("registration fee");
    }
  });

  it("offers no control, because there is nothing to press", () => {
    for (const phase of ["before", "grace"] as CancellationOfferPhase[]) {
      const result = offer({ reason: "seasonal", phase });
      expect(result?.action).toBeNull();
      expect(result?.actionLabel).toBeNull();
    }
  });

  it("anchors the hold to the cancellation in both phases", () => {
    // runGraceJob measures now - canceled_at, and startCancellationLifecycle
    // stamps that column from Stripe's `canceled_at` — which for a
    // cancel_at_period_end cancellation is the time of the REQUEST, not the end
    // of the period. Anything anchored to the period end describes a date about
    // a month later than the one the number actually dies on.
    for (const phase of ["before", "grace"] as CancellationOfferPhase[]) {
      const result = offer({ reason: "seasonal", phase })!;
      const copy = `${result.heading} ${result.body}`;
      expect(copy).toMatch(
        new RegExp(
          `${CANCELLATION_GRACE_DAYS} days .{0,20}from the day you cancel`,
        ),
      );
      // ...and says so against the wrong anchor by name, because the wrong
      // anchor is the one the reader already has in their head.
      expect(copy).toContain("not from the end of your");
    }
  });

  it("never heads the seasonal answer with cover for the whole absence", () => {
    // "Your number is held while you are gone" over a body that says 30 days,
    // to somebody who just said they will be back next spring. The heading is
    // the louder line, and a trades quiet season is months.
    for (const phase of ["before", "grace"] as CancellationOfferPhase[]) {
      const heading = offer({ reason: "seasonal", phase })!.heading;
      expect(heading.toLowerCase()).not.toMatch(
        /while you are (gone|away|out)|until you (are back|return)|(whole|entire|all) (season|winter|year)|as long as/,
      );
    }
  });

  it("says a longer season outruns the hold, rather than leaving it implied", () => {
    // The one fact a seasonal business needs and cannot get anywhere else: 30
    // days does not cover a winter, and #413 is what happens at the end of it.
    const body = offer({ reason: "seasonal", phase: "before" })!.body;
    expect(body).toContain("longer than that outruns the hold");
    expect(body).toContain("goes back to the phone company");
  });
});

describe("missing feature", () => {
  it("quotes the support constants rather than restating them", () => {
    const body = offer({ reason: "missing_feature" })!.body;
    expect(body).toContain(SUPPORT_RESPONSE_TIME);
    expect(body).toContain(SUPPORT_FIX_PROMISE);
  });

  it("points at the in-product help surface", () => {
    expect(offer({ reason: "missing_feature" })).toMatchObject({
      action: "open_help",
      actionLabel: "Get help",
    });
  });

  it("says the same thing in both phases", () => {
    // The promise does not change because they have already gone.
    expect(offer({ reason: "missing_feature", phase: "before" })).toEqual(
      offer({ reason: "missing_feature", phase: "grace" }),
    );
  });
});

describe("what no offer may ever claim", () => {
  it("never claims a pause feature exists", () => {
    // THE PROPERTY, not a spot check: every renderable string, over every
    // input. There is no pause, freeze or hold-my-plan control in this product,
    // and copy implying one sends somebody looking for a button that is not
    // there.
    for (const copy of allCopy()) {
      expect(copy.toLowerCase()).not.toMatch(
        /\bpause[sd]?\b|\bpausing\b|\bfreeze\b|\bfrozen\b|\bon hold\b|\bsuspend your\b/,
      );
    }
  });

  it("never counts the hold from a billing period", () => {
    // THE PROPERTY behind the seasonal pair above, applied to every string this
    // module can emit. `canceled_at` is stamped from Stripe's field, which for a
    // cancel_at_period_end cancellation is the time of the request — so "30 days
    // after your billing period ends" is roughly double the real answer, in the
    // customer's favour, about the number on the side of their van.
    //
    // Deliberately NOT a ban on "billing period": the downgrade genuinely lands
    // at period end via a subscription schedule, and both seasonal answers name
    // the wrong anchor in order to deny it. What is banned is tying the DAYS to
    // the period.
    for (const copy of allCopy()) {
      expect(copy).not.toMatch(
        /\b\d+ days (after|from|following) (your|the)( last| current| next)?( billing)? period/i,
      );
      expect(copy).not.toMatch(
        /(period ends?|end of (your|the)[a-z ]*period)[^.]{0,40}\b(then|and)\b[^.]{0,30}\b\d+ days/i,
      );
    }
  });

  it("never claims the number is kept forever", () => {
    for (const copy of allCopy()) {
      expect(copy.toLowerCase()).not.toMatch(
        /\bforever\b|\bpermanently\b|\bkeep it indefinitely\b/,
      );
    }
  });

  it("never hands a client a route, a URL or a mailto", () => {
    for (const copy of allCopy()) {
      expect(copy).not.toMatch(/https?:\/\/|mailto:|\/settings\//);
    }
  });

  it("produces a non-empty heading and body whenever it produces anything", () => {
    for (const copy of allCopy()) {
      expect(copy.trim().length).toBeGreaterThan(0);
    }
    for (const reason of ["too_expensive", "seasonal", "missing_feature"]) {
      const result = offer({ reason });
      expect(result?.heading.trim()).not.toBe("");
      expect(result?.body.trim()).not.toBe("");
      expect(result?.reason).toBe(reason);
    }
  });
});

describe("the grace deadline", () => {
  it("counts 30 days from canceled_at, matching the release job", () => {
    // runGraceJob measures now - canceled_at and releases at 30. Anything
    // measured from the period end would print a different date from the one
    // the number actually dies on.
    const release = numberReleaseAt("2026-03-01T00:00:00.000Z");
    expect(release?.toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("has no deadline for a workspace that never cancelled", () => {
    expect(numberReleaseAt(null)).toBeNull();
    expect(numberReleaseAt(undefined)).toBeNull();
    expect(numberReleaseAt("")).toBeNull();
    expect(numberReleaseAt("not a date")).toBeNull();
  });

  it("closes the window at the release, not after it", () => {
    const canceledAt = "2026-03-01T00:00:00.000Z";
    expect(
      isWithinCancellationGrace(canceledAt, new Date("2026-03-30T23:59:59Z")),
    ).toBe(true);
    // Exactly at the release the number is gone, so "resubscribe and keep your
    // number" stops being true here.
    expect(
      isWithinCancellationGrace(canceledAt, new Date("2026-03-31T00:00:00Z")),
    ).toBe(false);
    expect(
      isWithinCancellationGrace(canceledAt, new Date("2026-04-05T00:00:00Z")),
    ).toBe(false);
    expect(isWithinCancellationGrace(null, new Date())).toBe(false);
  });
});

describe("the reason codes", () => {
  it("are the six the cancel card offers", () => {
    expect([...CANCELLATION_REASON_CODES]).toEqual([
      "too_expensive",
      "seasonal",
      "missing_feature",
      "switched",
      "not_using",
      "other",
    ]);
  });

  it("all fit the 40 characters the column accepts", () => {
    for (const code of CANCELLATION_REASON_CODES) {
      expect(code.length).toBeLessThanOrEqual(40);
    }
  });

  it("recognises its own codes and nothing else", () => {
    expect(isCancellationReasonCode("seasonal")).toBe(true);
    expect(isCancellationReasonCode("Seasonal")).toBe(false);
    expect(isCancellationReasonCode(null)).toBe(false);
    expect(isCancellationReasonCode(7)).toBe(false);
  });
});
