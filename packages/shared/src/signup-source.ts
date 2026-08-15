/**
 * #288 — how did you hear about us?
 *
 * # Why this exists, in the issue's own words
 *
 * "We are not even *measuring* the thing we most depend on." #288's devil's
 * advocate names the cheap first step directly: "ask new signups how they heard
 * about us, and find out whether this channel exists before investing in
 * amplifying it."
 *
 * # Why the passive attribution we already have cannot answer it
 *
 * #296 records the marketing page an owner first landed on and the referring
 * host. #288 added `(referral)` for anyone who arrived through a link. Both are
 * real and neither can see the case this business actually runs on: somebody is
 * told about us at a supply-house counter, types the name into Google a week
 * later, and lands on the home page with no parameters, no referrer and no
 * campaign. Passively, that is direct traffic. It is word of mouth, and it is
 * indistinguishable from a stranger who found us by accident.
 *
 * One question closes that gap, and nothing else can.
 *
 * # Why the answers are four and vague
 *
 * *Chunking* — the brain holds three or four. A longer list produces better
 * taxonomy and worse data, because the cost of answering rises and the skip rate
 * with it. Each of these maps to a decision we would actually make: keep asking
 * crews to refer, keep writing for search, keep posting, or go and read the free
 * text.
 *
 * OPTIONAL, always, and absent is a real answer. A signup that skips this is a
 * signup we still want, and "never asked" has to stay distinguishable from
 * "declined to say" in the reporting — the same rule #370's crew size follows.
 */

export const SIGNUP_SOURCES = [
  "another_business",
  "search",
  "social",
  "other",
] as const;

export type SignupSource = (typeof SIGNUP_SOURCES)[number];

/**
 * What the owner reads.
 *
 * "Another business told me" rather than "referral" — the word "referral"
 * invites them to think about our programme and answer about the link, when what
 * is being asked is whether a human recommended us at all.
 */
export const SIGNUP_SOURCE_LABELS: Record<SignupSource, SignupSourceKey> = {
  another_business: "onboarding.signupSourceAnotherBusiness",
  search: "onboarding.signupSourceSearch",
  social: "onboarding.signupSourceSocial",
  other: "onboarding.signupSourceOther",
};

/** Every catalogue key this module names. */
export type SignupSourceKey =
  | "onboarding.signupSourceAnotherBusiness"
  | "onboarding.signupSourceSearch"
  | "onboarding.signupSourceSocial"
  | "onboarding.signupSourceOther"
  | "onboarding.signupSourcePrompt"
  | "onboarding.signupSourceHint";

/**
 * The question itself.
 *
 * #228: web-only, unlike most of this sweep — there is no signup flow on
 * either phone, because you sign a business up on a keyboard. So these six
 * keys live in the web's onboarding section and have no Kotlin or Swift twin
 * to keep in step.
 */
export const SIGNUP_SOURCE_PROMPT: SignupSourceKey =
  "onboarding.signupSourcePrompt";

/**
 * Said out loud, because an optional question in a signup flow reads as required
 * unless it says otherwise — and a required one here would be friction on the
 * screen that can least afford it.
 */
export const SIGNUP_SOURCE_HINT: SignupSourceKey =
  "onboarding.signupSourceHint";

export function isSignupSource(value: string): value is SignupSource {
  return (SIGNUP_SOURCES as readonly string[]).includes(value);
}
