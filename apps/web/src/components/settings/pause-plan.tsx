"use client";

import { PauseCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PLAN_FACTS } from "@/app/(app)/settings/billing/plan-facts";
import { AnswerNote } from "@/components/settings/cancellation-answer";
import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { usePauseOffer, usePausePlan, useResumePlan } from "@/lib/api/billing";
import { ApiError } from "@/lib/api/error";
import type { CompanyView } from "@/lib/api/types";

/**
 * #277 — the paid pause, on the web billing screen.
 *
 * # What the feature is
 *
 * A trades crew going quiet for the winter keeps its number and its history,
 * stops texting, and pays a small monthly fee instead of the plan. There is no
 * 30-day fuse on it: they resume in spring with everything where they left it.
 * It exists because the only other way to stop paying is to cancel, and
 * cancelling starts an irreversible clock on the number printed on the side of
 * their van.
 *
 * # What is in this file
 *
 *   pauseQueryEnabled    the one gate both callers of `usePauseOffer` ask.
 *   SeasonalPauseAnswer  the offer, in the slot the cancel card already uses for
 *                        its per-reason answer. Rendered INSTEAD of the shared
 *                        `seasonal` offer, and only when the API says eligible.
 *   PausedPlanCard       the state, at the top of the billing screen: texting is
 *                        off, inbound still arrives, and here is Resume.
 *
 * # THE CONSTRAINT THAT OUTRANKS THE FEATURE
 *
 * REACHING STRIPE WHILE ANSWERING NOTHING IS ONE ACTION FROM LANDING ON THE
 * BILLING SCREEN, and nothing here may change that. A previous round of this
 * feature regressed it from one action to two on all three clients and every
 * build report called it fine, so it is worth saying in the imperative: the
 * leave button does not move, does not become disabled, and nothing new goes
 * above it. `SeasonalPauseAnswer` renders in the same slot the existing answer
 * does — last, after the exit — for the arithmetic `cancel-subscription-card`
 * works through in its docblock.
 *
 * A PAUSE OFFER IS AN OFFER. It is never a step, never a confirmation in front
 * of the exit, and never a reason the exit is unavailable. It is a paragraph
 * with one outline button under it, in the same bordered note the other five
 * answers use, and it appears only after somebody has volunteered a reason.
 *
 * There is deliberately NO confirmation dialog in front of the pause itself
 * either. A dialog would protect nothing that the label does not: the control
 * names the exact recurring amount, the body says what stops and what does not,
 * and the whole thing is undone by one press of Resume on this same screen. The
 * house rule about ethical friction is aimed at actions that cannot be taken
 * back; this is the most recoverable state in the product.
 *
 * # NO FIGURE IS INVENTED HERE
 *
 * `monthly_cents` is the real price, read out of Stripe by
 * `GET /v1/billing/pause` before anybody presses anything, and it is printed on
 * the control itself — a customer must never agree to a recurring charge whose
 * amount we did not state. Every surface below is gated on HAVING that number:
 * no price, no offer, and no price on the paused card means the sentence about
 * money is absent rather than approximated. The route already reports
 * `eligible: false` for a price it cannot quote, and the null checks here are
 * the belt to that braces.
 *
 * # WHY NOTHING EXPLAINS AN INELIGIBLE PAUSE
 *
 * `reason` is never rendered. `not_provisioned` is our unset Stripe catalog and
 * is none of the customer's business; `already_prepaid`, `plan_change_pending`
 * and the rest are answered by the surfaces that own them, on the same screen.
 * A greyed-out Pause control with an explanation under it would put our billing
 * configuration between somebody and the way out, which is exactly the thing the
 * cancel card exists to refuse.
 */

/**
 * Whether `GET /v1/billing/pause` may be asked at all.
 *
 * ONE PREDICATE, TWO CALLERS, and that is the whole point of it existing. The
 * billing page and the cancel card both call `usePauseOffer`, they share a
 * query key, and react-query fires the request if EITHER of them enables it —
 * so two gates that disagree are not two opinions, they are silently the wider
 * one. They did disagree: the page asked for somebody with `billing.manage`, a
 * plan and a live subscription, while the card asked for any owner. An owner
 * whose workspace has no plan (setup abandoned before checkout) therefore bought
 * two Stripe round trips, on a screen that renders on every visit, for an answer
 * that can only ever be `no_subscription`.
 *
 * `allowed` stays the CALLER'S, because the permission is genuinely a different
 * question on each surface: the page renders the paused state for anybody
 * holding `billing.manage`, and only the OWNER's cancel card has a slot to put
 * the offer in — #421 gives everybody else Stripe's card-update flow, which has
 * no cancellation surface at all. What the two must agree on is the SHAPE OF THE
 * WORKSPACE, which is what this function is.
 *
 * An active subscription with a plan is also the only shape a paused workspace
 * can have: a pause is a licensed-price swap, so `subscription_status` stays
 * genuinely `active` and `plan` is untouched.
 */
