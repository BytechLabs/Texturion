/**
 * #366 — what to say when the crew outgrows a single call's fan-out.
 *
 * Split from the card for the same reason `composer-banner.ts` and
 * `call-detail-copy.ts` are split from their renderers: importing the
 * component into a test drags the public-env validation in with it, which is a
 * poor reason to leave a copy decision untested.
 */
import type { PhoneNumberSummary } from "@/lib/api/types";

/**
 * #366: what to say when the crew outgrows a single call's fan-out.
 *
 * Null — say nothing — is the answer for almost every workspace, and that
 * matters: a line about a limit nobody is near is noise that trains people to
 * skip the card. The ceiling arrives from the server rather than being
 * hard-coded, so a client can never disagree with the engine about it.
 */
export function ringCeilingLine(number: PhoneNumberSummary): string | null {
  const targets = number.ring_targets;
  const limit = number.ring_target_limit;
  if (typeof targets !== "number" || typeof limit !== "number") return null;
  if (targets <= limit) return null;
  return (
    `${targets} people could be rung by a call to this number, and one call ` +
    `rings ${limit}. Everyone still takes turns — a different ${limit} ring ` +
    `each time — but nobody is rung on every call.`
  );
}
