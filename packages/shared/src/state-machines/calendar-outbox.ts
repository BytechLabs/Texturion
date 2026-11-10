import { defineMachine } from "./define-machine";

/**
 * The queue of writes to a member's calendar provider. queued to leased by
 * api_claim_calendar_outbox (which also re-leases a row whose lease expired,
 * hence the self edge); leased to completed, queued or cancelled by the commit
 * and retry RPCs.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type CalendarOutboxState = "queued" | "leased" | "completed" | "cancelled";

/** The queue of writes to a member's calendar provider. */
export const calendarOutboxMachine = defineMachine<CalendarOutboxState>({
  id: "calendar_outbox",
  authority: "internal",
  db: {
    kind: "check",
    columns: [{ table: "calendar_outbox", column: "state" }],
  },
  states: ["queued", "leased", "completed", "cancelled"],
  initial: ["queued"],
  transitions: {
    queued: ["leased", "completed", "cancelled"],
    leased: ["leased", "queued", "completed", "cancelled"],
    completed: [],
    cancelled: [],
  },
  entryEffects: {
    completed: ["stamp_completed_at"],
    cancelled: ["stamp_cancelled_at"],
  },
});
