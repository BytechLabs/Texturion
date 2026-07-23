/**
 * Calls v3 (#170 §7.2, #211) — the SESSION-family webhook cutover. The Telnyx
 * edge route (webhooks/telnyx.ts) consults this to decide, per call.* event,
 * whether the CallSessionDO owns it (await-admission-before-ACK) or the shared
 * consult/transfer voice path does (unchanged waitUntil dispatch). The DO is
 * the ONE and only path for every inbound and outbound CALL — there is no
 * legacy fall-through and no flag.
 *
 * The DO owns two session families:
 *   - INBOUND: the customer's own leg (untagged incoming initiated/hangup) and
 *     the legs WE dial for it (brm member rings) or re-tag it into (bri
 *     answered, vmi voicemail).
 *   - OUTBOUND (#211): a 4-part `oc_customer|<customer>|<nonce>|<S>` leg whose
 *     part-4 (S) is a well-formed UUID, keyed on part-4 for ALL THREE lifecycle
 *     events (initiated/answered/hangup). Routing on part-4 (not Telnyx's
 *     call_session_id, which differs for outbound) is what keeps the DO id, the
 *     calls-row PK, and the client's id one value (the ONE-id invariant).
 *
 * SECURITY — the call-hijack defense does NOT live here. The DO keys idFromName
 * on the CALLER-supplied part-4, so a forged 4-part tag carrying a VICTIM's live
 * session id S_v DOES route to idFromName(S_v). The hijack is closed downstream
 * at runtime.loadOutboundInitiatedContext: the single-use nonce is unforgeable,
 * the RPC replay branch is authorization-scoped to an outbound row matching the
 * presented business number, the customer_call_control_id stamp is set-once, and
 * the one-id gate rejects a returned PK != part-4. A crafted tag lands on the
 * victim's DO and is dropped/rejected with no mint and no stamp.
 *
 * The consult/transfer legs (brc/brt) are NOT full DO sessions; they attach to
 * a live session and keep their D43 gates on the shared voice path (§7.2,
 * review R2-B3).
 */
import * as Sentry from "@sentry/cloudflare";

import type { Env } from "../env";
import { parseMemberRingState } from "../messaging/inbound-ring";
import {
  parseOutboundPlacerState,
  parseOutboundSessionId,
} from "../messaging/voice-webhook";
import type { TelnyxEvent } from "../messaging/types";

import type { CallSessionDO } from "./session-do";

function decodePrefix(clientState: string | null | undefined): string | null {
  if (!clientState) return null;
  try {
    return atob(clientState).split("|")[0] ?? null;
  } catch {
    return null;
  }
}

/** True when the DO owns this call.* event (§7.2 inbound family + #211
 *  outbound oc sessions). */
export function isSessionFamilyCallEvent(event: TelnyxEvent): boolean {
  const eventType = event.data?.event_type;
  if (!eventType || !eventType.startsWith("call.")) return false;
  const payload = (event.data?.payload ?? {}) as { client_state?: string | null; direction?: string };
  // #211: a 4-part oc_customer leg (part-4 = a well-formed UUID = S) is DO-owned
  // for ALL THREE lifecycle events (initiated/answered/hangup), keyed on part-4.
  // The DO keys idFromName on the CALLER-supplied part-4, so a forged 4-part tag
  // carrying a VICTIM's live session id S_v DOES route to idFromName(S_v) — the
  // hijack is closed at loadOutboundInitiatedContext (single-use nonce consume +
  // auth-scoped RPC replay + set-once stamp + one-id gate), NEVER by a routing
  // flag. Checked FIRST and by ARITY (a leg with no valid part-4 falls through to
  // the prefix / direction rules).
  if (parseOutboundSessionId(payload.client_state)) {
    return true;
  }
  // #213: the placer (op) leg — a server-dialed leg carrying `op|S|userId` — is
  // DO-owned for its answered/hangup (and its initiated no-op), keyed on S.
  if (parseOutboundPlacerState(payload.client_state)) {
    return true;
  }
  const prefix = decodePrefix(payload.client_state);
  if (prefix) {
    // brm (member ring) / bri (answered inbound) / vmi (voicemail inbound) are
    // the DO's; brc/brt (consult/transfer) attach to a live session on the
    // shared voice path.
    return prefix === "brm" || prefix === "bri" || prefix === "vmi";
  }
  // Untagged: inbound only. call.initiated for the customer leg is direction
  // 'incoming'; the customer's own hangup is untagged and inbound.
  if (eventType === "call.initiated") return payload.direction === "incoming";
  if (eventType === "call.hangup") return payload.direction !== "outgoing";
  return false;
}

