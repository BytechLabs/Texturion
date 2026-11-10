import { format } from "date-fns";

import type { Translate } from "@/i18n/provider";
import type { TaskFeedItem } from "@/lib/api/types";

type EventItem = Extract<TaskFeedItem, { kind: "event" }>;

/** "Tue 9:00 AM": the day name is enough for a job due this week. */
function formatDueTime(iso: string): string {
  return format(new Date(iso), "EEE h:mm a");
}

const asString = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/**
 * One quiet line for a change to a task, with the person who made it. `by` is
 * already resolved (a name, or the word for "a teammate"). A kind this client
 * does not know yet falls back to a plain "updated this task".
 */
export function taskHistorySentence(
  item: EventItem,
  by: string,
  t: Translate,
): string {
  switch (item.event) {
    case "created":
      return t("tasks.histCreated", { by });
    case "title": {
      const title = asString(item.to);
      return title
        ? t("tasks.histTitle", { by, title })
        : t("tasks.histUpdated", { by });
    }
    case "description":
      return t("tasks.histDescription", { by });
    case "address":
      return item.to === null
        ? t("tasks.histAddressCleared", { by })
        : t("tasks.histAddress", { by });
    case "assignee": {
      if (asString(item.to) === null) return t("tasks.histUnassigned", { by });
      const name = item.to_user?.display_name;
      return name
        ? t("tasks.histAssigned", { by, name })
        : t("tasks.histReassigned", { by });
    }
    case "due": {
      const due = asString(item.to);
      return due
        ? t("tasks.histDue", { by, due: formatDueTime(due) })
        : t("tasks.histDueCleared", { by });
    }
    case "reminders":
      return item.to === true
        ? t("tasks.histRemindersOff", { by })
        : t("tasks.histRemindersOn", { by });
    case "confirmation":
      return item.to === null
        ? t("tasks.histConfirmationCleared", { by })
        : t("tasks.histConfirmed", { by });
    case "done":
      return t("tasks.histDone", { by });
    case "reopened":
      return t("tasks.histReopened", { by });
    case "deleted":
      return t("tasks.histDeleted", { by });
    default:
      return t("tasks.histUpdated", { by });
  }
}
