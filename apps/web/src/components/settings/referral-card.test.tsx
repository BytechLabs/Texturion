/**
 * #522 — the free month the referral card promises, in the money it is worth.
 *
 * Unlike the prepaid year beside it, this figure IS currency-observable: the
 * reward is a month of this workspace's plan, and a CAD month and a USD month
 * are different amounts out of the same price book. So a hardcoded dollar sign
 * cannot satisfy these — "$109" and "$79" are not the same string, and only one
 * of them is what a Canadian owner's invoice will stop showing.
 */
import { PLAN_PRICE_CENTS, formatMoney } from "@loonext/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ReferralsView } from "@/lib/api/billing";
import type { PlanId } from "@/lib/api/types";

const referrals = vi.hoisted(() => ({
  data: undefined as ReferralsView | undefined,
}));

vi.mock("@/lib/api/billing", () => ({ useReferrals: () => referrals }));

const { ReferralCard } = await import("./referral-card");

function render(plan: PlanId, currency: "usd" | "cad"): string {
  referrals.data = {
    code: "CREW-4821",
    link: "https://loonext.com/r/CREW-4821",
    referrals: [],
    rewarded_this_year: 0,
    reward_cap_per_year: 3,
  };
  return renderToStaticMarkup(
    <ReferralCard plan={plan} currency={currency} show />,
  );
}

describe("#522 ReferralCard reward figure", () => {
  it("quotes a Canadian workspace its own month, not the US one", () => {
    // The shipped defect: "a month free — $79 each" on a workspace whose month
    // is CA$109. It overstated nothing the owner would ever receive, on the one
    // card asking them to go and vouch for us to another business.
    const html = render("pro", "cad");
    expect(html).toContain(`${formatMoney(PLAN_PRICE_CENTS.cad.pro, "cad")} each`);
    expect(html).not.toContain(formatMoney(PLAN_PRICE_CENTS.usd.pro, "usd"));
  });

  it("still quotes a US workspace the US month", () => {
    const html = render("starter", "usd");
    expect(html).toContain(
      `${formatMoney(PLAN_PRICE_CENTS.usd.starter, "usd")} each`,
    );
    expect(html).not.toContain(formatMoney(PLAN_PRICE_CENTS.cad.starter, "cad"));
  });

  it("reads the figure off the plan being rewarded, not a fixed one", () => {
    // Starter and Pro are rewarded with their own month. A single constant
    // satisfying both would have to be two different numbers at once.
    expect(render("starter", "cad")).toContain(
      `${formatMoney(PLAN_PRICE_CENTS.cad.starter, "cad")} each`,
    );
    expect(render("pro", "usd")).toContain(
      `${formatMoney(PLAN_PRICE_CENTS.usd.pro, "usd")} each`,
    );
  });

  it("prints no currency prefix on the reader's own money", () => {
    // `formatMoney` reserves "CA$"/"US$" for a price quoted to somebody who
    // thinks in the other currency. To a Canadian, "CA$109" reads as though we
    // expect them to be confused about their own money.
    expect(render("pro", "cad")).not.toContain("CA$");
    expect(render("starter", "usd")).not.toContain("US$");
  });
});
