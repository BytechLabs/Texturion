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
}): string {
  const outbound = call.direction === "outbound";
  switch (call.outcome) {
    case "missed":
      return outbound ? "No answer" : "Missed";
    case "voicemail":
      return "Voicemail";
    case "answered":
      if (outbound) {
        return call.forward_seconds > 0
          ? `You called · ${formatCallDuration(call.forward_seconds)}`
          : "You called";
      }
      return call.forward_seconds > 0
        ? `Answered · ${formatCallDuration(call.forward_seconds)}`
        : "Answered";
    default:
      return outbound ? "Calling…" : "In progress";
  }
}
