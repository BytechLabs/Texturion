/**
 * Missed-call text-back (MCTB) defaults — #192.
 *
 * The founder's settings contract: the TOGGLE decides whether a text-back
 * happens at all; the MESSAGE always exists. A product default lives here
 * (server-side truth — the API send path reads it), and an owner-authored
 * message overrides it ONLY when non-blank. Shared so the API (send path +
 * company view) and the web placeholder/preview render the exact same text.
 */

/**
 * The product default missed-call text-back. Sent verbatim (after merge-field
 * substitution) whenever the toggle is ON and the owner has not written their
 * own message. Booking-forward, no em dashes, {business_name} resolves to the
 * company name at send time.
 */
export const DEFAULT_MCTB_MESSAGE =
  "Sorry we missed your call! This is {business_name}. Reply here with your " +
  "address and what you need, and we'll get you booked in.";

/** The effective text-back template + whether it is owner-authored. */
export interface EffectiveMctbMessage {
  /** The template that will actually be sent (custom if non-blank, else the default). */
  message: string;
  /** True when the owner's own text is in effect (non-blank custom). */
  custom: boolean;
}

/**
 * The single fallback rule (#192): a non-blank owner message wins; anything
 * blank (null, empty, whitespace) falls back to the product default.
 */
export function effectiveMctbMessage(
  ownerMessage: string | null | undefined,
): EffectiveMctbMessage {
  const trimmed = (ownerMessage ?? "").trim();
  return trimmed.length > 0
    ? { message: trimmed, custom: true }
    : { message: DEFAULT_MCTB_MESSAGE, custom: false };
}
