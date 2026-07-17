/**
 * Calls v3 (#170 §7.2) — the inbound-family webhook cutover. The Telnyx edge
 * route (webhooks/telnyx.ts) consults this to decide, per call.* event, whether
 * the CallSessionDO owns it (await-admission-before-ACK) or the legacy voice
 * path does (unchanged waitUntil dispatch).
 *
 * The DO owns the INBOUND family only: the customer's own leg (untagged
 * incoming initiated/hangup) and the legs WE dial for it (brm member rings) or
 * re-tag it into (bri answered, vmi voicemail). Everything else — outbound
 * (oc_*), and the consult/transfer legs (brc/brt), which keep their full D43
 * gates on the legacy path (§7.2, review R2-B3) — stays legacy.
 */
import type { Env } from "../env";
import { parseMemberRingState } from "../messaging/inbound-ring";
import type { TelnyxEvent } from "../messaging/types";

import { callsV3Active } from "./runtime";
import type { CallSessionDO } from "./session-do";

function decodePrefix(clientState: string | null | undefined): string | null {
  if (!clientState) return null;
  try {
    return atob(clientState).split("|")[0] ?? null;
  } catch {
    return null;
  }
}

/** True when the DO owns this call.* event (§7.2 inbound family). */
export function isInboundFamilyCallEvent(event: TelnyxEvent): boolean {
  const eventType = event.data?.event_type;
  if (!eventType || !eventType.startsWith("call.")) return false;
  const payload = (event.data?.payload ?? {}) as { client_state?: string | null; direction?: string };
  const prefix = decodePrefix(payload.client_state);
  if (prefix) {
    // brm (member ring) / bri (answered inbound) / vmi (voicemail inbound) are
    // the DO's; brc/brt/oc_* keep the legacy path.
    return prefix === "brm" || prefix === "bri" || prefix === "vmi";
  }
  // Untagged: inbound only. call.initiated for the customer leg is direction
  // 'incoming'; the customer's own hangup is untagged and inbound.
  if (eventType === "call.initiated") return payload.direction === "incoming";
  if (eventType === "call.hangup") return payload.direction !== "outgoing";
  return false;
}

/** The DO id key for an inbound-family event: the customer session (brm legs
 *  carry it in the tag; every other inbound leg in payload.call_session_id). */
export function sessionKeyFor(event: TelnyxEvent): string | null {
  const payload = (event.data?.payload ?? {}) as { client_state?: string | null; call_session_id?: string };
  const memberState = parseMemberRingState(payload.client_state);
  return memberState?.sessionId ?? payload.call_session_id ?? null;
}

/**
 * Admit an inbound-family event to its DO in the request path (§7.2). Returns
 * whether the edge should stamp processed_at — false only for the no-row
 * inbound-hangup case (§7.5.1). Callers guard on callsV3Active first.
 */
export async function dispatchInboundCallEvent(
  env: Env,
  event: TelnyxEvent,
): Promise<boolean> {
  const sessionId = sessionKeyFor(event);
  const namespace = env.CALL_SESSIONS;
  if (!sessionId || !namespace) return true; // unroutable → stamp + drop
  const stub = namespace.get(
    namespace.idFromName(sessionId),
  ) as unknown as CallSessionDO;
  return stub.onTelnyxEvent(event);
}

/** True when the v3 DO path should handle this event at the edge. */
export function shouldRouteToDO(env: Env, event: TelnyxEvent): boolean {
  return callsV3Active(env) && isInboundFamilyCallEvent(event);
}
