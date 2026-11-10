/**
 * What a task update says on a lock screen, in the reader's language (#228).
 *
 * Shaped like `due-notice-copy.ts`: `Record<Locale, …>` over an interface, so a
 * new language will not compile until every line exists in it.
 *
 * The task title and a comment are a member's own words and pass through
 * untranslated; everything here is ours. The title line says what happened and
 * who did it, because a phone on a bedside table shows one line.
 */
import type { Locale } from "@loonext/shared";

interface TaskNotifyCopy {
  /** Ours, for a task whose title trims to nothing. */
  taskFallback: string;
  /** Stands in for the member's words when the workspace keeps content off screens (#430). */
  withheldBody: string;
  unassignedTitle(actor: string): string;
  dueChangedTitle(actor: string): string;
  completedTitle(actor: string): string;
  reopenedTitle(actor: string): string;
  commentTitle(actor: string): string;
  mentionedTitle(actor: string): string;
  /** Overdue alert title when the task title is withheld. */
  overdueWithheldTitle: string;
}

const EN: TaskNotifyCopy = {
  taskFallback: "A task",
  withheldBody: "Open the app to see it",
  unassignedTitle: (actor) => `${actor} took you off a task`,
  dueChangedTitle: (actor) => `${actor} changed a task's time`,
  completedTitle: (actor) => `${actor} finished a task`,
  reopenedTitle: (actor) => `${actor} reopened a task`,
  commentTitle: (actor) => `${actor} commented on a task`,
  mentionedTitle: (actor) => `${actor} mentioned you on a task`,
  overdueWithheldTitle: "A task is overdue",
};

const FR_CA: TaskNotifyCopy = {
  taskFallback: "Une tâche",
  withheldBody: "Ouvrez l'application pour la voir",
  unassignedTitle: (actor) => `${actor} vous a retiré d'une tâche`,
  dueChangedTitle: (actor) => `${actor} a changé l'heure d'une tâche`,
  completedTitle: (actor) => `${actor} a terminé une tâche`,
  reopenedTitle: (actor) => `${actor} a rouvert une tâche`,
  commentTitle: (actor) => `${actor} a commenté une tâche`,
  mentionedTitle: (actor) => `${actor} vous a mentionné sur une tâche`,
  overdueWithheldTitle: "Une tâche est en retard",
};

export const TASK_NOTIFY_COPY: Record<Locale, TaskNotifyCopy> = {
  en: EN,
  "fr-CA": FR_CA,
};
