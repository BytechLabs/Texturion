/**
 * #446 — the break-even utilisation of each published plan, computed from THIS
 * repo's own numbers so the pricing decision can never drift away from the
 * code it was made about.
 *
 * `docs/PRICING-AUDIT.md` §10 records the decision: the published fair-use
 * ceilings sit ABOVE break-even deliberately. That is a defensible position,
 * but only while somebody knows by how much. These assertions are what make
 * the figures in that document true rather than remembered — change a unit
 * cost, a plan allowance or a plan price and this fails, which is the prompt
 * to re-run the decision (#446 ask 4, the standing dependency on #445 carrier
 * increases and #380 AI cost).
 */
import { describe, expect, it } from "vitest";

import {
  FIXED_MONTHLY_COST_CENTS,
  PLAN_MONTHLY_REVENUE_CENTS,
  UNIT_COST_CENTS,
  stripeNetCents,
} from "./costs";
import {
  PLAN_INCLUDED_SEGMENTS,
  PLAN_VOICE_MINUTES,
  type PlanId,
} from "./plans";

/** Per-tenant fixed cost for a US company: one campaign + its numbers. */
function fixedCents(numbers: number): number {
  return (
    FIXED_MONTHLY_COST_CENTS.us10dlcCampaign +
    FIXED_MONTHLY_COST_CENTS.perNumber * numbers
  );
}

/** What a tenant costs us at the FULL published ceiling of both allowances. */
function costAtCeilingCents(plan: PlanId, numbers: number): number {
  return (
    PLAN_VOICE_MINUTES[plan] * UNIT_COST_CENTS.voiceMinute +
    PLAN_INCLUDED_SEGMENTS[plan] * UNIT_COST_CENTS.outboundSegment +
    fixedCents(numbers)
  );
}

/**
 * Voice minutes at which a tenant stops being profitable, assuming they send
 * NO texts. The most generous reading of break-even, and still well under the
 * published ceiling — which is the whole finding.
 */
function breakEvenVoiceMinutes(plan: PlanId, numbers: number): number {
  const headroom = stripeNetCents(PLAN_MONTHLY_REVENUE_CENTS[plan]) - fixedCents(numbers);
  return Math.floor(headroom / UNIT_COST_CENTS.voiceMinute);
}

describe("#446 — where break-even actually sits", () => {
  it("prices a Starter tenant at the ceiling as a loss", () => {
    const net = stripeNetCents(PLAN_MONTHLY_REVENUE_CENTS.starter);
    const cost = costAtCeilingCents("starter", 1);
    // $27.71 net against $46.85 of cost (#445 raised both segment rates).
    expect(Math.round(net)).toBe(2771);
    expect(cost).toBe(4685);
    expect(Math.round(net - cost)).toBe(-1914);
  });

  it("prices a Pro tenant at the ceiling as a bigger loss", () => {
    const net = stripeNetCents(PLAN_MONTHLY_REVENUE_CENTS.pro);
    const cost = costAtCeilingCents("pro", 2);
    // $76.01 net against $112.95 of cost (#445 raised both segment rates).
    expect(Math.round(net)).toBe(7601);
    expect(cost).toBe(11295);
    expect(Math.round(net - cost)).toBe(-3694);
  });

  it("puts Starter break-even at 1,384 voice minutes with no texts", () => {
    // 55% of the 2,500-minute published ceiling. The figure recorded in
    // PRICING-AUDIT.md §10; if this moves, that decision needs re-reading.
    expect(breakEvenVoiceMinutes("starter", 1)).toBe(1384);
  });

  it("puts Pro break-even at 5,317 voice minutes with no texts", () => {
    // 89% of the 6,000-minute ceiling. Pro is far closer to sustainable than
    // Starter (55%), which inverts the intuition that the bigger plan carries
    // the bigger risk: Starter is the exposed one, because the $10 campaign
    // fee is the same on both and eats a third of its net revenue.
    expect(breakEvenVoiceMinutes("pro", 2)).toBe(5317);
  });

  it("keeps every published ceiling ABOVE its break-even, knowingly", () => {
    // This is the recorded decision, asserted rather than assumed: ceilings
    // are catastrophe limits, not margin limits. If a future change pushes a
    // ceiling BELOW break-even the plan has become self-protecting and §10
    // should be rewritten — either way, deliberately.
    expect(PLAN_VOICE_MINUTES.starter).toBeGreaterThan(
      breakEvenVoiceMinutes("starter", 1),
    );
    expect(PLAN_VOICE_MINUTES.pro).toBeGreaterThan(
      breakEvenVoiceMinutes("pro", 2),
    );
  });

  it("holds the unit costs the decision was made against", () => {
    // #445 landed here: outbound went 0.85c -> 1.15c (MEASURED from Telnyx's
    // own per-message cost in production) and inbound 0.7c -> 1.0c (estimated,
    // now naming all three carriers). This assertion is what caught it — the
    // guard did its job on its first real test. #380 (AI has no term yet) is
    // the remaining one that can move these.
    expect(UNIT_COST_CENTS.voiceMinute).toBe(1.2);
    expect(UNIT_COST_CENTS.outboundSegment).toBe(1.15);
    expect(UNIT_COST_CENTS.inboundSegment).toBe(1.0);
    expect(FIXED_MONTHLY_COST_CENTS.us10dlcCampaign).toBe(1000);
    expect(FIXED_MONTHLY_COST_CENTS.perNumber).toBe(110);
  });
});
