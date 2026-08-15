"use client";

import {
  REFERRAL_ASK_ACTION,
  REFERRAL_ASK_BODY,
  REFERRAL_ASK_DISMISS,
  referralAskHeadline,
  roleHasCapability,
} from "@loonext/shared";
import { Users } from "lucide-react";
import { useState } from "react";

import { ReferralShare } from "@/components/settings/referral-share";
import { Button } from "@/components/ui/button";
import { sayWith, useT } from "@/i18n/provider";
import {
  useDismissReferralAsk,
  useReferralMoment,
  useReferrals,
} from "@/lib/api/billing";
import { useActiveCompany } from "@/lib/company/provider";

/**
 * #288 — the ask, at the moment it has been earned.
 *
 * # Evaluation
 *
 * The referral link existed and lived in Settings > Billing, which means in
 * practice an owner met it once — while poking around the billing screen on the
 * day they signed up — and never again. #288 names both halves of that as the
 * mistake: "obvious placement at a moment of demonstrated satisfaction rather
 * than buried in settings", and "asking at signup is asking someone to vouch for
 * something they have not used, which costs credibility and converts badly".
 *
 * # What makes this a moment rather than a banner
 *
 * The server will not say yes until the product has demonstrably worked: D12
 * activation, a month of it working, and twenty customers replied to in the last
 * thirty days. `referralAskDecision` in packages/shared holds those rules so this
 * card, the Android one and the iOS one cannot disagree about when an owner gets
 * asked for a favour.
 *
 * # Why it opens with their number and not with our ask
 *
 * *Applying: Meaningful Highlights & Context, and Reciprocity.* "You replied to
 * 37 customers this month" is a fact about their business, handed over before
 * anything is requested of them. That ordering is the whole difference between a
 * prompt that reads as earned and one that reads as a pop-up — and #288's own
 * devil's advocate is about exactly this failure: "the ask reads as needy and the
 * incentive as a bribe".
 *
 * *Applying: Ethical Friction, inverted.* "Not now" is a plain button of the same
 * weight as the primary, not a greyed-out afterthought or an X in a corner. A
 * card asking for a favour has no business making no hard to find, and the server
 * holds that answer for a quarter.
 *
 * # Why it is not one of the Customise-able panels
 *
 * It already has a dismissal, and a prompt with two ways to put it away is a
 * prompt where one of them stops being honoured. This is a one-time ask that
 * removes itself, not furniture somebody has to arrange.
 */
export function ReferralAsk() {
  const t = useT();
  // #228: the shared referral copy names keys, so this says them in the
  // reader's language.
  const say = sayWith(t);
  const { role } = useActiveCompany();
  // The reward is a month off the invoice. A tech cannot see the invoice, so an
  // offer of one is an offer we have no way to keep — and the endpoint is behind
  // the same gate, so asking anyway would be a 403 on every dashboard load.
  const canCollect = roleHasCapability(role, "billing.manage");
  const moment = useReferralMoment(canCollect);
  const [opened, setOpened] = useState(false);
  // Only once they have said yes to being asked: the link is a second request,
  // and most dashboard loads will never need it.
  const referrals = useReferrals(opened);
  const dismiss = useDismissReferralAsk();

  // Never a skeleton and never an error box. This card is a favour being asked
  // on somebody else's working screen; if we cannot tell whether it is the right
  // moment, the right answer is silence.
  if (!canCollect || !moment.data?.ask) return null;

  const customers = moment.data.customers ?? 0;

  return (
    <section className="rounded-[14px] border border-app-line bg-app-paper p-4">
      <div className="flex items-start gap-3">
        <Users
          className="mt-0.5 size-4 shrink-0 text-app-muted-2"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          {/* Their number, in the largest type on the card. */}
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-app-ink">
            {referralAskHeadline(customers, say)}
          </h2>
          <p className="mt-1 text-[13px] leading-[1.45] text-app-muted">
            {say(REFERRAL_ASK_BODY)}
          </p>

          {opened ? (
            referrals.data ? (
              <div className="mt-3">
                <ReferralShare
                  link={referrals.data.link}
                  code={referrals.data.code}
                />
              </div>
            ) : (
              // The one place a wait is worth showing: they pressed a button and
              // are owed an answer about it.
              <p className="mt-3 text-[13px] text-app-muted">
                {t("inbox.referralGettingLink")}
              </p>
            )
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setOpened(true)}>
                {say(REFERRAL_ASK_ACTION)}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => dismiss.mutate()}
              >
                {say(REFERRAL_ASK_DISMISS)}
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
