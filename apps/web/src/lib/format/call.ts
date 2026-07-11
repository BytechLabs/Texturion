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

/** The row's plain-language outcome line. */
export function callOutcomeLabel(call: {
  outcome: "answered" | "voicemail" | "missed" | null;
  forward_seconds: number;
}): string {
  switch (call.outcome) {
    case "missed":
      return "Missed";
    case "voicemail":
      return "Voicemail";
    case "answered":
      return call.forward_seconds > 0
        ? `Answered · ${formatCallDuration(call.forward_seconds)}`
        : "Answered";
    default:
      return "Call";
  }
}
