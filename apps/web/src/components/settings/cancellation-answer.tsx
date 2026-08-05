"use client";

import {
  CANCELLATION_GRACE_DAYS,
  cancellationOffer,
  isWithinCancellationGrace,
  numberReleaseAt,
  type CancellationOffer,
} from "@loonext/shared";
import { Info } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ChangePlanDialog } from "@/components/settings/change-plan-dialog";
import { Button } from "@/components/ui/button";
import {
  useCancellationReason,
  useCheckout,
  useDismissWinback,
} from "@/lib/api/billing";
import { ApiError } from "@/lib/api/error";
import type { CompanyView, PlanId } from "@/lib/api/types";

/**
 * #277 follow-up — answering the reason somebody gave for leaving, in the two
 * places they are standing when it is worth hearing.
 *
 * # What is in this file
 *
 *   CancellationAnswer  the note itself: a heading, a body, and at most one
 *                       control. Given a `CancellationOffer` from
 *                       `@loonext/shared`, it renders it and nothing else.
 *   ResubscribeButton   the checkout control, lifted out of the billing page
 *                       so the win-back's "come back on Starter" and the plain
 *                       "Resubscribe" beside it are the SAME button with
 *                       different words, rather than two implementations of
 *                       starting a checkout that can drift apart.
 *   WinbackAnswer       the grace-window surface: reads back what they told us,
 *                       renders the answer, and carries the "No thanks".
 *
 * # The rule that outranks the feature
 *
 * NOTHING HERE MAY MAKE LEAVING COST MORE. `cancel-subscription-card` ships
 * open on all three clients so that somebody who answers nothing reaches Stripe
 * in ONE action, and the offer is rendered AFTER the button that leaves for the
 * same reason — see that file's docblock for the arithmetic. This component
 * adds no dialog, no confirmation and no disabled state to any exit; it is a
 * paragraph with at most one outline button under it.
 *
 * # Why the words are not in this file
 *
 * Every sentence comes from `cancellationOffer`, which reads the price book and
 * the plan limits rather than restating them, and returns NULL for the four
 * cases where we have nothing honest to say. A client that substituted its own
 * copy for a null would be inventing the retention offer the shared module
 * exists to prevent, so this file has no fallback string anywhere in it.
 *
 * # Why it is a note and not a card
 *
 * Same muted, bordered block as `MissedWhileOff` directly above it on this
 * screen. Two supporting facts on one page in one visual language: the cards
 * are the workspace's own state, and these two are things we know that the
 * reader does not. A second SettingsCard here would read as a competing offer.
 */

/**
 * The day this workspace's number goes back to the carrier, or null.
 *
 * THE CLOCK RUNS FROM `canceled_at`, NOT FROM THE PERIOD END. `runGraceJob`
 * measures `now - canceled_at` and releases at 30, and the Stripe webhook
 * stamps `canceled_at` from Stripe's own `subscription.canceled_at` — the
 * moment cancelling was REQUESTED. On a cancel-at-period-end that can be most
 * of a month before texting even stops, so the sentence this replaces ("we hold
 * your number for 30 days after your last period") named a LATER date than the
 * one the number actually dies on. Wrong in the customer's favour about a
 * deadline is the expensive direction to be wrong in.
 *
 * UTC, matching `OffRampCard` on this same screen and `releaseDateLabel` in
 * grace.ts, which prints this same date into the day-27 email. The grace clock
 * is computed in UTC; formatting in the reader's zone would show a date a day
 * either side of the one the job acts on, and three surfaces disagreeing about
 * when somebody loses their business number is worse than no date at all.
 *
 * WITH THE YEAR, for the same reason the email carries one. `releaseDateLabel`
 * prints "August 4, 2026" into the day-27 mail and links straight here, and a
 * screen that answers "4 August" is a second, vaguer answer to the question the
 * mail just raised. The branch that actually needs it is the EXPIRED one: that
 * sentence is read by definition after the deadline has gone by, on a workspace
 * that may have been sitting cancelled for a year, and a yearless date there is
 * not a date — it is a date-shaped thing the reader has to guess the year of.
 */
function releaseDay(canceledAt: string | null): string | null {
  const release = numberReleaseAt(canceledAt);
  return release
    ? release.toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;
}

/**
 * What is true about the number, on a workspace that has already left.
 *
 * Three states, because the hold really has three and the single sentence this
 * replaces covered one:
 *
 *   inside the hold   the date it goes, which is the only actionable fact on
 *                     this card.
 *   past the hold     the hold ENDED. Deliberately not "your number has been
 *                     released": this branch flips on the READER'S clock at
 *                     `canceled_at + 30d`, while the release runs on a
 *                     once-daily cron (`0 14 * * *`) that can fail and retry.
 *                     For up to a day the two disagree, and in that window the
 *                     old number is still recoverable — `handleCheckoutCompleted`
 *                     un-suspends every `suspended` row, so a resubscribe hands
 *                     the same number straight back. So nothing here may claim
 *                     an outcome only the cron can produce: not that the carrier
 *                     has it, and not that resubscribing WILL issue a new
 *                     number. What is true at exactly that boundary is that the
 *                     hold is over and we are no longer keeping the number for
 *                     them, which is also the only part they can act on. Once
 *                     the release really has happened, `releasedCopy` in grace.ts
 *                     says so by email, from the job that did it.
 *   no `canceled_at`  the general rule, with no date invented to fill the gap.
 */
