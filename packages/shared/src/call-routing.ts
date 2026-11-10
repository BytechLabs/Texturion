/**
 * #721: why an inbound call went where it went, decided once when it arrives
 * and stored on `calls.routing`. Before this, a call sent to voicemail unrung
 * left no trace but a missing ring.
 *
 * The order is the order the call machine checks them in (`transitions.ts`
 * T0 → T1d). `calls_routing_check` in the database allows exactly these.
 */
export const CALL_ROUTINGS = [
  "blocked",
  "line_busy",
  "screened",
  "after_hours",
  "paused",
  "over_cap",
  "nobody_reachable",
  "rang",
] as const;

export type CallRouting = (typeof CALL_ROUTINGS)[number];

export function isCallRouting(value: unknown): value is CallRouting {
  return (CALL_ROUTINGS as readonly unknown[]).includes(value);
}
