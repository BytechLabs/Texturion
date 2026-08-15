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
 *   2. THE PAUSE IS NAMED ONLY TO A WORKSPACE THAT IS IN ONE. #277 built it, so
 *      "there is no pause" is no longer the property; this is. Whether a pause
 *      is on OFFER is a Stripe read the API owns and this module cannot see, so
 *      copy that mentions one to an unpaused reader is an offer we invented —
 *      and it would be discovered by somebody who went looking for the button
 *      and found `already_prepaid`.
 *   3. THE FIGURES ARE READ, NOT TYPED. Every price and count in the output has
 *      to come from the price book and the plan limits, so a repricing moves the
 *      copy rather than stranding it.
 *   4. THE OFFER IS NEVER A STEP. Nothing here returns a route, and the one
 *      reason-with-no-control returns a null action, so no client can be handed
 *      a button it has to invent.
 *   5. NO ANSWER PRINTS A CONTROL THE PRODUCT WOULD REFUSE. Added with the
 *      pause, which is the first state where a shipped action became a 409: the
 *      too-expensive answer offered "Switch to Starter" to a paused workspace
 *      whose plan switch POST /v1/billing/change-plan refuses outright.
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
  type CancellationOffer,
  type CancellationOfferInput,
  type CancellationOfferPhase,
} from "./cancellation-offers";
import { PLAN_NUMBERS, PLAN_SEATS } from "./seats";
import { SUPPORT_FIX_PROMISE_EN, SUPPORT_RESPONSE_TIME_EN } from "./support";

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

/**
 * Every renderable string this module can produce, across every input.
 *
 * `pauseStates` narrows the sweep to the workspaces a property is about — the
 * default is all three, which is what a property that must hold everywhere
 * wants. `undefined` is in there beside `false` on purpose: an omitted flag is
 * how all three clients called this before #277 and is the case a regression
 * would land on.
 */
