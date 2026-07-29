/**
 * #388 — the numbers behind FIRST RESPONSE.
 *
 * These live here rather than in the SQL or the Worker because three clients
 * have to describe the behaviour to a customer in words ("we'll buzz you again
 * after two minutes"), and a settings screen that says two while the server
 * waits five is worse than no settings screen. #392 is open about exactly this
 * failure — a product constant written out four times, already changed twice.
 */

/**
 * How long an unanswered lead waits before the SAME audience is nudged again.
 *
 * REMOVED (#463, owner direction). There was one rung at two minutes and one
 * at five, and the two-minute buzz is gone: an alert that arrives 120 seconds
 * after the one you already got, about the same conversation, reads as a
 * duplicate and trains people to swipe. The five-minute rung below is the one
 * that does work — it reaches somebody NEW.
 *
 * The reasoning for two minutes was not wrong on its own terms (a reminder
 * arriving at the deadline is a post-mortem); it was wrong about the cost,
 * which is paid in every alert the crew stops reading.

/**
 * When an unanswered ASSIGNED lead widens to everyone who can see the thread.
 *
 * This is the five-minute mark itself: past it the assignee has demonstrably
 * not got to it, and the only remaining move is to ask somebody else. An
 * unassigned lead does not widen — everybody was already told twice, and a
 * third buzz reaches no new person.
 */
export const LEAD_CHASE_WIDEN_MINUTES = 5;

/**
 * The rungs, in the order they fire. `level` is the value written to
 * `conversations.chase_level`.
 *
 * ONE rung since #463. Level 2 keeps its number rather than being renumbered
 * to 1: `conversations.chase_level` already holds 2 for every lead that has
 * been widened, and renaming the value would make live rows mean something
 * they did not mean when they were written.
 */
export const LEAD_CHASE_RUNGS = [
  { level: 2, minutes: LEAD_CHASE_WIDEN_MINUTES, widens: true },
] as const;

export type LeadChaseRung = (typeof LEAD_CHASE_RUNGS)[number];

/**
 * The push copy for a rung.
 *
 * Both lines lead with the elapsed time rather than the contact name, which is
 * the opposite of the ordinary inbound notification and deliberate: the reader
 * has already seen a notification naming this contact, and the ONLY new fact
 * is that it has gone unanswered. A second identical-looking alert reads as a
 * duplicate and gets swiped away.
 */
export function leadChaseNotification(
  rung: 2,
  contactName: string,
): { title: string; body: string } {
  void rung;
  return {
    title: `${LEAD_CHASE_WIDEN_MINUTES} min, still no reply`,
    body: `${contactName} hasn't heard back. Anyone can take this one.`,
  };
}
