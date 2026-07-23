/**
 * Calls v3 (#170 §7.2, #211) — the SESSION-family webhook cutover. The Telnyx
 * edge route (webhooks/telnyx.ts) consults this to decide, per call.* event,
 * whether the CallSessionDO owns it (await-admission-before-ACK) or the legacy
 * voice path does (unchanged waitUntil dispatch).
 *
 * The DO owns two session families:
 *   - INBOUND: the customer's own leg (untagged incoming initiated/hangup) and
 *     the legs WE dial for it (brm member rings) or re-tag it into (bri
 *     answered, vmi voicemail).
 *   - OUTBOUND (#211): a 4-part `oc_customer|<customer>|<nonce>|<S>` leg whose
 *     part-4 (S) is a well-formed UUID, keyed on part-4 for ALL THREE lifecycle
 *     events (initiated/answered/hangup), but ONLY when callsOutboundV3Active
 *     (the DO keys idFromName on the caller-supplied part-4, so this must stay
 *     dark until the outbound flag is on, else a forged part-4 = a victim's live
 *     S would route to the victim's DO). Routing on part-4 (not Telnyx's
 *     call_session_id, which differs for outbound) is what keeps the DO id, the
 *     calls-row PK, and the client's id one value (the ONE-id invariant).
 *
 * Everything else stays legacy: 3-part oc (deploy-boundary / kill-switch), and
 * the consult/transfer legs (brc/brt), which keep their full D43 gates on the
 * legacy path (§7.2, review R2-B3).
 */
import * as Sentry from "@sentry/cloudflare";

import type { Env } from "../env";
import { parseMemberRingState } from "../messaging/inbound-ring";
import { parseOutboundSessionId } from "../messaging/voice-webhook";
import type { TelnyxEvent } from "../messaging/types";

import { callsOutboundV3Active, callsV3Active } from "./runtime";
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
export function isSessionFamilyCallEvent(event: TelnyxEvent, env: Env): boolean {
  const eventType = event.data?.event_type;
  if (!eventType || !eventType.startsWith("call.")) return false;
  const payload = (event.data?.payload ?? {}) as { client_state?: string | null; direction?: string };
  // #211 SECURITY (call-hijack fix): a 4-part oc_customer leg (part-4 = a
  // well-formed UUID = S) is DO-owned for ALL THREE lifecycle events
  // (initiated/answered/hangup) ONLY when the OUTBOUND flag is live. Gating on
  // callsOutboundV3Active (NOT merely callsV3Active) is LOAD-BEARING: the DO
  // keys idFromName on the CALLER-supplied part-4, so a forged 4-part tag that
  // carries a VICTIM's live session id S_v must NEVER route to idFromName(S_v)
  // while outbound-v3 is dark. With the flag OFF a crafted 4-part tag falls to
  // the LEGACY path, which authorizes on the single-use nonce (unforgeable) and
  // never binds a tenant from a caller-controlled session id. Checked FIRST and
  // by ARITY (a 3-part oc leg has no valid part-4 and stays legacy, so a
  // deploy-boundary / kill-switch call never splits between the DO and legacy).
  if (callsOutboundV3Active(env) && parseOutboundSessionId(payload.client_state)) {
    return true;
  }
  const prefix = decodePrefix(payload.client_state);
  if (prefix) {
    // brm (member ring) / bri (answered inbound) / vmi (voicemail inbound) are
    // the DO's; brc/brt and 3-part oc_* keep the legacy path.
    return prefix === "brm" || prefix === "bri" || prefix === "vmi";
  }
  // Untagged: inbound only. call.initiated for the customer leg is direction
  // 'incoming'; the customer's own hangup is untagged and inbound.
  if (eventType === "call.initiated") return payload.direction === "incoming";
  if (eventType === "call.hangup") return payload.direction !== "outgoing";
  return false;
}

/** @deprecated #211 renamed to {@link isSessionFamilyCallEvent} (the DO now owns
 *  the outbound oc session family too). Kept as an alias for existing callers. */
export const isInboundFamilyCallEvent = isSessionFamilyCallEvent;

/** The DO id key for a session-family event: brm legs carry S in the tag; a
 *  #211 4-part oc leg carries S as tag part-4 (UUID-validated) — NEVER Telnyx's
 *  call_session_id (which differs for outbound); every other inbound leg keys on
 *  payload.call_session_id (inbound's S IS Telnyx's id). */
export function sessionKeyFor(event: TelnyxEvent, env: Env): string | null {
  const payload = (event.data?.payload ?? {}) as { client_state?: string | null; call_session_id?: string };
  const memberState = parseMemberRingState(payload.client_state);
  // #211 SECURITY: only key on the oc part-4 (S) when outbound-v3 is live. With
  // the flag OFF a 4-part tag is not DO-routed at all (isSessionFamilyCallEvent),
  // so this branch never fires for it, but gate it here too (defense in depth)
  // so a caller-supplied part-4 can never become an idFromName under a dark flag.
  const outboundSession = callsOutboundV3Active(env)
    ? parseOutboundSessionId(payload.client_state)
    : null;
  return memberState?.sessionId ?? outboundSession ?? payload.call_session_id ?? null;
}

/**
 * Admit a session-family event to its DO in the request path (§7.2). Returns
 * whether the edge should stamp processed_at — false only for the no-row
 * inbound/oc-hangup case (§7.5.1). Callers guard on callsV3Active first.
 */
export async function dispatchInboundCallEvent(
  env: Env,
  event: TelnyxEvent,
): Promise<boolean> {
  const namespace = env.CALL_SESSIONS;
  if (!namespace) return true; // binding absent (guarded upstream) → stamp + drop
  const sessionId = sessionKeyFor(event, env);
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

/** True when the v3 DO path should handle this event at the edge. */
export function shouldRouteToDO(env: Env, event: TelnyxEvent): boolean {
  return callsV3Active(env) && isSessionFamilyCallEvent(event, env);
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
