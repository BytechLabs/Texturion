"use client";

import {
  formatMoney,
  PLAN_PRICE_CENTS,
  REFERRAL_REWARD_LINE,
  REFERRAL_STAGE_LABELS,
  type BillingCurrency,
} from "@loonext/shared";
import { Users } from "lucide-react";

import { ReferralShare } from "@/components/settings/referral-share";
import { SettingsCard } from "@/components/settings/section";
import { useT } from "@/i18n/provider";
import { useReferrals } from "@/lib/api/billing";
import { type PlanId } from "@/lib/api/types";

/**
 * #399 — the referral link, and what it has done.
 *
 * # The product still does not distribute anything
 *
 * #399 is explicit that an "invite your contacts" flow would be the mass-texting
 * D4 and D11 exclude — it would turn a crew's consented customer list into an
 * acquisition funnel, and the AUP forbids exactly that.
 *
 * #288 asked for "one tap, a pre-written message they can edit, sent from the
 * phone they are already holding", and {@link ReferralShare} is that without
 * crossing the line: the draft goes to the OS share sheet, which is the owner's
 * own Messages app on their own number, and they pick the recipient. We supply
 * the words and never the distribution. What replaced the lone Copy button was
 * the covering sentence somebody otherwise had to compose themselves — not a
 * send path.
 *
 * # Why the list is here at all
 *
 * #399 asks for it directly: "a referral programme nobody can see the results
 * of gets used once." Four states, from the shared `referralStage` so this
 * screen and the server agree what "active" means: invited, signed up, still
 * active at thirty days, rewarded.
 *
 * The empty state says nothing has happened yet rather than hiding — a card
 * that vanishes when there are no referrals is a card nobody learns exists.
 *
 * Applying: Zen of Clarity (one primary action and one fallback), Chunking (four named
 * states rather than a raw table), and the local rule that no paying-customer
 * surface quotes a hand-typed price — the free month comes from the shared
 * price book.
 *
 * #522: and it comes out of that book at the workspace's own currency. The
 * reward IS a month of this workspace's plan, so the figure naming it has to be
 * the figure on this workspace's invoice. Quoting the US price to a Canadian
 * owner overstated the reward by nothing they would ever receive, on a card
 * asking them to go and vouch for us to another business.
 */


export function ReferralCard({
  plan,
  currency,
  show,
}: {
  plan: PlanId;
  /**
   * What this workspace is billed in, resolved by the caller — which has the
   * company loaded and is where `billingCurrencyOf` belongs. Taking a settled
   * `BillingCurrency` rather than the raw column keeps this card from being a
   * second place that decides what an unrecognised value means.
   */
  currency: BillingCurrency;
  show: boolean;
}) {
  const t = useT();
  const referrals = useReferrals(show);

  // Never a skeleton and never an error box: this is an offer on somebody
  // else's screen, and a settings page showing a broken panel looks like the
  // settings are broken. Same rule the other conditional cards here follow.
  if (!show || !referrals.data) return null;

  const { code, link, referrals: rows, rewarded_this_year: rewarded } =
    referrals.data;
  // Bare "$" for their own money: `formatMoney` keeps the "US$"/"CA$" prefix
  // for a price quoted to somebody who thinks in the other currency.
  const monthly = formatMoney(PLAN_PRICE_CENTS[currency][plan], currency);

  return (
    <SettingsCard title={t("settingsMore.referralTitle")}>
      <div className="flex items-start gap-3">
        <Users
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-4">
          {/* #288: the reward line comes from the shared module, and it says
              what the payout actually waits for. It used to say "send their
              first text", which was the OLD rule — the reward now needs D12
              activation, so a customer has to text them back. A reward line
              naming the wrong condition is worse than a vague one: the referrer
              watches their friend send a text and concludes we did not pay. */}
          <p className="text-sm text-muted-foreground">
            {REFERRAL_REWARD_LINE}{" "}
            {t("settingsMore.referralRewardEach", { amount: monthly })}
          </p>

          {/* #288: the draft and the share sheet, from the one component the
              dashboard ask also uses. Two copies of a message that has to read
              identically wherever an owner finds it is how one of them drifts. */}
          <ReferralShare link={link} code={code} />

          {rows.length === 0 ? (
            // Said rather than hidden: a card that disappears when there is
            // nothing to show is a card nobody learns exists.
            <p className="text-sm text-muted-foreground">
              {t("settingsMore.referralNobodyYet")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="text-muted-foreground">
                    {REFERRAL_STAGE_LABELS[row.stage]}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {new Date(row.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {rewarded > 0 && (
            <p className="text-sm font-medium text-foreground">
              {rewarded === 1
                ? t("settingsMore.referralMonthsEarnedOne", { count: rewarded })
                : t("settingsMore.referralMonthsEarnedMany", {
                    count: rewarded,
                  })}
            </p>
          )}
        </div>
      </div>
    </SettingsCard>
  );
}
