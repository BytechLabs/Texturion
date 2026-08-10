import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";
import type { TaskDetail } from "@/lib/api/types";

/** English, for a caller that has not been extracted yet. See `formatDue`. */
const EN = makeTranslate(DEFAULT_LOCALE);

/**
 * Delete-gating for the task detail panel (#89).
 *
 * Deleting a task is destructive and irreversible from the user's side (the API
 * soft-deletes — there is no restore UI). A brand-new task with nothing on it is
 * cheap to recreate, so it deletes without friction; a task that carries a
 * discussion (notes) or attached files is worth a confirmation first. Pure, so
 * the decision + the confirm phrasing are unit-tested without rendering.
 *
 * Note (D28): task events are always present (`task_created` at minimum), so
 * they do NOT count as content — only user-authored notes and attachments do.
 */
export interface TaskDeleteContent {
  notes: number;
  attachments: number;
  /** Whether to confirm before deleting (there is something to lose). */
  hasContent: boolean;
}

export function taskDeleteContent(
  task: Pick<TaskDetail, "activity" | "attachments">,
): TaskDeleteContent {
  const notes = task.activity.filter((item) => item.kind === "note").length;
  const attachments = task.attachments.length;
  return { notes, attachments, hasContent: notes > 0 || attachments > 0 };
}

/**
 * A short phrase naming what the task carries, for the confirm copy — e.g.
 * "3 notes and 2 files", "a note", "2 files". Empty when there is nothing (the
 * no-friction path, where no confirm is shown at all).
 *
 * #228: the singular and the plural are two catalogue entries rather than a
 * noun with an "s" bolted on, because that trick is English-only — French
 * agrees the count and the noun differently, and a language with more than two
 * number forms has nowhere to put them. `t` defaults to English so a caller
 * that has not been extracted yet keeps saying exactly what it said before.
 */
export function taskDeleteSummary(
  notes: number,
  attachments: number,
  t: Translate = EN,
): string {
  const parts: string[] = [];
  if (notes > 0) {
    parts.push(
      notes === 1
        ? t("tasks.deleteSummaryANote")
        : t("tasks.deleteSummaryNotes", { count: notes }),
    );
  }
  if (attachments > 0) {
    parts.push(
      attachments === 1
        ? t("tasks.deleteSummaryAFile")
        : t("tasks.deleteSummaryFiles", { count: attachments }),
    );
  }
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return t("tasks.deleteSummaryAnd", { first: parts[0], second: parts[1] });
}
