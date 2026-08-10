import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";
import type { PauseOffer } from "@/lib/api/billing";

/**
 * #277 — the four things the billing screen can honestly know about the pause,
 * and what each one licenses it to say.
 *
 * # Why this is a type and not a boolean
 *
 * `usePauseOffer(show).data?.paused_at != null` reads as "is this workspace
 * paused". It is not. It is "have we been told, in this render, that it is",
 * and it answers FALSE for three situations that are not "no": nobody asked,
 * the answer has not landed yet, and the ask failed. All three rendered as an
 * ordinary running plan — so a genuinely paused workspace whose read was still
 * in flight was shown a green Active badge, the allowance lines of a plan that
 * is not running, and a live "Switch to Starter" whose POST answers 409 by
 * design (`apps/api/src/routes/billing.ts`: "Your plan is paused. Resume it
 * first, then switch plans").
 *
 * A SCREEN MAY NOT STATE A FACT IT HAS NOT READ. Quiet until the answer lands
 * is honest; green is not. Everything that claims the plan is RUNNING hangs off
 * an answer that said so, rather than off the absence of one.
 *
 * # Why the logic is here rather than inside the page
 *
 * A rule that lives inside a component can only be guarded by rendering the
 * component and reading its output. This one is a pure function of two inputs,
 * so here it can be broken in a test — which is the difference between a guard
 * and a decoration.
 *
 * # Why it looks like the Kotlin
 *
 * Android settled this first, in `SettingsLogic.kt` (`PauseRead`, `planBadge`,
 * `planStateUnknownNote`), because the defect was identical on all three
 * clients. The shapes and the failure sentence are kept in step on purpose: one
 * screen, one story, whichever device it is read on.
 */
export type PauseRead =
  /**
   * Nobody asked, and that is not "not paused".
   *
   * Two ways to be here. The question is MOOT — `pauseQueryEnabled` is false for
   * a workspace with no plan or without a live subscription, and that is exactly
   * the shape a paused workspace cannot have, because a pause is a licensed-price
   * swap that leaves `plan` set and `subscription_status` genuinely `active`. Or
   * the viewer may not ask: `GET /v1/billing/pause` is behind `billing.manage`,
   * so this client cannot learn about a pause on a member's behalf at all.
   */
  | { readonly state: "unasked" }
  /** Asked, nothing back yet. The cold-start window that used to render green. */
  | { readonly state: "loading" }
  /** Asked and answered. The only state that licenses a claim in either direction. */
  | { readonly state: "answered"; readonly answer: PauseOffer }
  /**
   * Asked, and the ask failed.
   *
   * Deliberately not folded into `unasked`: the route throws rather than
   * degrading to a null answer, precisely so no surface renders an offer with a
   * hole where the price goes, and a client that turns that throw back into a
   * shrug has undone it.
   */
  | { readonly state: "failed" };

/**
 * The half of a `useQuery` result this cares about.
 *
 * Narrowed so the rules below can be tested without react-query in the room.
 */
export interface PauseQuerySnapshot {
  data: PauseOffer | undefined;
  isError: boolean;
}

/**
 * What the screen has actually read, from the query and the gate that fired it.
 *
 * `enabled` IS A SEPARATE ARGUMENT BECAUSE THE QUERY CANNOT TELL US. A disabled
 * react-query reports `status: "pending"` with no data and no error — byte for
 * byte what a cold start reports — so "nobody asked" and "asked, still waiting"
 * are one value on the way in and have to be told apart by the caller's own
 * gate. Pass `pauseQueryEnabled(...)`, the same predicate that fired it.
 *
 * AN ANSWER IN HAND WINS OVER A LATER FAILURE. react-query keeps the last
 * successful data through a failed refetch, and that answer came from this same
 * route with nothing newer contradicting it — so a background refetch that
 * cannot reach Stripe must not flip a paused card back to neutral.
 */
export function pauseReadOf(
  enabled: boolean,
  query: PauseQuerySnapshot,
): PauseRead {
  if (query.data !== undefined) return { state: "answered", answer: query.data };
  if (query.isError) return { state: "failed" };
  if (!enabled) return { state: "unasked" };
  return { state: "loading" };
}

/** Paused, and we were told so. Never true on a guess. */
export function readSaysPaused(read: PauseRead): boolean {
  return read.state === "answered" && read.answer.paused_at !== null;
}