export function pauseQueryEnabled(
  allowed: boolean,
  company: Pick<CompanyView, "plan" | "subscription_status"> | undefined,
): boolean {
  return (
    allowed &&
    company?.plan != null &&
    company.subscription_status === "active"
  );
}

/**
 * Money the SERVER quoted, formatted the way the prepaid-year card beside it on
 * this screen formats the figure IT is given.
 *
 * A bare "$" and no currency claim, deliberately. The pause is a single Stripe
 * price id (`STRIPE_PAUSE_PRICE_ID`), the response carries cents and no
 * currency, and `formatMoney` cannot be used without asserting one: labelling it
 * with the workspace's `billing_currency` would state a fact the API does not
 * give us, and hardcoding "US$" would state a different one. The amount itself
 * is exact either way, and it is the amount somebody is agreeing to.
 *
 * Plan prices on this screen are a different case and DO go through
 * `formatMoney` — those come from the shared price book, which knows its own
 * currency.
 */
function monthly(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The words the offer says, exported so the tests read the shipped copy rather
 * than a paraphrase of it. Same convention as `cancel-subscription-card`.
 *
 * WHAT THE BODY HAS TO CARRY, and why each clause is load-bearing:
 *
 *   the price      stated before the control and again on it.
 *   texting stops  `runPreSendGates` refuses with `workspace_paused` (402) and
 *                  dialling is off in both directions. Somebody planning a quiet
 *                  season around a product that still answers their customers
 *                  would find out from a customer.
 *   inbound lives  nothing a customer sends is lost, and scheduled sends are
 *                  HELD rather than failed. This is the promise the fee buys.
 *   no deadline    the whole difference from cancelling. Said as "nothing
 *                  expires" rather than by naming a number of days: the only
 *                  countdown in this product is the cancellation hold, and any
 *                  count of days on this card must name where it is counted
 *                  from (see `OFFER-13`).
 *
 * No persuasion, in either direction. The cancel card's rule is that we record
 * an answer and do not argue with the decision; this is a better answer to
 * "quiet season" than the hold is, offered once, in the same muted voice.
 */
export function pauseOfferHeading(monthlyCents: number): string {
  return `Pause instead — keep the number for ${monthly(monthlyCents)} a month`;
}

export function pauseOfferBody(monthlyCents: number): string {
  return (
    `${monthly(monthlyCents)} a month instead of your plan fee. Your number ` +
    "and your whole message history stay exactly where they are, and texts " +
    "your customers send still arrive — you cannot send or take calls until " +
    "you are back, and anything you had scheduled waits rather than fails. " +
    "Nothing expires while you are paused, so there is no deadline on the " +
    "number and nothing to set up again. Come back to the same plan whenever " +
    "the work does."
  );
}

export function pauseOfferAction(monthlyCents: number): string {
  return `Pause for ${monthly(monthlyCents)} a month`;
}

/** Said once, where the press happened — the paused card is a screen away. */
export const PAUSE_CONFIRMATION =
  "Your plan is paused. Your number and your history are held.";

export const RESUME_CONFIRMATION = "You're back. Texting is on again.";

/**
 * The seasonal answer, when there is a pause to offer.
 *
 * Rendered by `CancelSubscriptionCard` in place of the shared `seasonal` offer,
 * which describes the 30-day hold — true, and the best thing we had to say
 * before this existed. For somebody who has just told us they will be back next
 * spring, a hold that runs out in a month is the wrong answer to their question
 * and this is the right one, so it replaces rather than joins it. Two answers to
 * one reason would be the retention funnel this card refuses to become.
 *
 * OUTLINE, NEVER PRIMARY. `Continue to cancel` is the only loud control in that
 * card, and an offer that out-shouts the exit is the dark pattern the whole
 * screen is built against. Failure is shown inline and blocks nothing: the exit
 * is a few pixels above it and is unaffected by anything that happens here.
 */
export function SeasonalPauseAnswer({
  monthlyCents,
}: {
  /** The REAL price, from `GET /v1/billing/pause`. Never a default. */
  monthlyCents: number;
}) {
  const pause = usePausePlan();
  const [error, setError] = useState<string | null>(null);

  return (
    <AnswerNote
      heading={pauseOfferHeading(monthlyCents)}
      body={pauseOfferBody(monthlyCents)}
    >
      <div className="space-y-2">
        <Button
          variant="outline"
          disabled={pause.isPending}
          onClick={() => {
            setError(null);
            pause.mutate(undefined, {
              // Trusted, not assumed: the route re-reads its own mirror after
              // the Stripe swap and 409s when the two disagree, so a success
              // here really is a paused workspace. The query invalidation the
              // hook does is what takes this offer off the screen.
              onSuccess: () => toast.success(PAUSE_CONFIRMATION),
              onError: (cause) =>
                setError(
                  cause instanceof ApiError
                    ? cause.message
                    : "That didn't go through. Try again in a moment.",
                ),
            });
          }}
        >
          {pause.isPending ? "Pausing…" : pauseOfferAction(monthlyCents)}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </AnswerNote>
  );
}

/**
 * The day the pause started, in the reader's own zone.
 *
 * LOCAL, unlike the number-release date on this same screen, and the difference
 * is not an inconsistency. That date is a DEADLINE computed in UTC by a cron
 * that acts on it, so a date drawn a day either side of the one the job uses
 * would be actively wrong. This is a moment that has already happened, and the
 * reader's own calendar is the honest place to put it.
 */
function pausedDay(isoDate: string): string | null {
  const when = new Date(isoDate);
  return Number.isNaN(when.getTime())
    ? null
    : when.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
}

/**
 * The paused state itself, at the top of the billing screen.
 *
 * # Why a card and not a note
 *
 * The other two things this file's sibling renders are supporting facts on
 * somebody else's screen. This is the state of the account — it explains why
 * every other card below it behaves the way it does — so it is a card, and it
 * sits above them.
 *
 * # Three facts and one action, in that order
 *
 * What is off, what is safe, what it costs, and the way back. The order is the
 * order somebody worries in: the first thing they need to know is that texting
 * is genuinely off, and the very next thing is that nothing their customers sent
 * has been lost. Anything more is a fourth thing to read on a screen whose whole
 * message is "you are paused, and here is Resume".
 *
 * # What it does not do
 *
 * NO SKELETON AND NO ERROR BOX, the rule `MissedWhileOff` and `PrepaidYearCard`
 * already follow on this screen: a broken panel where a state should be makes
 * the billing itself look broken, and this renders above everything. An
 * unreachable pause query means no card, and the screen is the one it was
 * before.
 *
 * IT DOES NOT ASK WHILE IT WOULD NOT RENDER. `show` is the caller's gate and
 * costs two Stripe round trips server-side, so it is asked only for somebody who
 * can manage billing on a workspace with a live subscription — which is the only
 * shape a paused workspace has (a pause leaves `subscription_status` genuinely
 * `active`, which is the whole reason it is a price swap rather than a status).
 */
export function PausedPlanCard({
  show,
}: {
  /** `billing.manage`, a plan, and an active subscription. */
  show: boolean;
}) {
  const pause = usePauseOffer(show);
  const resume = useResumePlan();
  const [error, setError] = useState<string | null>(null);

  const data = pause.data;
  if (!show || !data || data.paused_at === null) return null;

  const since = pausedDay(data.paused_at);
  const resumeName = data.resume_plan ? PLAN_FACTS[data.resume_plan].name : null;

  return (
    <SettingsCard title="Your plan is paused">
      <div className="flex items-start gap-3">
        <PauseCircle
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-sm">
            Texting is off. You can&apos;t send messages or take calls while your
            plan is paused.
          </p>
          <p className="text-sm text-muted-foreground">
            Texts your customers send still arrive, so nothing is lost — and
            anything you had scheduled is waiting rather than failed. Your
            number and your whole message history are exactly where you left
            them.
          </p>
          {/* Absent rather than approximated when the mirror has no figure.
              There is no honest sentence about a charge whose amount we cannot
              read, and the rest of this card is true without it. */}
          {data.monthly_cents !== null && (
            <p className="text-sm text-muted-foreground">
              You&apos;re paying{" "}
              <span className="font-medium text-foreground">
                {monthly(data.monthly_cents)} a month
              </span>{" "}
              to hold them
              {since ? `, since ${since}` : ""}.
            </p>
          )}

          <div className="space-y-2">
            <Button
              disabled={resume.isPending}
              onClick={() => {
                setError(null);
                resume.mutate(undefined, {
                  // Same rule as the pause: the route re-reads the mirror and
                  // 409s rather than reporting a success it cannot see, so this
                  // card disappearing on the refetch is the real answer.
                  onSuccess: () => toast.success(RESUME_CONFIRMATION),
                  onError: (cause) =>
                    setError(
                      cause instanceof ApiError
                        ? // Written for the customer, and says the thing they
                          // most need to hear on a second press ("you won't be
                          // charged twice"). Shown as-is.
                          cause.message
                        : "That didn't go through. Try again in a moment.",
                    ),
                });
              }}
            >
              {resume.isPending ? "Resuming…" : "Resume"}
            </Button>
            {resumeName && (
              <p className="text-xs text-muted-foreground">
                {resumeName} starts again at its usual price, with everything
                where it is.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}
