import { PLAN_PRICING } from "@/lib/api/types";

/**
 * #370 — the per-seat gap is not a fixed discount. It widens with every person
 * the customer hires, and until now no page said so.
 *
 * The comparison pages already state one snapshot: three people, sourced and
 * dated. That is the right number for one crew and it hides the structure. Every
 * competitor priced in `docs/marketing/competitor-site-teardowns.md` bills per
 * seat; we bill per workspace. So the arithmetic does not shift by a constant as
 * the crew grows, it diverges — and D12's ICP is 1–10 field staff, which means
 * the half of our own market where we win by the largest margin is the half
 * nothing was addressing.
 *
 * # Everything here is DERIVED, and that is the point
 *
 * The per-seat rate and the seat minimum are the only competitor inputs. Every
 * figure on the page is computed from them, so re-verifying a price moves all
 * three crew sizes at once. A hand-typed "$490 at ten people" is a number that
 * silently stops being true the day they change their rate — and a wrong claim
 * about somebody else's price is the kind that gets expensive rather than merely
 * wrong, which is why `verification.ts` already dates the ledgers and fails a
 * test when they go stale.
 *
 * Our side comes from PLAN_PRICING for the same reason: it is the table every
 * other price in the product traces to.
 *
 * # What this deliberately does NOT claim
 *
 * Only the seat line. The competitor's real bill also carries per-segment
 * charges and campaign fees, which the ledger states separately and which this
 * would misrepresent by folding in. Comparing the one component that is
 * structurally different is honest; rolling everything into a single scary
 * number is not, and it would also be easy to rebut.
 */

/** A competitor's seat pricing, as verified on the ledger's own date. */
export interface SeatPricing {
  name: string;
  /** Monthly price per user, in whole dollars, on their cheapest published tier. */
  perUserDollars: number;
  /**
   * The fewest seats they will sell. Heymarket's two-user minimum is why a solo
   * operator cannot buy their entry price at all, which is invisible in a
   * three-person comparison.
   */
  minimumSeats: number;
}

/** Which of our plans covers a crew of this size, and what it costs. */
export function loonextForCrew(people: number): {
  plan: "starter" | "pro";
  dollars: number;
} {
  const starterSeats = PLAN_PRICING.starter.seats;
  return people <= starterSeats
    ? { plan: "starter", dollars: PLAN_PRICING.starter.monthlyDollars }
    : { plan: "pro", dollars: PLAN_PRICING.pro.monthlyDollars };
}

/** What a competitor's seats alone cost for a crew of this size. */
export function competitorSeatsForCrew(
  pricing: SeatPricing,
  people: number,
): number {
  // The minimum is a floor, not a discount: a solo operator still pays for two.
  return pricing.perUserDollars * Math.max(people, pricing.minimumSeats);
}

export interface CrewComparisonRow {
  people: number;
  loonextDollars: number;
  loonextPlan: "starter" | "pro";
  competitorDollars: number;
  /** How many times their seat line is ours. One decimal; never rounded up. */
  multiple: number;
}

/**
 * The crew sizes worth showing: one, three, ten.
 *
 * One and ten are the ends of D12's stated ICP, and three is where our own
 * Starter seat limit sits — so the row set covers the whole market we claim and
 * shows the plan change honestly rather than pretending one price covers
 * everything.
 *
 * Deliberately stops at ten. The advantage keeps widening past that and the
 * product does not: Pro's seat limit is fifteen and #244's on-call routing does
 * not exist, so ring-all across a larger crew is a worse experience. Advertising
 * a number we serve worse would be selling the wrong thing well.
 */
export const CREW_SIZES = [1, 3, 10] as const;

export function crewComparison(pricing: SeatPricing): CrewComparisonRow[] {
  return CREW_SIZES.map((people) => {
    const ours = loonextForCrew(people);
    const theirs = competitorSeatsForCrew(pricing, people);
    return {
      people,
      loonextDollars: ours.dollars,
      loonextPlan: ours.plan,
      competitorDollars: theirs,
      // Floored to one decimal so the claim is never larger than the truth.
      multiple: Math.floor((theirs / ours.dollars) * 10) / 10,
    };
  });
}
