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
 *
 * Its own module because `call.ts` imports `@/i18n/provider`. A server
 * component importing `call.ts` makes the provider a client reference, and
 * Next ships it, with the whole two-language app catalogue, to that page. The
 * marketing thread demos need only this function.
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