export function HoldSentence({ company }: { company: CompanyView }) {
  const day = releaseDay(company.canceled_at);

  if (day === null) {
    return (
      <p className="text-sm">
        We hold your number for {CANCELLATION_GRACE_DAYS} days from the day you
        cancel. Resubscribe before then and everything picks up where it left
        off.
      </p>
    );
  }

  if (!isWithinCancellationGrace(company.canceled_at)) {
    return (
      <p className="text-sm">
        The {CANCELLATION_GRACE_DAYS}-day hold on your number ended on{" "}
        <span className="font-medium">{day}</span>. We are not keeping it for
        you any more, so plan on a new number if you resubscribe — your message
        history is still here either way.
      </p>
    );
  }

  return (
    <p className="text-sm">
      We hold your number until <span className="font-medium">{day}</span>.
      Resubscribe before then and everything picks up where it left off.
    </p>
  );
}

/**
 * The control named by `offer.action`.
 *
 * The mapping is the contract, and it lives in ONE place because both surfaces
 * need it and the actions differ per phase: `change_plan` only ever comes back
 * while the subscription is live, `resubscribe_starter` only after it has
 * ended. Each arm reuses the control that already exists on the billing screen
 * rather than building a second one.
 *
 * An unrecognised action renders NOTHING rather than guessing. If a later
 * shared build adds a fourth code, this client shows the words without a
 * button, which is a quiet degradation; a fallback control would be a button
 * that does something other than what its label says.
 */
function OfferControl({
  offer,
  company,
}: {
  offer: CancellationOffer;
  company: CompanyView;
}) {
  const { action, actionLabel } = offer;

  // The plan switcher already on this screen. Its trigger reads "Switch to
  // Starter" for a Pro workspace, which is the shared `actionLabel` — pinned by
  // a test, because two places typing the same words is how they stop matching.
  if (action === "change_plan") return <ChangePlanDialog company={company} />;

  // STARTER, not `company.plan`. They left because Pro was too expensive; the
  // one control that answers that must not put them back on Pro.
  if (action === "resubscribe_starter") {
    return (
      <ResubscribeButton
        plan="starter"
        label={actionLabel ?? "Resubscribe"}
        variant="outline"
      />
    );
  }

  if (action === "open_help") {
    return (
      <Button variant="outline" asChild>
        <Link href="/settings/help">{actionLabel}</Link>
      </Button>
    );
  }

  // null: the words are the whole answer. The seasonal offer is deliberately
  // like this — there is no pause to buy and nothing to press.
  return null;
}

/**
 * The block every answer on this screen is drawn as: an icon, a heading, a body,
 * and at most one row of controls.
 *
 * Exported because #277's paid pause answers the seasonal reason in the SAME
 * place, in place of the offer below, and it has to be the same object visually
 * — the reader is looking at one answer to one question they just gave, and two
 * slightly different bordered notes in that slot would read as two competing
 * things. It is a layout and nothing else: no words, no controls, no decision
 * about when to appear. See `pause-plan.tsx` for the other caller.
 *
 * Muted and bordered, matching `MissedWhileOff` further up the same screen —
 * the cards are the workspace's own state, and these are things we know that the
 * reader does not. A SettingsCard here would read as a competing offer.
 */