function allCopy(
  pauseStates: readonly (boolean | undefined)[] = [undefined, false, true],
): string[] {
  const out: string[] = [];
  const phases: CancellationOfferPhase[] = ["before", "grace"];
  for (const reason of CANCELLATION_REASON_CODES) {
    for (const plan of ["starter", "pro", null]) {
      for (const phase of phases) {
        for (const paused of pauseStates) {
          for (const billingCurrency of ["usd", "cad", null]) {
            for (const country of ["US", "CA"]) {
              for (const registrationFeePaidAt of [
                null,
                "2026-01-05T00:00:00Z",
              ]) {
                out.push(
                  rendered({
                    reason,
                    plan,
                    phase,
                    paused,
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
  }
  return out.filter((line) => line !== "");
}

/** Every offer object this module can produce, with the input that made it. */
function allOffers(
  pauseStates: readonly (boolean | undefined)[] = [undefined, false, true],
): { input: CancellationOfferInput; offer: CancellationOffer }[] {
  const out: { input: CancellationOfferInput; offer: CancellationOffer }[] = [];
  for (const reason of CANCELLATION_REASON_CODES) {
    for (const plan of ["starter", "pro", null]) {
      for (const phase of ["before", "grace"] as CancellationOfferPhase[]) {
        for (const paused of pauseStates) {
          const input: CancellationOfferInput = {
            reason,
            plan,
            phase,
            paused,
            billingCurrency: "usd",
            country: "US",
          };
          const result = cancellationOffer(input);
          if (result !== null) out.push({ input, offer: result });
        }
      }
    }
  }
  return out;
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

describe("too expensive, on Pro, while paused (#277)", () => {
  const paused = () =>
    offer({ reason: "too_expensive", phase: "before", paused: true })!;

  it("OFFER-P1: prints no control, because the plan switch is refused while paused", () => {
    // THE DEFECT. While paused the pause offer is over (GET /v1/billing/pause
    // answers already_paused), so the cancel card falls through to this module
    // — and it drew "Switch to Starter" an inch under the answer, on a
    // workspace whose POST /v1/billing/change-plan returns 409 "Your plan is
    // paused. Resume it first, then switch plans". The plan card's own switcher
    // was gated on the same fact; this one was not, which made it the only
    // pressable route to that refusal on the screen.
    expect(paused().action).toBeNull();
    expect(paused().actionLabel).toBeNull();
  });

  it("keeps the cheaper plan, because that is still the true answer to the price", () => {
    // Dropping to null here was the other option and it is worse: somebody
    // cancelling over $79 would be told nothing about the $29 plan they can
    // have. What was refused is the click, not the fact.
    const body = paused().body;
    expect(body).toContain("$29");
    expect(body).toContain("$79");
    for (const currency of ["usd", "cad"] as const) {
      const priced = offer({
        reason: "too_expensive",
        paused: true,
        billingCurrency: currency,
      })!.body;
      expect(priced).toContain(String(PLAN_PRICE_CENTS[currency].starter / 100));
      expect(priced).toContain(String(PLAN_PRICE_CENTS[currency].pro / 100));
    }
  });

  it("names the two steps in the order the API insists on", () => {
    // The same order the 409 names, deliberately: somebody who goes and does it
    // reads one sentence twice rather than two that disagree. There is no
    // `resume` action to press — Resume is already on the paused card at the top
    // of this screen, and a second one here would be this module growing a
    // control, which the header forbids.
    expect(paused().body).toContain("resume first, then switch plans");
    expect(paused().body).toContain("Your plan is paused");
  });

  it("still names the seats and numbers change-plan will refuse over", () => {
    // The route this copy points at is still change-plan — after a resume — and
    // it still 409s over both. "A figure may only be printed on the path that
    // enforces it" cuts the other way here: the path is unchanged, so the
    // figures stay.
    const body = paused().body;
    expect(body).toContain(`${PLAN_SEATS.starter} people`);
    expect(body).toContain(`${PLAN_NUMBERS.starter} business number`);
    expect(body).toContain(`back inside ${PLAN_SEATS.starter} seats`);
  });

  it("heads it exactly as it heads the unpaused answer", () => {
    // One string, not two: the heading is a fact about the two plans and the
    // pause does not touch it. Three clients hand-port these, and a second
    // heading is a second thing to drift.
    expect(paused().heading).toBe(
      offer({ reason: "too_expensive", phase: "before" })!.heading,
    );
  });

  it("still says nothing to a paused Starter workspace", () => {
    // There is still nothing below Starter, and a pause does not invent one.
    expect(
      offer({ reason: "too_expensive", plan: "starter", paused: true }),
    ).toBeNull();
    expect(offer({ reason: "too_expensive", plan: null, paused: true })).toBeNull();
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
    //
    // NOT APPLIED TO THE PAUSED ANSWER, and deliberately: this ban exists
    // because the hold is 30 days, and a pause has no clock at all — "held for
    // as long as you stay paused" is simply true there. A guard kept past the
    // fact that justified it stops being a guard and becomes a ceiling.
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
    //
    // UNPAUSED ONLY, and the paused case below is why: for somebody already
    // paused this sentence is false — nothing of theirs is running out — and it
    // sits on screen with a card that says so.
    const body = offer({ reason: "seasonal", phase: "before" })!.body;
    expect(body).toContain("longer than that outruns the hold");
    expect(body).toContain("goes back to the phone company");
  });
});

describe("seasonal, while paused (#277)", () => {
  const paused = () => offer({ reason: "seasonal", paused: true })!;

  it("OFFER-P2: does not tell a paused workspace their hold is running out", () => {
    // THE DEFECT, and it was a contradiction rather than a subtlety: the paused
    // card twelve lines up says nothing expires while you are paused, and this
    // answer ended "...a quiet season longer than that outruns the hold and the
    // number goes back to the phone company." Both sentences on one screen. The
    // 30-day hold is not what is holding their number — the pause is, and it has
    // no clock. If this ever falls back to the unpaused copy, the first
    // assertion is the one that fires.
    expect(paused().body).toContain("nothing expires while your plan is paused");
    expect(paused().body).not.toContain("outruns the hold");
    expect(paused().heading).not.toBe(
      offer({ reason: "seasonal" })!.heading,
    );
  });

  it("attaches every deadline it names to cancelling, not to the pause", () => {
    // The property behind the assertion above, sentence by sentence: the only
    // countdown in this product starts at `canceled_at`, so a paused reader may
    // only meet a number of days inside a sentence about cancelling. "Your pause
    // ends in 30 days" would pass a toContain check on the copy and fail here.
    for (const sentence of paused().body.split(/(?<=\.)\s+/)) {
      if (sentence.includes(`${CANCELLATION_GRACE_DAYS} days`)) {
        expect(sentence.toLowerCase()).toContain("cancel");
      }
    }
    expect(paused().body).toContain(`${CANCELLATION_GRACE_DAYS} days`);
  });

  it("anchors that clock to the cancellation, like every other answer", () => {
    // Same fact, same reason: runGraceJob measures now - canceled_at, so a
    // period-end anchor is about a month of somebody else's arithmetic.
    const copy = `${paused().heading} ${paused().body}`;
    expect(copy).toMatch(
      new RegExp(`${CANCELLATION_GRACE_DAYS} days .{0,20}from the day you cancel`),
    );
    expect(copy).toContain("not from the end of your");
    expect(paused().body).toContain("goes back to the phone company");
  });

  it("offers no control, because there is still nothing to press", () => {
    // Resume lives on the paused card on this same screen. A second one here
    // would make the answer a step, which is the thing the whole card refuses.
    expect(paused().action).toBeNull();
    expect(paused().actionLabel).toBeNull();
  });

  it("promises the registration fee is not charged twice, on the same gate", () => {
    // The question "what does coming back cost" survives the pause unchanged,
    // and so does the answer: at most once per workspace, ever.
    expect(
      offer({
        reason: "seasonal",
        paused: true,
        registrationFeePaidAt: "2026-01-05T00:00:00Z",
      })!.body,
    ).toContain("once per workspace, ever");
    for (const unpaid of [null, undefined, "", "   "]) {
      expect(
        offer({
          reason: "seasonal",
          paused: true,
          registrationFeePaidAt: unpaid,
        })!.body,
      ).not.toContain("registration fee");
    }
  });
});

describe("missing feature", () => {
  it("quotes the support constants rather than restating them", () => {
    const body = offer({ reason: "missing_feature" })!.body;
    expect(body).toContain(SUPPORT_RESPONSE_TIME_EN);
    expect(body).toContain(SUPPORT_FIX_PROMISE_EN);
  });

  it("points at the in-product help surface", () => {
    expect(offer({ reason: "missing_feature" })).toMatchObject({
      action: "open_help",
      actionLabel: "Get help",
    });
  });

  it("says the same thing in both phases, and while paused", () => {
    // The promise does not change because they have already gone, and it does
    // not change because their plan is paused: it is a promise about us
    // answering, not about the state of their subscription.
    expect(offer({ reason: "missing_feature", phase: "before" })).toEqual(
      offer({ reason: "missing_feature", phase: "grace" }),
    );
    expect(offer({ reason: "missing_feature", paused: true })).toEqual(
      offer({ reason: "missing_feature" }),
    );
  });
});

describe("what no offer may ever claim", () => {
  it("never names a pause to a workspace that is not in one", () => {
    // THE PROPERTY, not a spot check: every renderable string, over every input
    // that does not say `paused: true` — including the omitted flag, which is
    // how this was called before #277 and where a regression would land.
    //
    // The pause exists now, so the old absolute ban is gone; what replaced it is
    // narrower and load-bearing. Whether a pause is on OFFER is a Stripe read
    // GET /v1/billing/pause owns, and it refuses a workspace with a prepaid
    // year, an unconsumed referral month, a pending plan change, an unhealthy
    // card or an unprovisioned price. This module sees none of that, so a
    // sentence here mentioning a pause to somebody who is not in one sends them
    // looking for a button the API will not give them.
    for (const copy of allCopy([undefined, false])) {
      expect(copy.toLowerCase()).not.toMatch(
        /\bpause[sd]?\b|\bpausing\b|\bfreeze\b|\bfrozen\b|\bon hold\b|\bsuspend your\b/,
      );
    }
    // ...and it is not satisfied by silence: the paused answers do say it.
    expect(
      allCopy([true]).some((copy) => copy.toLowerCase().includes("paused")),
    ).toBe(true);
  });

  it("never returns a control the product refuses in the state it was returned for", () => {
    // `change_plan` names the plan switcher, and POST /v1/billing/change-plan
    // 409s while `companies.paused_at` is set. Every other action is reachable
    // in the state it is offered in: `resubscribe_starter` is grace-only
    // checkout, `open_help` is a screen. So the whole of this property is
    // "nothing hands a paused workspace the plan switcher", swept over every
    // reason, plan and phase rather than spot-checked on the one that had it.
    for (const { input, offer: result } of allOffers([true])) {
      if (input.phase === "before") {
        expect(result.action).not.toBe("change_plan");
      }
    }
  });

  it("ignores a paused flag in the grace phase, where the pause is over", () => {
    // `paused_at` outlives the subscription it belonged to — nothing clears it
    // on cancellation, deliberately (the daily reconcile skips cancelled
    // tenants; claim_checkout_activation clears it only if they come back, see
    // 20260805080000_resubscribe_clears_pause.sql). `isPaused` in
    // scripts/ops/pricing-report.mjs draws this same line, after the stale fact
    // named a churned workspace as a paying paused one in a founder report.
    //
    // Here the stale `true` would answer "nothing expires" to the one reader for
    // whom the 30-day clock is genuinely running, two lines above the date it
    // runs out on.
    for (const reason of CANCELLATION_REASON_CODES) {
      for (const plan of ["starter", "pro", null]) {
        expect(offer({ reason, plan, phase: "grace", paused: true })).toEqual(
          offer({ reason, plan, phase: "grace" }),
        );
      }
    }
  });

  it("answers an unpaused workspace exactly what it answered before the pause existed", () => {
    // The flag is optional so that three clients and their hand-ported tests
    // read byte-for-byte what they read before #277. Omitted, false and null are
    // one behaviour, and this is what pins that: an edit that makes the pause
    // branch the default fails on the first reason it touches.
    for (const reason of CANCELLATION_REASON_CODES) {
      for (const plan of ["starter", "pro", null]) {
        for (const phase of ["before", "grace"] as CancellationOfferPhase[]) {
          const base = offer({ reason, plan, phase });
          expect(offer({ reason, plan, phase, paused: false })).toEqual(base);
          expect(offer({ reason, plan, phase, paused: null })).toEqual(base);
        }
      }
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
