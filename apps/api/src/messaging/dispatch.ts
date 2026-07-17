/**
 * Telnyx event dispatch (SPEC §7): payloads dispatch on `data.event_type`.
 * Shared by the /webhooks/telnyx route (waitUntil path) and the §11 webhook
 * sweeper (ledger replay path), so both run the exact same logic.
 */
import {
  dispatchInboundCallEvent,
  shouldRouteToDO,
} from "../calls/webhook-router";
import type { Env } from "../env";
import { handlePortingEvent } from "../telnyx/porting";
import { handle10dlcEvent } from "../telnyx/registration";
import { handleInboundMessage } from "./inbound";
import { handleStatusEvent } from "./status";
import { handleCallEvent } from "./voice-webhook";
import type { TelnyxEvent } from "./types";

export async function dispatchTelnyxEvent(
  env: Env,
  event: TelnyxEvent,
): Promise<void> {
  const eventType = event.data?.event_type;
  if (typeof eventType !== "string") return; // unknown shape → acked no-op

  if (eventType === "message.received") {
    return handleInboundMessage(env, event);
  }
  if (eventType === "message.sent" || eventType === "message.finalized") {
    return handleStatusEvent(env, event);
  }
  if (eventType.startsWith("call.")) {
    // Calls v3 (#170 §7.2): under v3, inbound-family call.* events are owned by
    // the CallSessionDO. This branch is the SWEEPER-replay path (the edge admits
    // live events directly); a replay re-enters the DO and no-ops on dedup /
    // guards or resumes an unfinished journal (§4.1). Outbound + consult/transfer
    // (brc/brt) legs, and everything under the kill switch, keep the legacy path.
    if (shouldRouteToDO(env, event)) {
      await dispatchInboundCallEvent(env, event);
      return;
    }
    // FEATURE-GAPS voice wave: inbound Call-Control events for the missed-call
    // text-back. Compute-missed → text-back through the shared auto-send guard.
    return handleCallEvent(env, event);
  }
  if (eventType.startsWith("10dlc.")) {
    // Cross-track contract: the registration state machine (telnyx track).
    return handle10dlcEvent(env, event);
  }
  if (eventType.startsWith("porting_order.")) {
    // PORTING.md §5.1: the port-in state machine. This single branch also
    // covers the §11 webhook sweeper, which re-drives ledgered rows through
    // this exact dispatcher.
    return handlePortingEvent(env, event);
  }
  // Unknown event_type → acked no-op (§7).
}
