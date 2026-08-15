/**
 * Why a text did not arrive, in words the person reading the thread can act on.
 *
 * Every failed send except a carrier opt-out used to read "Not delivered",
 * which tells you nothing about whether to fix the number, wait, or stop
 * trying. The provider does tell us: it stores an error code on the row, and
 * the codes below are the ones a small business actually hits.
 *
 * Codes and their meanings come from Telnyx's messaging error reference. An
 * unknown or absent code keeps the old wording, because inventing a reason is
 * worse than admitting we do not have one.
 *
 * Twins, kept deliberately identical:
 *   apps/android/.../core/model/SendFailures.kt
 *   apps/ios/Loonext/Core/Model/SendFailures.swift
 */

/** The customer texted STOP: a carrier block only they can lift. */
export const CARRIER_OPT_OUT_ERROR_CODE = "40300";

/**
 * The fallback, and the whole of what a failed send used to say.
 *
 * #228: the KEY is the constant now, not the sentence. This module is rendered
 * by three clients and each has its own catalogue; a sentence here would be the
 * English one on all three, which is exactly what a French reader was getting
 * under a message bubble in an otherwise French app.
 */
export const GENERIC_SEND_FAILURE_KEY = "domain.sendFailureGeneric";

const SEND_FAILURE_KEYS = {
  // The recipient's own choice. Only they can undo it, by texting START.
  [CARRIER_OPT_OUT_ERROR_CODE]: "domain.sendFailureOptedOut",

  // Nothing on the other end can receive it.
  "40001": "domain.sendFailureUnreachable",
  "40012": "domain.sendFailureNotTextable",
  "40310": "domain.sendFailureNotTextable",

  // Carriers judged the content. Worth rewording and trying again in the
  // temporary cases; pointless in the permanent ones, so the wording differs.
  "40002": "domain.sendFailureBlockedNow",
  "40017": "domain.sendFailureBlockedNow",
  "40003": "domain.sendFailureSpam",
  "40015": "domain.sendFailureSpam",
  "40322": "domain.sendFailureSpam",

  // Volume, not content.
  "40011": "domain.sendFailureRateLimited",
  "40016": "domain.sendFailureRateLimited",
  "40018": "domain.sendFailureRateLimited",
  "40318": "domain.sendFailureRateLimited",

  // Their phone, momentarily.
  "40004": "domain.sendFailureHandsetRejected",
  "40006": "domain.sendFailureHandsetUnavailable",
  "40008": "domain.sendFailureHandsetUnavailable",

  // It sat too long to still be worth sending.
  "40005": "domain.sendFailureExpired",
  "40014": "domain.sendFailureExpired",

  // Something about the message itself.
  "40009": "domain.sendFailureContent",
  "40316": "domain.sendFailureEmpty",
  "40317": "domain.sendFailureAttachment",
  "40328": "domain.sendFailureTooLong",

  // Registration and number setup, which the owner can actually go and fix.
  "40010": "domain.sendFailureRegistration",
  "40329": "domain.sendFailureRegistration",
  "40330": "domain.sendFailureNumberNotReady",
  "40100": "domain.sendFailureNumberNotReady",
  "40314": "domain.sendFailureTextingOff",
  "40305": "domain.sendFailureNoSms",
  "40308": "domain.sendFailureNoMms",
} as const;

/**
 * Every key this module can name, as a type.
 *
 * The web's `t()` takes a key drawn from its catalogue, so typing the return
 * this way makes `tsc` prove the catalogue holds every one of them. A
 * `string` return would have needed a cast at the call site, and the cast
 * would have silenced the single error that matters: a key this module can
 * produce and the reader's catalogue cannot answer renders as its own name.
 */
export type SendFailureMessageKey =
  | typeof GENERIC_SEND_FAILURE_KEY
  | (typeof SEND_FAILURE_KEYS)[keyof typeof SEND_FAILURE_KEYS];

/**
 * The catalogue key for a failed send. Falls back to the plain "Not delivered"
 * key for a code we cannot explain honestly.
 *
 * Returns a KEY rather than a sentence because three clients render this and
 * each holds its own catalogue. The caller is the one that knows the reader's
 * language, and it is the only place that does.
 */
export function sendFailureMessageKey(
  errorCode: string | null | undefined,
): SendFailureMessageKey {
  if (!errorCode) return GENERIC_SEND_FAILURE_KEY;
  const code = errorCode.trim() as keyof typeof SEND_FAILURE_KEYS;
  return SEND_FAILURE_KEYS[code] ?? GENERIC_SEND_FAILURE_KEY;
}

/**
 * The table itself, for the parity test.
 *
 * Exported as data rather than left to be parsed out of this file, because one
 * of these entries is written with a computed key — `[CARRIER_OPT_OUT_ERROR_CODE]`
 * — and a test that read the source text would report the opt-out mapping
 * missing when it is the one mapping with a legal meaning.
 *
 * @internal No client should read the table; they call
 * {@link sendFailureMessageKey}, which is where the trimming and the fallback
 * live. A caller that indexed this directly would silently answer nothing for a
 * code stored with whitespace around it.
 */
export const SEND_FAILURE_KEYS_BY_CODE: Readonly<Record<string, SendFailureMessageKey>> =
  SEND_FAILURE_KEYS;

/** Every key this module can name — the parity test reads it. */
export const SEND_FAILURE_MESSAGE_KEYS: readonly SendFailureMessageKey[] = [
  GENERIC_SEND_FAILURE_KEY,
  ...new Set(Object.values(SEND_FAILURE_KEYS)),
];
