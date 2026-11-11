import { capabilityActions, defineMachine } from "./define-machine";

/**
 * The mapping between one task and one provider event. Written only by SQL
 * (api_apply_calendar_provider_snapshot, api_mark_calendar_conflict,
 * api_mark_calendar_event_removed, api_mark_calendar_refusal,
 * api_resolve_calendar_*); an unlinked row is reused when the task is linked
 * again, hence unlinked to active.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type CalendarLinkState = "active" | "conflict" | "event_removed" | "refused" | "unlinked";

/** The mapping between one task and one provider event. */
export const calendarLinkMachine = defineMachine<CalendarLinkState>({
  id: "calendar_link",
  authority: "internal",
  db: {
    kind: "check",
    columns: [{ table: "task_calendar_links", column: "link_state" }],
  },
  states: ["active", "conflict", "event_removed", "refused", "unlinked"],
  initial: ["active", "conflict"],
  transitions: {
    active: ["conflict", "event_removed", "refused", "unlinked"],
    conflict: ["active", "unlinked"],
    // The provider can refuse a link whose event is already gone.
    event_removed: ["active", "refused", "unlinked"],
    refused: ["active", "event_removed", "unlinked"],
    unlinked: ["active"],
  },
  entryEffects: {
    conflict: ["cancel_queued_outbox", "surface_conflict"],
    event_removed: ["cancel_queued_outbox", "surface_removed_event"],
    refused: ["cancel_queued_outbox", "record_refusal"],
  },
  actions: capabilityActions<CalendarLinkState>({
    conflict: [{ action: "resolve_conflict", capability: "conversations.note" }],
    event_removed: [{ action: "resolve_event_removed", capability: "conversations.note" }],
  }),
});
