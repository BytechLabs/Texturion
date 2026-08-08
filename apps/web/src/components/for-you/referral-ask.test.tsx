/**
 * #288 — the ask appears after demonstrated value, never at signup.
 *
 * That sentence is an acceptance criterion, and the only way it can be broken on
 * this client is by rendering the card when the server said not to, or by
 * rendering it for somebody who could never collect the reward. Both are asserted
 * here rather than reasoned about.
 */
import { REFERRAL_ASK_DISMISS, referralAskHeadline } from "@loonext/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReferralMomentView, ReferralsView } from "@/lib/api/billing";

const state = vi.hoisted(() => ({
  role: "owner" as string,
  moment: undefined as ReferralMomentView | undefined,
  momentEnabled: undefined as boolean | undefined,
  referrals: undefined as ReferralsView | undefined,
}));

vi.mock("@/lib/api/billing", () => ({
  useReferralMoment: (enabled: boolean) => {
    state.momentEnabled = enabled;
    return { data: enabled ? state.moment : undefined };
  },
  useReferrals: () => ({ data: state.referrals }),
  useDismissReferralAsk: () => ({ mutate: () => undefined }),
}));

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: state.role }),
}));

const { ReferralAsk } = await import("./referral-ask");

function render(): string {
  return renderToStaticMarkup(<ReferralAsk />);
}

beforeEach(() => {
  state.role = "owner";
  state.moment = { ask: true, customers: 37 };
  state.momentEnabled = undefined;
  state.referrals = undefined;
});

describe("#288 ReferralAsk", () => {
  it("leads with the owner's own number, before asking for anything", () => {
    // Reciprocity: a fact about their business is handed over first. The number
    // is also the evidence that the moment was earned, so it is not decoration.
    const html = render();
    expect(html).toContain(referralAskHeadline(37));
  });

  it("renders nothing when the server says this is not the moment", () => {
    state.moment = { ask: false, refusal: "not_activated" };
    expect(render()).toBe("");
  });

  it("renders nothing while the moment is still unknown", () => {
    // Not a skeleton. This is a favour being asked on somebody's working screen;
    // if we cannot tell whether it is the right moment, silence is the answer.
    state.moment = undefined;
    expect(render()).toBe("");
  });

  it("is not shown to a member who could never collect the reward", () => {
    // And the query is not even enabled for them: the whole referrals router is
    // behind billing.manage, so asking would 403 on every dashboard load.
    state.role = "member";
    expect(render()).toBe("");
    expect(state.momentEnabled).toBe(false);
  });

  it("does ask the bookkeeper, who holds the invoice", () => {
    // #315 made roles capability sets rather than ranks, and billing.manage is
    // the capability that decides this — not "is this person the owner".
    state.role = "bookkeeper";
    expect(render()).toContain(referralAskHeadline(37));
  });

  it("offers a way out of equal weight to the ask", () => {
    expect(render()).toContain(REFERRAL_ASK_DISMISS);
  });

  it("does not fetch the link until somebody says yes to being asked", () => {
    // The share draft needs the code; most dashboard loads will never open it,
    // and a second request per load for a card nobody pressed is waste.
    state.referrals = {
      code: "ABCD2345",
      link: "https://loonext.com/?ref=ABCD2345",
      referrals: [],
      rewarded_this_year: 0,
      reward_cap_per_year: 12,
    };
    expect(render()).not.toContain("ABCD2345");
  });

  it("survives a missing customer count rather than saying 'undefined'", () => {
    state.moment = { ask: true };
    expect(render()).toContain(referralAskHeadline(0));
  });
});
