import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";

/**
 * #129 pure call-display helpers — no API/client imports, so timeline lines
 * and tests can use them without dragging the env-validated fetch client in.
 */

/**
 * "58s" / "4m 32s" / "3h 3m" — talk time for answered calls (never ring time).
 *
 * #570: hours were missing, so a three-hour call read as "183m 12s". Nothing caps
 * talk time — the only timeouts in the call code bound RINGING (45s) and a transfer
 * (25s), not a connected call — so a crew member who leaves a call open, or a
 * customer walked through a repair on speaker, produces that today.
 *
 * Past an hour the seconds are dropped rather than carried. "3h 3m 12s" is three
 * facts where the reader wanted one, and nobody scanning a call log cares about the
 * seconds of a three-hour call. Under an hour they stay, because the difference
 * between 58s and 4m 32s is exactly what somebody IS scanning for.
 *
 * The live in-call clock (`formatTimer`) has always rolled over to `1:02:33`, so
 * before this the same call was described two different ways depending on whether
 * it was still happening.
 */
export function formatCallDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  if (hours > 0) return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  if (minutes === 0) return `${rest}s`;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/** The row's plain-language outcome line. D38: outbound calls speak from
 *  the crew's side ("You called…"; a customer no-answer is "No answer",
 *  never "Missed" — nothing was missed by the crew). A null outcome is a
 *  session still in flight — say so ("Calling…" / "In progress"), never the
 *  meaningless bare "Call" (#133).
 *
 *  #228: the words live in `i18n/sections/misc.ts` with the other formatters
 *  every list row reads. The DURATION is appended rather than interpolated
 *  because it is a number with a separator, not a clause — and it is the same
 *  "4m 32s" in both languages, since it comes off `formatCallDuration`. */
export function callOutcomeLabel(
  call: {
    outcome: "answered" | "voicemail" | "missed" | null;
    direction?: "inbound" | "outbound";
    forward_seconds: number;
    /** #191: the acting member's resolved name — the placer of an outbound call,
     *  the answerer of an inbound one. Names WHO on an answered call so a crew's
     *  log doesn't mis-attribute every member's call to the viewer. */
    answered_by_name?: string | null;
  },
  t: Translate = makeTranslate(DEFAULT_LOCALE),
): string {
  const outbound = call.direction === "outbound";
  const dur =
    call.forward_seconds > 0 ? ` · ${formatCallDuration(call.forward_seconds)}` : "";
  const actor = call.answered_by_name ?? null;
  switch (call.outcome) {
    case "missed":
      return outbound ? t("misc.callNoAnswer") : t("misc.callMissed");
    case "voicemail":
      return t("misc.callVoicemail");
    case "answered":
      if (outbound) {
        // "Sam called" when the placer is known; "You called" (crew's-side
        // framing) for legacy/pre-#211 rows that carry no placer.
        return `${
          actor ? t("misc.callPlacedBy", { name: actor }) : t("misc.callYouCalled")
        }${dur}`;
      }
      // "Answered by Sam" when the answerer is known; bare "Answered" otherwise.
      return `${
        actor ? t("misc.callAnsweredBy", { name: actor }) : t("misc.callAnswered")
      }${dur}`;
    default:
      return outbound ? t("misc.callCalling") : t("misc.callInProgress");
  }
}
