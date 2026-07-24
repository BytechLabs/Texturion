/**
 * #129 pure call-display helpers — no API/client imports, so timeline lines
 * and tests can use them without dragging the env-validated fetch client in.
 */

/** "4m 32s" / "58s" — talk time for answered calls (never ring time). */
export function formatCallDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes === 0) return `${rest}s`;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/** The row's plain-language outcome line. D38: outbound calls speak from
 *  the crew's side ("You called…"; a customer no-answer is "No answer",
 *  never "Missed" — nothing was missed by the crew). A null outcome is a
 *  session still in flight — say so ("Calling…" / "In progress"), never the
 *  meaningless bare "Call" (#133). */
export function callOutcomeLabel(call: {
  outcome: "answered" | "voicemail" | "missed" | null;
  direction?: "inbound" | "outbound";
  forward_seconds: number;
  /** #191: the acting member's resolved name — the placer of an outbound call,
   *  the answerer of an inbound one. Names WHO on an answered call so a crew's
   *  log doesn't mis-attribute every member's call to the viewer. */
  answered_by_name?: string | null;
}): string {
  const outbound = call.direction === "outbound";
  const dur =
    call.forward_seconds > 0 ? ` · ${formatCallDuration(call.forward_seconds)}` : "";
  const actor = call.answered_by_name ?? null;
  switch (call.outcome) {
    case "missed":
      return outbound ? "No answer" : "Missed";
    case "voicemail":
      return "Voicemail";
    case "answered":
      if (outbound) {
        // "Sam called" when the placer is known; "You called" (crew's-side
        // framing) for legacy/pre-#211 rows that carry no placer.
        return `${actor ? `${actor} called` : "You called"}${dur}`;
      }
      // "Answered by Sam" when the answerer is known; bare "Answered" otherwise.
      return `${actor ? `Answered by ${actor}` : "Answered"}${dur}`;
    default:
      return outbound ? "Calling…" : "In progress";
  }
}
