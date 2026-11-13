import type { MessageKey } from "@/i18n/translate";

/**
 * The moves the menu offers, and why these.
 *
 * Not a full date picker. WCAG 2.5.7 asks for a way to do the DRAG without
 * dragging, and on a calendar the drag people actually perform is "this job
 * slipped, push it". Three relative moves cover that in one click; an
 * arbitrary date is still reachable by dragging or from the task itself, so
 * nothing is lost by keeping this list short enough to read.
 */
export const RESCHEDULE_MOVES: readonly {
  labelKey: MessageKey;
  days: number;
}[] = [
  { labelKey: "tasks.rescheduleDayEarlier", days: -1 },
  { labelKey: "tasks.rescheduleDayLater", days: 1 },
  { labelKey: "tasks.rescheduleWeekLater", days: 7 },
];

/**
 * The new instant for a move, keeping the time of day.
 *
 * The same rule the drop handler follows: dragging a chip to another cell
 * moves the DATE and leaves the appointment time alone, and a menu that reset
 * every job to midnight would be a different operation wearing the same name.
 */
export function movedDueAt(dueAt: string | null, days: number, now: Date): string {
  const from = dueAt ? new Date(dueAt) : now;
  const next = new Date(from);
  next.setDate(next.getDate() + days);
  return next.toISOString();
}
