import { capabilityActions, defineMachine } from "./define-machine";

/**
 * A member's two-way calendar connection (#245, D137). disconnected does NOT
 * mean disconnected: it means disconnect requested, remote cleanup in progress
 * (calendar_begin_connection_disconnect). Connect only comes back after
 * revoked, which calendar_finalize_disconnected_connection writes once the
 * outbox is drained and every push subscription is revoked.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type CalendarConnectionState = "active" | "reauth_required" | "disconnected" | "revoked";

export const calendarConnectionMachine = defineMachine<CalendarConnectionState>({
  id: "calendar_connection",
  description: "A member's two-way calendar connection (#245, D137).",
  authority: "internal",
  db: {
    kind: "check",
    columns: [{ table: "calendar_connections", column: "status" }],
  },
  states: ["active", "reauth_required", "disconnected", "revoked"],
  initial: ["active"],
  transitions: {
    active: ["reauth_required", "disconnected", "revoked"],
    reauth_required: ["active", "disconnected", "revoked"],
    disconnected: ["revoked"],
    revoked: [],
  },
  entryEffects: {
    reauth_required: ["stop_pull_loop", "clear_pull_lease"],
    disconnected: ["cancel_queued_outbox", "revoke_push_subscriptions", "record_cleanup_action"],
    revoked: ["null_credentials", "stamp_revoked_at", "unlink_task_links"],
  },
  actions: capabilityActions<CalendarConnectionState>({
    active: [{ action: "disconnect", capability: "conversations.note" }],
    reauth_required: [{ action: "reconnect", capability: "conversations.note" }, { action: "disconnect", capability: "conversations.note" }],
    revoked: [{ action: "connect", capability: "conversations.note" }],
  }),
});
