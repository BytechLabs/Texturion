/**
 * #366 — what to say when the crew outgrows a single call's fan-out.
 *
 * Split from the card for the same reason `composer-banner.ts` and
 * `call-detail-copy.ts` are split from their renderers: importing the
 * component into a test drags the public-env validation in with it, which is a
 * poor reason to leave a copy decision untested.
 */
import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";
import type { PhoneNumberSummary } from "@/lib/api/types";

/**
 * #366: what to say when the crew outgrows a single call's fan-out.
 *
 * Null — say nothing — is the answer for almost every workspace, and that
 * matters: a line about a limit nobody is near is noise that trains people to
 * skip the card. The ceiling arrives from the server rather than being
 * hard-coded, so a client can never disagree with the engine about it.
 */
export function ringCeilingLine(
  number: PhoneNumberSummary,
  /**
   * #228: defaulted to English so `ring-ceiling.test.ts` — which has no
   * provider and asserts the shipped sentence — keeps reading what it read.
   */
  t: Translate = makeTranslate(DEFAULT_LOCALE),
): string | null {
  const targets = number.ring_targets;
  const limit = number.ring_target_limit;
  if (typeof targets !== "number" || typeof limit !== "number") return null;
  if (targets <= limit) return null;
  return t("settingsMore.ringCeilingLine", { targets, limit });
}
