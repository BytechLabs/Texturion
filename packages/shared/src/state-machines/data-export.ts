import { capabilityActions, defineMachine } from "./define-machine";

/**
 * Workspace and history exports (export.ts). The build is resumable: each pass
 * can re-write running, which is why running has a self edge. reaped_at is a
 * separate timestamp for the sweep that deletes the bucket objects; it is not
 * a state.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type DataExportState = "pending" | "running" | "ready" | "failed";

export const dataExportMachine = defineMachine<DataExportState>({
  id: "data_export",
  description: "Workspace and history exports (export.ts).",
  authority: "internal",
  db: {
    kind: "check",
    columns: [{ table: "data_exports", column: "status" }],
  },
  states: ["pending", "running", "ready", "failed"],
  initial: ["pending"],
  transitions: {
    pending: ["running", "failed"],
    running: ["running", "ready", "failed"],
    ready: [],
    failed: [],
  },
  entryEffects: {
    ready: ["email_export_link"],
  },
  actions: capabilityActions<DataExportState>({
    ready: [{ action: "download", capability: "contacts.bulk" }],
  }),
});
