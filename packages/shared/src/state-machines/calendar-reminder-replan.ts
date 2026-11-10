import { defineMachine } from "./define-machine";

/**
 * The queue that re-plans appointment reminders after a calendar change. Same
 * lease shape as the outbox.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type CalendarReminderReplanState = "queued" | "leased" | "completed" | "cancelled";

/** The queue that re-plans appointment reminders after a calendar change. */
export const calendarReminderReplanMachine = defineMachine<CalendarReminderReplanState>({
  id: "calendar_reminder_replan",
  authority: "internal",
  db: {
    kind: "check",
    columns: [{ table: "calendar_reminder_replans", column: "state" }],
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
