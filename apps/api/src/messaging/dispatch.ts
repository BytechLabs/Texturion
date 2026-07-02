/**
 * Telnyx event dispatch (SPEC §7): payloads dispatch on `data.event_type`.
 * Shared by the /webhooks/telnyx route (waitUntil path) and the §11 webhook
 * sweeper (ledger replay path), so both run the exact same logic.
 */
import type { Env } from "../env";
import { handle10dlcEvent } from "../telnyx/registration";
import { handleInboundMessage } from "./inbound";
import { handleStatusEvent } from "./status";
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
  if (eventType.startsWith("10dlc.")) {
    // Cross-track contract: the registration state machine (telnyx track).
    return handle10dlcEvent(env, event);
  }
  // Unknown event_type → acked no-op (§7).
}
