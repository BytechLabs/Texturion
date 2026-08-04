import { roleHasCapability, type MemberRole } from "./capabilities";

/**
 * #286 — who is shown the joining orientation, and when.
 *
 * "An invited member sees a short, skippable, member-specific orientation on
 * first sign-in." The decision is three lines and it is on three clients, so
 * it lives here rather than three times: a phone that disagrees with the web
 * about whether somebody is new shows them the flow twice, or never.
 */

/** The four screens, in order. Prose lives in each client, per #476. */
export const ORIENTATION_STEPS = [
  /** One inbox, the whole crew. What the product IS, in one sentence. */
  "inbox",
  /** Replies go out as the business — and which numbers they can reach. */
  "number",
  /** Notes are not texts. The one mistake that reaches a customer. */
  "notes",
  /** When we buzz you, decided deliberately rather than at 6am. */
  "notifications",
] as const;

export type OrientationStep = (typeof ORIENTATION_STEPS)[number];

/**
 * Show the joining orientation?
 *
 * `oriented` is the server's answer for THIS membership (api_member_firsts),
 * so a skip on a phone is a skip on the laptop too. Undefined means the read
 * has not landed: show nothing rather than flashing four screens at somebody
 * who has been here for months.
 *
 * The audience is the one #405 already drew for the first-run checklist —
 * somebody who answers customers and does not run the workspace. Not a
 * filtered version of the owner's flow but a different one, for the same
 * reason: the owner walked a five-step wizard and chose this product, and the
 * member was told to use it.
 *
 * Deliberately NOT shown to a read-only observer or a bookkeeper. Every screen
 * of it is about answering customers, which neither of them does; four screens
 * explaining a job that is not yours is worse than no screens.
 */
export function shouldShowOrientation(
  role: MemberRole | null | undefined,
  oriented: boolean | undefined,
): boolean {
  if (oriented !== false) return false;
  if (role == null) return false;
  if (roleHasCapability(role, "settings.manage")) return false;
  return roleHasCapability(role, "conversations.send");
}

/**
 * How far along the bar reads, 0..1 — never zero.
 *
 * Somebody on screen one has already done something: they accepted an invite,
 * signed in and opened the app. A bar that starts empty says otherwise and
 * makes four screens feel like a form.
 *
 * *Applying: Goal Gradient Effect.*
 */
export function orientationProgress(index: number): number {
  const total = ORIENTATION_STEPS.length;
  const clamped = Math.min(Math.max(index, 0), total - 1);
  return (clamped + 1) / total;
}
