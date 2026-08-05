"use client";

import {
  formatMoney,
  PLAN_PRICE_CENTS,
  type BillingCurrency,
} from "@loonext/shared";
import { Check, Copy, Users } from "lucide-react";
import { useState } from "react";

import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { useReferrals, type ReferralStage } from "@/lib/api/billing";
import { type PlanId } from "@/lib/api/types";

/**
 * #399 — the referral link, and what it has done.
 *
 * # There is one action on this card, and it is Copy
 *
 * That is not minimalism, it is the design constraint. #399 is explicit that an
 * "invite your contacts" flow would be the mass-texting D4 and D11 exclude — it
 * would turn a crew's consented customer list into an acquisition funnel, and
 * the AUP forbids exactly that. So the product hands over a link and stops. The
 * owner sends it by WhatsApp, from their own phone, or across a supply counter,
 * and none of that is ours to mediate.
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
 * Applying: Zen of Clarity (one action, one number), Chunking (four named
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

const STAGE_LABEL: Record<ReferralStage, string> = {
  invited: "Signed up, not texting yet",
  signed_up: "Texting now",
  active: "Still going after 30 days",
  rewarded: "Free month applied",
  voided: "Not counted",
};

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
  const referrals = useReferrals(show);
  const [copied, setCopied] = useState(false);

  // Never a skeleton and never an error box: this is an offer on somebody
  // else's screen, and a settings page showing a broken panel looks like the
  // settings are broken. Same rule the other conditional cards here follow.
  if (!show || !referrals.data) return null;

  const { code, link, referrals: rows, rewarded_this_year: rewarded } =
    referrals.data;
  // Bare "$" for their own money: `formatMoney` keeps the "US$"/"CA$" prefix
  // for a price quoted to somebody who thinks in the other currency.
  const monthly = formatMoney(PLAN_PRICE_CENTS[currency][plan], currency);
  const shareable = link ?? code;

  return (
    <SettingsCard title="Refer another crew">
      <div className="flex items-start gap-3">
        <Users
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-4">
          <p className="text-sm text-muted-foreground">
            Send this to another business. When they sign up and send their
            first text, you both get a month free — {monthly} each.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted/40 px-3 py-2 font-mono text-sm text-foreground">
              {shareable}
            </code>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(shareable).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? (
                <Check strokeWidth={1.75} aria-hidden />
              ) : (
                <Copy strokeWidth={1.75} aria-hidden />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          {rows.length === 0 ? (
            // Said rather than hidden: a card that disappears when there is
            // nothing to show is a card nobody learns exists.
            <p className="text-sm text-muted-foreground">
              Nobody has used your link yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="text-muted-foreground">
                    {STAGE_LABEL[row.stage]}
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
              {rewarded} free {rewarded === 1 ? "month" : "months"} earned so
              far.
            </p>
          )}
        </div>
      </div>
    </SettingsCard>
  );
}
