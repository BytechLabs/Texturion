/**
 * After-hours away-reply defaults — #414 ask 5.
 *
 * The same contract MCTB already uses (`mctb.ts`): the TOGGLE decides whether
 * an away reply happens at all; the MESSAGE always exists. A product default
 * lives here as server-side truth, and an owner-authored message overrides it
 * only when non-blank.
 *
 * WHY THIS MODULE EXISTS, which is the whole of #414 ask 5. The away reply did
 * NOT work that way. The server sent the owner's text and returned early when
 * it was blank:
 *
 *     if (message.length === 0) return; // enabled but unauthored
 *
 * while web, Android and iOS each carried their OWN copy of the default and
 * showed it in the Preview panel. So an owner who switched away replies on
 * without writing anything saw a preview of a message that would never be
 * sent, and after-hours customers got silence. Neither file looked wrong on
 * its own — the copy and the handler lived apart, which is exactly the class of
 * defect #414 asked us to go looking for in the neighbours.
 *
 * Three hand-copied literals also had no guard keeping them equal. They happened
 * to agree; nothing made them.
 */

/**
 * The product default away reply. Sent verbatim (after merge fields) whenever
 * the toggle is ON and the owner has not written their own.
 *
 * The emergency clause is load-bearing and must stay in step with
 * `EMERGENCY_KEYWORDS`: it is the sentence that made #414 a real defect, and it
 * is only honest because replying URGENT now wakes the crew.
 */
/*
 * #460: TRADE-NEUTRAL, and that is the whole edit. This used to read "For a
 * no-heat or burst-pipe emergency", which is a plumber's sentence sent on behalf
 * of every landscaper, locksmith, mobile mechanic and cleaner on the product.
 * The founder called it awful and was right: a default is what most workspaces
 * actually send, so a default that names somebody else's trade is the product
 * putting words in an owner's mouth.
 *
 * "If this is an emergency" carries the same instruction for every trade and
 * leaves the owner's own wording — which they can and should write — as the
 * thing that makes it specific.
 */
export const DEFAULT_AWAY_MESSAGE =
  "Thanks for texting us. We're out of the office right now and will reply " +
  "first thing. If this is an emergency, reply URGENT and we'll call you.";

/** The effective away template + whether it is owner-authored. */
export interface EffectiveAwayMessage {
  /** The template that will actually be sent (custom if non-blank, else default). */
  message: string;
  /** True when the owner's own text is in effect. */
  custom: boolean;
}

/**
 * The single fallback rule: a non-blank owner message wins; anything blank
 * (null, empty, whitespace) falls back to the product default.
 *
 * Deliberately identical in shape to {@link effectiveMctbMessage} — two
 * auto-send surfaces that resolve their copy differently is how the two drifted
 * apart in the first place.
 */
export function effectiveAwayMessage(
  ownerMessage: string | null | undefined,
  /**
   * #228 - the product default to fall back to, which is language-dependent.
   *
   * The LOCALE is deliberately not the parameter here, and the reason is
   * structural rather than stylistic: `locale.ts` reads this module's English
   * constant so there is exactly one definition of it, and taking a locale here
   * would close that into an import cycle. Passing the already-resolved
   * sentence keeps the dependency pointing one way.
   *
   * Ignored when the owner wrote their own, which is the point: somebody who
   * typed a sentence gets the sentence they typed. A product that translated an
   * owner's own words would be inventing copy for a business it does not speak
   * for.
   */
  fallback: string = DEFAULT_AWAY_MESSAGE,
): EffectiveAwayMessage {
  const trimmed = (ownerMessage ?? "").trim();
  return trimmed.length > 0
    ? { message: trimmed, custom: true }
    : { message: fallback, custom: false };
}