/** The DO id key for a session-family event: brm legs carry S in the tag; a
 *  #211 4-part oc leg carries S as tag part-4 (UUID-validated) — NEVER Telnyx's
 *  call_session_id (which differs for outbound); every other inbound leg keys on
 *  payload.call_session_id (inbound's S IS Telnyx's id). */
export function sessionKeyFor(event: TelnyxEvent): string | null {
  const payload = (event.data?.payload ?? {}) as { client_state?: string | null; call_session_id?: string };
  const memberState = parseMemberRingState(payload.client_state);
  // #211: a 4-part oc leg keys on tag part-4 (S), NEVER Telnyx's call_session_id
  // (which differs for outbound). brm keys on the tag's embedded session; every
  // other inbound leg keys on payload.call_session_id (inbound's S IS Telnyx's id).
  const outboundSession = parseOutboundSessionId(payload.client_state);
  // #213: the op placer leg keys on the tag's part-2 (S).
  const placerSession = parseOutboundPlacerState(payload.client_state)?.sessionId;
  return (
    memberState?.sessionId ??
    outboundSession ??
    placerSession ??
    payload.call_session_id ??
    null
  );
}

/**
 * Admit a session-family event to its DO in the request path (§7.2). Returns
 * whether the edge should stamp processed_at — false only for the no-row
 * inbound/oc-hangup case (§7.5.1).
 */
export async function dispatchInboundCallEvent(
  env: Env,
  event: TelnyxEvent,
): Promise<boolean> {
  const namespace = env.CALL_SESSIONS;
  if (!namespace) return true; // binding absent (deployment invariant) → stamp + drop
  const sessionId = sessionKeyFor(event);
  if (!sessionId) {
    // A session-family event with no usable key (e.g. a tag whose part-4 failed
    // UUID validation, or an event carrying no session id at all). NEVER
    // idFromName a malformed/absent key onto an arbitrary DO — drop + Sentry
    // (the §7.5.1 sweeper-replay only helps a keyable no-row hangup).
    Sentry.captureMessage(
      `#211 dispatch: session-family ${event.data?.event_type} with no usable ` +
        `session key — dropped (unroutable)`,
      "warning",
    );
    return true;
  }
  const stub = namespace.get(
    namespace.idFromName(sessionId),
  ) as unknown as CallSessionDO;
  return stub.onTelnyxEvent(event);
}

/** True when the DO path should handle this event at the edge. v3 is the sole
 *  path, so this is exactly "is this a session-family call event". */
export function shouldRouteToDO(event: TelnyxEvent): boolean {
  return isSessionFamilyCallEvent(event);
}

/**
 * #211 echo-drop tripwire: Telnyx normally echoes client_state on EVERY event
 * of a leg, so the whole oc family (legacy + v3) leans on it. If the echo drops
 * on a sweeper- or carrier-error hangup, an oc terminal lands untagged AND with
 * no direction — un-attributable to a session. That never wedges anything (it
 * still routes by the direction rules / falls to the 4h sweeper), but it means a
 * terminal that should have been S-keyed was not, so it is worth a breadcrumb.
 * Pure observability — no behavior change.
 */
export function warnIfEchoDropped(event: TelnyxEvent): void {
  if (event.data?.event_type !== "call.hangup") return;
  const payload = (event.data?.payload ?? {}) as {
    client_state?: string | null;
    direction?: string;
  };
  if (decodePrefix(payload.client_state) || payload.direction) return;
  Sentry.captureMessage(
    "#211 echo-drop tripwire: call.hangup with neither a recognized client_state " +
      "tag nor a direction — an oc terminal whose echo dropped would land here " +
      "un-attributable (falls to the direction rules / the 4h sweeper)",
    "warning",
  );
}