export function AnswerNote({
  heading,
  body,
  children,
}: {
  heading: string;
  body: string;
  /** The control row, or null when the words are the whole answer. */
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
      <div className="flex items-start gap-3">
        <Info
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
        {/* Heading and body are one thought, so they sit tight; the control is
            a separate move, so it gets the wider gap. */}
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">{heading}</p>
            <p className="text-sm text-muted-foreground">{body}</p>
          </div>
          {children && (
            <div className="flex flex-wrap items-center gap-2">{children}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One offer, rendered. `children` is for controls the surface owns rather than
 * the offer (today: the win-back's "No thanks"), so they sit on the same row as
 * the action instead of below it.
 */
export function CancellationAnswer({
  offer,
  company,
  children,
}: {
  offer: CancellationOffer;
  company: CompanyView;
  children?: React.ReactNode;
}) {
  const controls = offer.action !== null || Boolean(children);
  return (
    <AnswerNote heading={offer.heading} body={offer.body}>
      {controls ? (
        <>
          <OfferControl offer={offer} company={company} />
          {children}
        </>
      ) : null}
    </AnswerNote>
  );
}

/**
 * Start a checkout for `plan`.
 *
 * `variant` exists so the win-back's control can be an outline beside the
 * card's own primary Resubscribe. The louder button stays the neutral one —
 * "come back on exactly what you had" — because making the cheaper plan the
 * prominent choice would be steering somebody who has already left.
 */
export function ResubscribeButton({
  plan,
  label = "Resubscribe",
  variant = "default",
}: {
  plan: PlanId;
  label?: string;
  variant?: "default" | "outline";
}) {
  const checkout = useCheckout();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        variant={variant}
        disabled={checkout.isPending}
        onClick={() => {
          setError(null);
          checkout.mutate(plan, {
            onSuccess: ({ url }) => window.location.assign(url),
            onError: (cause) =>
              setError(
                cause instanceof ApiError
                  ? cause.message
                  : "Couldn't start checkout. Try again.",
              ),
          });
        }}
      >
        {checkout.isPending ? "Opening…" : label}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The same answer again, while the number can still be saved.
 *
 * # Why here and not in the mail
 *
 * The day 1/15/27 grace emails already point at this screen, so it receives
 * win-back traffic on a cadence and had nothing to say when they arrived. It
 * stays IN THE APP for reasons that are legal rather than tasteful:
 * `MAILING_ADDRESS` is null in `business-identity.ts` and our one commercial
 * sender refuses on that basis; the grace emails ride the critical reputation
 * stream and carry no unsubscribe by design; and the only opt-out list is
 * global, so declining a win-back by email would also silence that workspace's
 * payment-failure and security mail. A card is not an electronic message and
 * carries none of that.
 *
 * # Why not in OffRampCard
 *
 * That card's docblock forbids persuasion in as many words — "a screen that
 * argues with them about leaving... is the last thing they will remember about
 * us" — and it is right. This sits in the Subscription card beside Resubscribe,
 * which is the control it is about.
 *
 * # The three gates, in the order they cost something
 *
 *   1. dismissed        a press this session, or a stored stamp NEWER than this
 *                       cancellation. The comparison is what makes the
 *                       dismissal belong to ONE cancellation: somebody who
 *                       waves this away, comes back, and leaves again a year
 *                       later gets it again, because the second `canceled_at`
 *                       is newer than the stamp. Nothing has to clear it.
 *   2. within grace     past the release the number is back in carrier
 *                       inventory and reassignable to another business (#413),
 *                       so "come back and keep your number" stops being true at
 *                       exactly that boundary.
 *   3. a stated reason  the query is `enabled` on gates 1 and 2 having passed,
 *                       so a healthy workspace never asks and a dismissed one
 *                       stops asking.
 *
 * `winback_dismissed_at` is a `billing.manage`-only field and is ABSENT rather
 * than null for anybody else, which is why it is read as optional — and why the
 * caller renders this only for a member who can manage billing at all.
 *
 * A FAILED DISMISSAL IS SILENT, and the card hides anyway. There is no error
 * box on a wind-down screen for a preference: the worst case is that it
 * reappears on the next visit, which is strictly better than an alert telling
 * somebody who is leaving that our server would not take their "no thanks".
 */
export function WinbackAnswer({ company }: { company: CompanyView }) {
  const [dismissedNow, setDismissedNow] = useState(false);
  const dismiss = useDismissWinback();

  const canceledAt = company.canceled_at;
  const dismissedAt = company.winback_dismissed_at ?? null;
  // Newer than THIS cancellation, so a stamp left over from a previous one
  // suppresses nothing.
  const dismissedBefore =
    canceledAt !== null &&
    dismissedAt !== null &&
    Date.parse(dismissedAt) >= Date.parse(canceledAt);

  const open =
    !dismissedNow && !dismissedBefore && isWithinCancellationGrace(canceledAt);

  const stated = useCancellationReason(open);

  // No skeleton and no error state, for the reason `MissedWhileOff` gives: this
  // is a supporting note on somebody else's screen, and a broken box where a
  // sentence should be makes the billing itself look broken.
  if (!open || !stated.data) return null;

  const offer = cancellationOffer({
    reason: stated.data.reason,
    plan: company.plan,
    phase: "grace",
    billingCurrency: company.billing_currency,
    country: company.country,
    registrationFeePaidAt: company.registration_fee_paid_at,
  });
  // Null is a real answer: they said "switched", or "not using it", or they are
  // already on the cheapest plan. Nothing honest to add, so nothing is added.
  if (!offer) return null;

  return (
    <CancellationAnswer offer={offer} company={company}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          // Hidden first, sent second — the same order the cancel card uses for
          // the reason. A press must never wait on a round trip.
          setDismissedNow(true);
          dismiss.mutate();
        }}
      >
        No thanks
      </Button>
    </CancellationAnswer>
  );
}
