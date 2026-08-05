import Link from "next/link";

import type { NumberHoldState } from "@/components/settings/number-hold";
import { cn } from "@/lib/utils";

/**
 * #523 — the sentence a suspended number gets, wherever it is drawn.
 *
 * # Why this is a component and not three lines inside `NumberCard`
 *
 * Settings → Numbers draws a suspended number on TWO surfaces. A bought number
 * gets a `NumberCard`; a number that was TRANSFERRED in is de-duplicated out of
 * that list and drawn only by its port stepper (`PortCard`), which until now had
 * no idea a hold existed and went on saying "Live on Loonext" over a line that
 * cannot send. Both surfaces now say the same thing, out of one file, because
 * the alternative is two hand-kept copies of a sentence whose whole job is to be
 * exactly true — and the version that drifts is always the one on the surface
 * nobody tests, which is precisely how the ported case went unsaid for so long.
 *
 * # The three answers, and why the third exists
 *
 * `numberHoldState` decides which applies; see that file for why the "we don't
 * know" branch asserts no cause rather than guessing one. The short version is
 * that the old copy guessed, and its guess — "update your payment method" —
 * sends a workspace whose card is working to a Stripe portal that cannot fix an
 * allowance.
 *
 * # Who the billing link is offered to
 *
 * Everybody who can see it, which on web is only owner and admin: `/settings`
 * is gated section-by-section (#515) and Numbers needs `numbers.manage`, a
 * capability no role holds without `billing.manage`. So unlike Android and iOS
 * — which show the numbers screen to every role and therefore branch on
 * `canManageBilling` before naming Billing — this link can never be offered to
 * somebody who would hit the refusal page. `number-card.hold.test.tsx` pins that
 * relationship rather than trusting it, because it is a property of the shared
 * capability table and not of this file.
 */
export function NumberHoldNote({
  hold,
  className,
}: {
  /** Null/undefined from a caller that never resolved one — see below. */
  hold: NumberHoldState | null | undefined;
  className?: string;
}) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      {hold?.kind === "over_allowance" ? (
        <>
          On hold —{" "}
          {hold.allowance === null
            ? "your plan covers fewer numbers than you have"
            : `your plan covers ${hold.allowance} ${hold.allowance === 1 ? "number" : "numbers"} and you have more`}
          . Texts and calls still come through and nothing has been given up; you
          just can&apos;t send or answer from it.{" "}
          <Link
            href="/settings/billing"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            See how to bring it back
          </Link>
          .
        </>
      ) : hold?.kind === "subscription_inactive" ? (
        <>
          Texting is paused.{" "}
          <Link
            href="/settings/billing"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Update your payment method
          </Link>{" "}
          to turn it back on.
        </>
      ) : (
        // Suspended on a live subscription, and this reader could not ask why
        // (the billing route is behind `billing.manage`, and the read can also
        // simply have failed). Naming a cause here would be a guess, and the
        // guess that used to live here sent people to fix a card that was
        // working. A caller that has not been taught the difference lands here
        // too, for the same reason: no answer beats the wrong one.
        <>
          Texting is paused on this number.{" "}
          <Link
            href="/settings/billing"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Check billing
          </Link>{" "}
          to see why.
        </>
      )}
    </p>
  );
}
