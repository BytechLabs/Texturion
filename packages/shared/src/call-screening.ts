/**
 * Did Telnyx's inbound screening flag this caller (#721)?
 *
 * Telnyx documents one verdict: a flagged call carries `spam_likely`, either as
 * the whole `call_screening_result` or inside it, and its caller name reads
 * "SPAM LIKELY" (support.telnyx.com, "Inbound Call Screening", read
 * 2026-11-10). Every result also echoes our own mode back as
 * `"action":"flag_calls"`, which is configuration, not a verdict; matching the
 * word "flag" in it marked every call as spam. The `reputation` score has no
 * documented scale, so it is not read.
 *
 * Anything unrecognised is clean: a missed flag rings a scam once, a false one
 * sends a customer to voicemail.
 *
 * The Kotlin and Swift ports are checked against `vectors/call-screening.json`.
 */

const SPAM_LIKELY = "spam_likely";

function isSpamLikelyWord(value: string): boolean {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_") === SPAM_LIKELY;
}

function resultSaysSpamLikely(result: string): boolean {
  if (isSpamLikelyWord(result)) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return false;
  }
  if (typeof parsed === "string") return isSpamLikelyWord(parsed);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  return Object.entries(parsed as Record<string, unknown>).some(([key, value]) => {
    if (key === "action") return false;
    if (typeof value === "string") return isSpamLikelyWord(value);
    return value === true && isSpamLikelyWord(key);
  });
}

/** True only on Telnyx's explicit `spam_likely` verdict, in the result or the caller name. */
export function callLooksSpam(
  screeningResult: string | null | undefined,
  callerName?: string | null,
): boolean {
  if (screeningResult && resultSaysSpamLikely(screeningResult)) return true;
  return !!callerName && isSpamLikelyWord(callerName);
}
