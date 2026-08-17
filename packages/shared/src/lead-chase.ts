/**
 * #388 — the numbers behind FIRST RESPONSE.
 *
 * These live here rather than in the SQL or the Worker because three clients
 * have to describe the behaviour to a customer in words ("we'll buzz you again
 * after two minutes"), and a settings screen that says two while the server
 * waits five is worse than no settings screen. #392 is open about exactly this
 * failure — a product constant written out four times, already changed twice.
 */
import type { Locale } from "./locale";

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
 * #228 — the rung's two lines, in each language.
 *
 * `contactName` passes straight through both renderings: it is the customer's
 * own name, or their raw phone number when we have no name for them, and
 * nothing about it is ours to translate. The sentence around it is.
 *
 * The minutes are a parameter rather than a read of the constant above, so a
 * clause here never depends on anything but its own arguments.
 */
interface LeadChaseCopy {
  title(minutes: number): string;
  body(contactName: string): string;
}

const EN: LeadChaseCopy = {
  title: (minutes) => `${minutes} min, still no reply`,
  body: (contactName) => `${contactName} hasn't heard back. Anyone can take this one.`,
};

const FR_CA: LeadChaseCopy = {
  // "min" is the abbreviation in both languages, so the French title costs
  // nothing extra against the ~40-character title budget on a lock screen.
  title: (minutes) => `${minutes} min, toujours sans réponse`,
  // Plain working register for the instruction, not corporate French: the
  // thread has widened and any of them may pick it up.
  body: (contactName) =>
    `${contactName} n'a pas eu de réponse. N'importe qui peut s'en occuper.`,
};

const LEAD_CHASE_COPY: Record<Locale, LeadChaseCopy> = { en: EN, "fr-CA": FR_CA };

/**
 * The push copy for a rung.
 *
 * Both lines lead with the elapsed time rather than the contact name, which is
 * the opposite of the ordinary inbound notification and deliberate: the reader
 * has already seen a notification naming this contact, and the ONLY new fact
 * is that it has gone unanswered. A second identical-looking alert reads as a
 * duplicate and gets swiped away.
 *
 * #228: `locale` DEFAULTS, which is the one place in this sweep where a caller
 * can still drop the reader's language without the compiler noticing. It is a
 * bridge, not a preference — `apps/api/src/notifications/lead-chase.ts` calls
 * this once, above its `web:` closure, where there is no locale in scope yet.
 * Moving that call inside the closure and passing the argument is what finishes
 * this, and the default should go with it.
 */
export function leadChaseNotification(
  rung: 2,
  contactName: string,
  locale: Locale = "en",
): { title: string; body: string } {
  void rung;
  const copy = LEAD_CHASE_COPY[locale];
  return {
    title: copy.title(LEAD_CHASE_WIDEN_MINUTES),
    body: copy.body(contactName),
  };
}
