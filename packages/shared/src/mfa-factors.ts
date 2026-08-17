/**
 * #473 — what to tell somebody about the second factors they hold.
 *
 * ## Why this is not three `if` chains
 *
 * Web, Android and iOS all render the same sentence from the same
 * `GET /v1/mfa` payload, and the sentence is not decorative: it answers "what
 * happens if I lose this phone". Getting it wrong is a wrong answer to that
 * question — telling somebody who enrolled a passkey that an *authenticator
 * app* is on sends them looking for six digits that do not exist.
 *
 * Written once here because a per-client predicate drifts. The clients hold
 * the WORDS (each in its own catalogue, in both languages); this holds the
 * RULE and returns a key.
 *
 * ## Why an unknown type is not "nothing"
 *
 * `FactorTypes` in the vendor SDK is `["totp", "phone", "webauthn"]`, and we
 * offer two of them. A `phone` factor — or anything the platform adds later —
 * would fall through a two-branch check and render as "no second factor",
 * which is the most dangerous possible wrong answer: it invites somebody to
 * turn on a factor they already have, or to believe their account is
 * unprotected when it is not. So the fallback is a true general sentence
 * rather than a guess about which device holds the key.
 */

/** The factor kinds this product enrols and can name specifically. */
export const NAMED_MFA_FACTOR_TYPES = ["webauthn", "totp"] as const;

export type NamedMfaFactorType = (typeof NAMED_MFA_FACTOR_TYPES)[number];

/**
 * The four sentences, as catalogue keys. Every client holds all four in both
 * languages; a client missing one renders the key, which is why the parity
 * guards assert this exact set.
 */
export const MFA_SUMMARY_KEYS = [
  "settingsMore.tfaBothOn",
  "settingsMore.tfaPasskeyOn",
  "settingsMore.tfaAuthenticatorOn",
  "settingsMore.tfaOn",
] as const;

export type MfaSummaryKey = (typeof MFA_SUMMARY_KEYS)[number];

/** Whether the enrolled set includes a passkey. */
export function hasPasskeyFactor(factorTypes: readonly (string | null)[]): boolean {
  return factorTypes.includes("webauthn");
}

/** Whether the enrolled set includes an authenticator app. */
export function hasAuthenticatorFactor(
  factorTypes: readonly (string | null)[],
): boolean {
  return factorTypes.includes("totp");
}

/**
 * The sentence to show somebody who already has at least one factor.
 *
 * Callers pass the raw `factors[].type` values from `GET /v1/mfa`; a null or
 * unrecognised entry counts as a factor that exists but cannot be named, which
 * is what the general sentence is for.
 */
export function mfaSummaryKey(
  factorTypes: readonly (string | null)[],
): MfaSummaryKey {
  const passkey = hasPasskeyFactor(factorTypes);
  const authenticator = hasAuthenticatorFactor(factorTypes);
  if (passkey && authenticator) return "settingsMore.tfaBothOn";
  if (passkey) return "settingsMore.tfaPasskeyOn";
  if (authenticator) return "settingsMore.tfaAuthenticatorOn";
  return "settingsMore.tfaOn";
}

/**
 * Which kind is still missing, so the card can offer exactly that one.
 *
 * Empty for somebody who holds both — an option that does not apply is absent
 * rather than disabled — and empty for somebody with no factors at all, who
 * gets the first-time pitch rather than an "add another" affordance.
 *
 * Somebody holding only an unnamed kind (a `phone` factor) is offered BOTH,
 * which is the true answer: they have neither of the two this product enrols.
 */
export function missingMfaFactorTypes(
  factorTypes: readonly (string | null)[],
): NamedMfaFactorType[] {
  if (factorTypes.length === 0) return [];
  return NAMED_MFA_FACTOR_TYPES.filter((type) => !factorTypes.includes(type));
}
