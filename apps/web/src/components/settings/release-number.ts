import type { NumberHoldState } from "@/components/settings/number-hold";
import type { NumberStatus } from "@/lib/api/types";

/**
 * #523 — the ONE rule for when a number may be given up, and the words that go
 * with it.
 *
 * # Why one file, and why it reads like the Kotlin
 *
 * Three clients arrived at three different answers to a single irreversible
 * question:
 *
 *   web      owner && !released && number_e164        — any status, including a
 *                                                       past-due suspension
 *   iOS      !released && (active || suspended)       — no subscription check
 *   Android  mayReleaseNumber(status, e164, active)   — suspended only while the
 *                                                       subscription is live
 *
 * "Give this number up for good" must not answer differently depending on which
 * device is in the owner's hand, so web adopts Android's, which is the only one
 * of the three with an argument written down. The function keeps Android's name
 * and its argument order so the three can be read side by side and any future
 * drift shows up as a diff rather than as a behaviour report from a customer.
 * Its twin is `mayReleaseNumber` in
 * `apps/android/app/src/main/kotlin/com/loonext/android/features/settings/NumbersSection.kt`.
 *
 * # The rule, and why each clause is there
 *
 * ACTIVE, OR ON HOLD WHILE THE SUBSCRIPTION IS LIVE. The second half is what
 * web was missing. A ported line put on hold by a #523 downgrade had no release
 * control in a browser at all (the number card never draws a ported row, and the
 * port card's only destructive control — "Cancel this transfer" — was correctly
 * hidden under a hold, since there is no transfer left to call off). Releasing
 * is the only way to stop paying that line's carrier rent, the only way to free
 * the Starter slot, and the only way through the Pro-to-Starter downgrade gate.
 * `DELETE /v1/numbers/:id` has always allowed it; it refuses only a row that is
 * already released (`apps/api/src/routes/numbers.ts`).
 *
 * NOT WHILE THE PAYMENT IS THE PROBLEM. `subscriptionActive` is the same field
 * the server splits `over_plan_allowance` from `subscription_inactive` on, so
 * this admits exactly the #523 hold and no other. A past-due workspace has EVERY
 * number suspended and the answer is the card, not the numbers — putting an
 * irreversible "give it up for good" in front of somebody whose real problem is
 * a declined payment is a press made in a panic that nothing can undo. This is
 * the clause web did not have, and the one that made its gate the loosest of the
 * three.
 *
 * A NUMBER WITH NO DIGITS IS NOT RELEASABLE, which is more than cosmetic: the
 * confirmation asks the reader to type the number back, and nobody can do that
 * for a row that has none. It is also what keeps `provisioning` out without a
 * second clause.
 *
 * WHAT THIS DELIBERATELY DROPS is web's old admission of `provision_failed`.
 * Such a row carries no `number_e164` — the provision is what would have
 * assigned one — so in practice the digits clause already excluded it; naming
 * the statuses that DO qualify, rather than the one that does not, is what makes
 * the three clients comparable. That card's own affordance is "Choose a number",
 * which is a route forward rather than a way out.
 *
 * Role is NOT an argument here, exactly as on Android: it is a separate gate at
 * the call site (`workspace.own`, the same capability
 * `DELETE /v1/numbers/:id` requires), and folding two unrelated questions into
 * one predicate is how a role change quietly becomes a lifecycle change.
 */
export function mayReleaseNumber(
  status: NumberStatus,
  numberE164: string | null,
  subscriptionActive: boolean,
): boolean {
  if (numberE164 === null) return false;
  switch (status) {
    case "active":
      return true;
    case "suspended":
      return subscriptionActive;
    default:
      return false;
  }
}

/**
 * #523 — what giving this number up actually does, which is not the same
 * sentence for a working line and a held one.
 *
 * THE SHIPPED WEB COPY IS FALSE FOR A HOLD, and the last clause is the expensive
 * part: "a number is included, so you can set up a new one here afterward". A
 * workspace is on hold BECAUSE the included number is already in use, so
 * releasing brings it back TO the allowance and no further. Somebody who
 * believed that sentence would give up the number they had and then be charged
 * for a paid extra, or refused outright at the Starter cap. Both phones already
 * branch this; web did not, and web is the one client where a held BOUGHT number
 * could always be released — so web is exactly where that sentence was being
 * read under a hold.
 *
 * THE HELD BRANCH NAMES THE ALTERNATIVE FIRST. Bringing the number back leaves
 * the line working, and the control for it is a link away on the same card, so a
 * reader who has arrived at the irreversible button by process of elimination
 * should be told there was no elimination to do. That is what the friction is
 * for; the type-the-number box is the pause, this is the reason to use it.
 *
 * THE THIRD BRANCH IS THE ONE WEB NEEDS AND THE PHONES DO NOT. `NumberHoldState`
 * has an "unknown" answer — suspended, subscription live, and we were not in a
 * position to ask why (see `number-hold.ts` for why that is not guessed at). The
 * allowance sentence would be a guess there, and the replacement promise would
 * be a guess in the direction that costs money, so this branch says plainly that
 * we cannot tell and points at the screen that can. `subscription_inactive`
 * lands here too and is unreachable by construction — `mayReleaseNumber` refuses
 * that state — but it is answered rather than assumed away, so loosening the
 * gate later cannot silently resurrect a false promise.
 */
export function releaseNumberBody(
  hold: NumberHoldState | null | undefined,
): string {
  if (!hold) {
    return (
      "This gives the number up for good. Customers who text it won't reach " +
      "you, and you can't get the same number back. It doesn't change your " +
      "plan or what you pay — a number is included, so you can set up a new " +
      "one here afterward. Type the number to confirm."
    );
  }
  if (hold.kind === "over_allowance") {
    return (
      "This is a number your plan doesn't cover, and releasing it is the other " +
      "way out of that hold — it ends the hold by giving the number up rather " +
      "than by bringing it back. Customers who text it won't reach you " +
      "afterward, and you can't get the same number back. Your plan stops " +
      "being over its allowance, and what you pay doesn't change. Type the " +
      "number to confirm."
    );
  }
  return (
    "This number is already on hold, and releasing it ends the hold by giving " +
    "the number up rather than by bringing it back. Customers who text it " +
    "won't reach you afterward, and you can't get the same number back. What " +
    "you pay doesn't change. We can't tell from here whether your plan has " +
    "room for a replacement — check Billing before you give this one up. Type " +
    "the number to confirm."
  );
}
