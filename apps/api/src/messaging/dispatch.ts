/**
 * Telnyx event dispatch (SPEC §7): payloads dispatch on `data.event_type`.
 * Shared by the /webhooks/telnyx route (waitUntil path) and the §11 webhook
 * sweeper (ledger replay path), so both run the exact same logic.
 */
import { recordVoiceCost } from "../billing/provider-costs";
import {
  dispatchInboundCallEvent,
  shouldRouteToDO,
} from "../calls/webhook-router";
import { getDb } from "../db";
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
  if (eventType === "call.cost") {
    // #216: a BILLING event, not a call-state event — it must NEVER route to the
    // Durable Object (it would only wake/instantiate it for a no-op). The live
    // edge (webhooks/telnyx.ts) records it on the fast path; recording here too
    // (idempotent via the provider_costs PK) makes the §11 sweeper a RECOVERY
    // path — a call.cost whose live record/stamp was lost (transient stamp
    // failure, isolate eviction → row left processed_at NULL) is re-recorded on
    // replay rather than mis-routed into the DO. MUST precede the call.* branch.
    await recordVoiceCost(
      getDb(env),
      event.data?.payload,
      typeof event.data?.occurred_at === "string"
        ? event.data.occurred_at
        : null,
    );
    return;
  }
  if (eventType.startsWith("call.")) {
    // Calls v3 (#170 §7.2): every inbound and outbound CALL is a CallSessionDO
    // session. This branch is the SWEEPER-replay path (the edge admits live
    // events directly); a replay re-enters the DO and no-ops on dedup / guards or
    // resumes an unfinished journal (§4.1). Only the consult/transfer legs
    // (brc/brt) are not full DO sessions — they attach to a live one and run on
    // the shared voice path below.
    if (shouldRouteToDO(event)) {
      await dispatchInboundCallEvent(env, event);
      return;
    }
    // The consult/transfer (brc/brt) leg webhooks (§7.2, review R2-B3).
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