/**
 * Running, and we were told so.
 *
 * NOT `!readSaysPaused(read)`. That expression is the whole defect in one line:
 * it is true of a read that has not landed and of one that failed, which is how
 * a paused workspace came to be told its plan was active. Every claim that the
 * plan is running — the badge, the allowance lines, the plan switch — hangs off
 * this one instead.
 */
export function readSaysRunning(read: PauseRead): boolean {
  return read.state === "answered" && read.answer.paused_at === null;
}

/** What the plan card may say about this plan's state, if anything. */
export type PlanBadge = "paused" | "active" | "checking";

/**
 * The badge on the plan card, or none.
 *
 * PURE, AND THAT IS THE POINT. This is the rule on this screen that cannot bend
 * — no "Active" over a workspace nobody has heard back about — and it is one
 * `if` away from being wrong in the direction that costs a customer a 409 and
 * us the credibility of the screen.
 *
 * `cancelAtPeriodEnd` and a subscription that is not active both answer NOTHING
 * rather than a fourth badge: the notice at the top of this screen already says
 * cancelling is scheduled or that a payment failed, and saying it again beside
 * the plan name is noise on a screen somebody is reading in a hurry.
 *
 * `unasked` says nothing either, and that is the one case worth spelling out.
 * For a member nobody CAN ask — `paused_at` is a `billing.manage` fact and is
 * deliberately not on `company_view`, because putting it there would load a
 * Stripe-backed billing fact on every app boot for every role. So the badge is
 * withheld rather than guessed. The plan's own terms stay (see the page): the
 * badge is the only thing here that CLAIMS a state, and blanking the rest would
 * punish the one reader who has no control on this card to be misled about.
 */
export function planBadge(
  read: PauseRead,
  subscription: { subscriptionActive: boolean; cancelAtPeriodEnd: boolean },
): PlanBadge | null {
  if (readSaysPaused(read)) return "paused";
  if (
    readSaysRunning(read) &&
    subscription.subscriptionActive &&
    !subscription.cancelAtPeriodEnd
  ) {
    return "active";
  }
  // Answered, and there is nothing to badge: past due, unpaid, or on its way
  // out. The notice above has already said which.
  if (read.state === "answered") return null;
  if (read.state === "loading") return "checking";
  // Unasked or failed. Nothing was read, so nothing is claimed.
  return null;
}

/**
 * What the plan card says when it could not find out, or null when it did.
 *
 * ONLY THE FAILURE SPEAKS. `loading` is covered by the Checking badge, and a
 * sentence there would be narrating a network request at somebody who came to
 * look at their plan. `unasked` says nothing because there is nothing to report.
 *
 * The sentence states what is NOT known rather than apologising, and it says
 * that nothing changed — because the reader's next thought after "couldn't
 * check" is "did something happen to my plan". Word for word the sentence
 * Android's `planStateUnknownNote` shows, so the two clients do not describe the
 * same failure two ways.
 */
export function planStateUnknownNote(
  read: PauseRead,
  /**
   * #228: defaulted to English so `pause-read.test.ts` — which has no provider
   * and asserts the shipped sentence — keeps reading exactly what it read.
   */
  t: Translate = makeTranslate(DEFAULT_LOCALE),
): string | null {
  return read.state === "failed" ? t("settingsMore.planStateUnknown") : null;
}

/**
 * May a control that changes the plan be drawn at all?
 *
 * `POST /v1/billing/change-plan` answers 409 while `companies.paused_at` is set,
 * and asks for the two steps in order instead ("resume first, then switch
 * plans"), because a plan change during a pause is ambiguous in a way only the
 * customer can settle. A button whose only outcome is a refusal is a button that
 * should not have been drawn — and that was equally true of the window before
 * the read landed, which is why this is `readSaysRunning` rather than "no pause
 * in hand".
 *
 * `unasked` IS ALLOWED, and it is the one carve-out. The gate that leaves us
 * unasked is `pauseQueryEnabled`, which is false only for a workspace with no
 * plan or no live subscription — precisely the shape a paused workspace cannot
 * have, since a pause is a price swap that leaves both intact. So a closed gate
 * here is knowledge (this workspace is not paused), not ignorance, and the
 * screen behaves exactly as it did before the pause existed.
 */
export function readAllowsPlanChange(read: PauseRead): boolean {
  return readSaysRunning(read) || read.state === "unasked";
}
