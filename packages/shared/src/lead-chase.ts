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
 * Two minutes, not five: five is the deadline, not the reminder. The research
 * the brand is named after measures the response itself — a reply inside five
 * minutes converts far better than one at thirty — so the nudge that produces
 * that reply has to land with time left to type it. A reminder that arrives at
 * the deadline is a post-mortem.
 */
export const LEAD_CHASE_NUDGE_MINUTES = 2;

/**
 * When an unanswered ASSIGNED lead widens to everyone who can see the thread.
 *
 * This is the five-minute mark itself: past it the assignee has demonstrably
 * not got to it, and the only remaining move is to ask somebody else. An
 * unassigned lead does not widen — everybody was already told twice, and a
 * third buzz reaches no new person.
 */
export const LEAD_CHASE_WIDEN_MINUTES = 5;

/** The rungs, in the order they fire. `level` is the value written to `conversations.chase_level`. */
export const LEAD_CHASE_RUNGS = [
  { level: 1, minutes: LEAD_CHASE_NUDGE_MINUTES, widens: false },
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
  rung: 1 | 2,
  contactName: string,
): { title: string; body: string } {
  if (rung === 1) {
    return {
      title: `${LEAD_CHASE_NUDGE_MINUTES} min, no reply yet`,
      body: `${contactName} is still waiting. Tap to answer.`,
    };
  }
  return {
    title: `${LEAD_CHASE_WIDEN_MINUTES} min, still no reply`,
    body: `${contactName} hasn't heard back. Anyone can take this one.`,
  };
}
