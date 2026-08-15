/**
 * #538 — turning your own notifications off while you are the one on call.
 *
 * ## What the audit found
 *
 * The issue asked for other places that would benefit from a confirmation. Almost
 * everywhere already had one: leaving a workspace names the consequence, turning
 * your own two-factor off names it, releasing a number names it. The notifications
 * screen did not, and it is the one where silence is the whole failure.
 *
 * A crew nominates somebody on call. Unclaimed leads page that person. If they
 * switch push off — perfectly reasonable on an ordinary evening — the pages still
 * fire and reach nothing. Nobody else is told, because as far as the system is
 * concerned the alert was delivered. The customer texted, nobody answered, and the
 * first anyone hears about it is the customer going somewhere else.
 *
 * That is the same shape as the self-downgrade: an action whose cost falls on
 * somebody who is not on this screen, taken with a control that looks routine.
 *
 * ## Why this is a warning and not a refusal
 *
 * Somebody who wants their phone quiet is entitled to a quiet phone, and a product
 * that refuses would be a product people work around by turning the phone off —
 * which is worse, because then we cannot tell. So it says what will happen and who
 * to hand the shift to, and lets them decide.
 */

/** Is this member on call at this instant, for any number? */
export function isOnCallNow(
  shifts: readonly { user_id: string; starts_at: string; ends_at: string }[],
  userId: string,
  now: Date = new Date(),
): boolean {
  const at = now.getTime();
  return shifts.some((shift) => {
    if (shift.user_id !== userId) return false;
    const from = Date.parse(shift.starts_at);
    const until = Date.parse(shift.ends_at);
    // An unparseable stamp is treated as NOT covering the moment. The alternative
    // — assuming it does — would warn somebody who is not on call, and a warning
    // that fires wrongly is one people learn to dismiss.
    if (Number.isNaN(from) || Number.isNaN(until)) return false;
    return at >= from && at < until;
  });
}

/**
 * What to say before somebody on call goes quiet.
 *
 * `channel` is the thing being switched off, in the words the screen uses, so the
 * sentence names the actual control rather than "notifications".
 *
 * Null when there is nothing to warn about — not on call, or switching something
 * ON — so a caller can ask unconditionally.
 */
/** Every catalogue key this module names. */
export type OnCallSilenceKey =
  | "domain.onCallSilenceWarning"
  | "domain.onCallSilenceChannelPush"
  | "domain.onCallSilenceChannelEmail"
  | "domain.onCallSilenceConfirm"
  | "domain.onCallSilenceCancel";

/** The reader's resolver. */
export type SayOnCallSilence = (key: OnCallSilenceKey) => string;

export function onCallSilenceWarning(
  onCall: boolean,
  turningOff: boolean,
  channel: "email" | "push",
  say: SayOnCallSilence,
): string | null {
  if (!onCall || !turningOff) return null;
  /*
   * #228 — the channel noun is its own key, not an English word dropped into
   * a translated sentence.
   *
   * French carries the article on it: "LES alertes push sont…" against "LES
   * courriels sont…". Interpolating a bare "Push alerts" into a French
   * sentence would produce "Vous êtes de garde. Push alerts sont…", which is
   * the shape a half-translated string always takes.
   */
  const what = say(
    channel === "push"
      ? "domain.onCallSilenceChannelPush"
      : "domain.onCallSilenceChannelEmail",
  );
  return say("domain.onCallSilenceWarning").replace("{what}", what);
}

/** The confirm button, which says what happens rather than "OK". */
export const ON_CALL_SILENCE_CONFIRM: OnCallSilenceKey =
  "domain.onCallSilenceConfirm";

/** ...and the way out. */
export const ON_CALL_SILENCE_CANCEL: OnCallSilenceKey =
  "domain.onCallSilenceCancel";
