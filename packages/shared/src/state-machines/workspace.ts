import { capabilityActions, defineMachine } from "./define-machine";

/**
 * A workspace's lifecycle, derived from paused_at, deleted_at and purged_at on
 * companies. Pause leaves subscription_status active on purpose
 * (billing/pause.ts); closure sets deleted_at and purge_after
 * (20260726000400_workspace_closure.sql), reopen_workspace clears them within
 * the grace window, and purge_workspace_step erases the data and stamps
 * purged_at.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type WorkspaceState = "active" | "paused" | "closed" | "purged";

/**
 * The state of a companies row, from the same three columns as the SQL
 * function workspace_state (purged beats closed beats paused).
 */
export function workspaceState(row: {
  paused_at?: string | null;
  deleted_at?: string | null;
  purged_at?: string | null;
}): WorkspaceState {
  if (row.purged_at) return "purged";
  if (row.deleted_at) return "closed";
  if (row.paused_at) return "paused";
  return "active";
}

/** A workspace's lifecycle, derived from paused_at, deleted_at and purged_at on companies. */
export const workspaceMachine = defineMachine<WorkspaceState>({
  id: "workspace",
  authority: "derived",
  db: {
    kind: "none",
    columns: [{ table: "companies", column: "paused_at" }, { table: "companies", column: "deleted_at" }, { table: "companies", column: "purged_at" }],
    note: "derived from paused_at, deleted_at and purged_at timestamps",
  },
  states: ["active", "paused", "closed", "purged"],
  initial: ["active"],
  transitions: {
    active: ["paused", "closed"],
    paused: ["active", "closed"],
    closed: ["active", "purged"],
    purged: [],
  },
  entryEffects: {
    paused: ["swap_to_pause_price"],
    closed: ["cancel_subscription", "send_closure_receipt"],
    purged: ["erase_workspace_data", "send_purge_receipt"],
  },
  actions: capabilityActions<WorkspaceState>({
    active: [{ action: "pause", capability: "billing.manage" }, { action: "close", capability: "workspace.own" }],
    paused: [{ action: "resume", capability: "billing.manage" }, { action: "close", capability: "workspace.own" }],
  }),
});
