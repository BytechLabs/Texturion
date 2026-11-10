import { DEFAULT_LOCALE, type CallRouting } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";

import { formatCallDuration } from "./call-duration";

/**
 * #129 pure call-display helpers — no API/client imports, so timeline lines
 * and tests can use them without dragging the env-validated fetch client in.
 */

export { formatCallDuration };

/** #721: why no phone rang, or null when the call rang (or predates the column). */
export function callRoutingReason(
  routing: CallRouting | null,
  t: Translate = makeTranslate(DEFAULT_LOCALE),
): string | null {
  switch (routing) {
    case "blocked":
      return t("misc.callRoutingBlocked");
    case "line_busy":
      return t("misc.callRoutingLineBusy");
    case "screened":
      return t("misc.callRoutingScreened");
    case "after_hours":
      return t("misc.callRoutingAfterHours");
    case "paused":
      return t("misc.callRoutingPaused");
    case "over_cap":
      return t("misc.callRoutingOverCap");
    case "nobody_reachable":
      return t("misc.callRoutingNobodyReachable");
    default:
      return null;
  }
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
    /** #721: where the call went when it arrived. */
    routing?: CallRouting | null;
  },
  t: Translate = makeTranslate(DEFAULT_LOCALE),
): string {
  const outbound = call.direction === "outbound";
  const dur =
    call.forward_seconds > 0 ? ` · ${formatCallDuration(call.forward_seconds)}` : "";
  const actor = call.answered_by_name ?? null;
  const reason = callRoutingReason(call.routing ?? null, t);
  const why = reason ? ` · ${reason}` : "";
  switch (call.outcome) {
    case "missed":
      return outbound ? t("misc.callNoAnswer") : `${t("misc.callMissed")}${why}`;
    case "voicemail":
      return `${t("misc.callVoicemail")}${why}`;
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
