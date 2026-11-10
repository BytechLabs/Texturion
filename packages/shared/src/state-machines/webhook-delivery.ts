import { defineMachine } from "./define-machine";

/**
 * One outbound webhook delivery attempt chain (#243).
 * api_claim_webhook_deliveries flips pending to delivering and also re-claims
 * a delivering row whose backoff has elapsed (a worker died mid-send), which
 * is why delivering has a self edge. Backoff is next_attempt_at plus attempts;
 * webhookRetryDelaySeconds decides when to stop.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type WebhookDeliveryState = "pending" | "delivering" | "succeeded" | "failed";

export const webhookDeliveryMachine = defineMachine<WebhookDeliveryState>({
  id: "webhook_delivery",
  description: "One outbound webhook delivery attempt chain (#243).",
  authority: "internal",
  db: {
    kind: "check",
    columns: [{ table: "webhook_deliveries", column: "status" }],
  },
  states: ["pending", "delivering", "succeeded", "failed"],
  initial: ["pending"],
  transitions: {
    pending: ["delivering"],
    delivering: ["delivering", "pending", "succeeded", "failed"],
    succeeded: [],
    failed: [],
  },
});
