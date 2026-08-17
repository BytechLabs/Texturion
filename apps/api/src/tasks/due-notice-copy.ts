/**
 * #228 — what a task reminder says, in the language its reader chose.
 *
 * The payload is composed per reader now (`PushDelivery.web` takes a `Locale`),
 * so a literal at the call site is an English lock screen on a French member's
 * phone. This is the alert that arrives while there is still time to drive, so
 * it is also the one most likely to be read without opening anything.
 *
 * Shaped so a MISSING TRANSLATION IS A TYPE ERROR: `Record<Locale, …>` over an
 * interface, so a new language will not compile until every line exists in it.
 *
 * A MEMBER'S OWN TASK TITLE IS NOT HERE, and that is the point of the two
 * titles that are. "Replace the outdoor tap at 5 King St" is their words and
 * passes through untranslated; `fallbackTitle` only stands in when there are no
 * words at all, and `withheldTitle` is the #430 replacement for a workspace
 * that has asked us to keep content off lock screens.
 */
import type { Locale } from "@loonext/shared";

interface TaskDueCopy {
  /** Ours, for a task whose title is missing or trims to nothing. */
  fallbackTitle: string;
  /**
   * #430: what a reader sees instead of the real title. A task title routinely
   * holds a job address, so the reminder keeps the WHEN in the body and gives
   * up the WHERE.
   */
  withheldTitle: string;
  /** The deadline is still ahead. Relative, so it needs no timezone. */
  dueInMinutes(minutes: number): string;
  /** Within a minute either side of the deadline. */
  dueNow: string;
  /** Under an hour late. */
  minutesOverdue(late: number): string;
  /** An hour to a day late. */
  hoursOverdue(hours: number): string;
  /** A day or more late — capped at 24h by TASK_DUE_MAX_LATE_MINUTES. */
  daysOverdue(days: number): string;
}

const EN: TaskDueCopy = {
  fallbackTitle: "A task",
  withheldTitle: "A task is due",
  dueInMinutes: (minutes) => `Due in ${minutes} min`,
  dueNow: "Due now",
  minutesOverdue: (late) => `${late} min overdue`,
  hoursOverdue: (hours) => `${hours} ${hours === 1 ? "hour" : "hours"} overdue`,
  daysOverdue: (days) => `${days} ${days === 1 ? "day" : "days"} overdue`,
};

/**
 * Quebec French.
 *
 * "échéance" is the house word for a due date (apps/web/src/i18n/sections/
 * tasks.ts `due`, `dueToday`) and "de retard" pairs with its `overdue`
 * ("En retard"), so the four branches below read as one vocabulary rather than
 * four separate decisions. "Une tâche arrive à échéance" is 27 characters,
 * inside the ~40 a phone will show of a title.
 *
 * The number stays first in the two overdue lines, matching the English shape,
 * and the singular/plural noun is picked inline exactly as the English does —
 * French agrees the same way here ("1 heure de retard" / "3 heures de retard").
 * "min" is invariable, so the minutes branches need no plural at all.
 */
const FR_CA: TaskDueCopy = {
  fallbackTitle: "Une tâche",
  withheldTitle: "Une tâche arrive à échéance",
  dueInMinutes: (minutes) => `Échéance dans ${minutes} min`,
  dueNow: "Échéance maintenant",
  minutesOverdue: (late) => `${late} min de retard`,
  hoursOverdue: (hours) =>
    `${hours} ${hours === 1 ? "heure" : "heures"} de retard`,
  daysOverdue: (days) => `${days} ${days === 1 ? "jour" : "jours"} de retard`,
};

export const TASK_DUE_COPY: Record<Locale, TaskDueCopy> = {
  en: EN,
  "fr-CA": FR_CA,
};
