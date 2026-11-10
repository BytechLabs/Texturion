import { taskNumberLabel } from "@loonext/shared";

import type { MessageKey, Translate } from "@/i18n/provider";
import type { TaskFeedItem } from "@/lib/api/types";
import { formatTimestamp } from "@/lib/format/time";

import { priorityLabelKey, repeatSummary } from "./task-planning";

type EventItem = Extract<TaskFeedItem, { kind: "event" }>;

/** "Tue 9:00 AM": the day name is enough for a job due this week. */
function formatDueTime(iso: string, t: Translate): string {
  return formatTimestamp(iso, { style: "long", t });
}

const asString = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/** A label event carries {tag_id, name}; the name is what a person reads. */
function tagName(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  return asString((value as { name?: unknown }).name);
}

type RuleSummary = Parameters<typeof repeatSummary>[0];

/** The rule summary a repeat event carries, or null when it was cleared. */
function repeatRule(value: unknown): RuleSummary | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const kind = v.kind === "after_done" ? "after_done" : "schedule";
  const unit =
    v.unit === "week" || v.unit === "month" || v.unit === "year" ? v.unit : "day";
  const num = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) ? x : null;
  const endsKind =
    v.ends_kind === "on" || v.ends_kind === "after" ? v.ends_kind : "never";
  return {
    kind,
    unit,
    every: num(v.every) ?? 1,
    weekdays: Array.isArray(v.weekdays)
      ? v.weekdays.filter((d): d is number => typeof d === "number")
      : null,
    month_day: num(v.month_day),
    nth: num(v.nth),
    nth_weekday: num(v.nth_weekday),
    ends: {
      kind: endsKind,
      on: asString(v.ends_on),
      after: num(v.ends_after),
    },
    paused: v.paused === true,
    stopped: false,
  };
}

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
    case "assignee_added": {
      const name = item.to_user?.display_name;
      return name
        ? t("tasks.histAssigneeAdded", { by, name })
        : t("tasks.histUpdated", { by });
    }
    case "assignee_removed": {
      const name = item.from_user?.display_name;
      return name
        ? t("tasks.histAssigneeRemoved", { by, name })
        : t("tasks.histUpdated", { by });
    }
    case "due": {
      const due = asString(item.to);
      return due
        ? t("tasks.histDue", { by, due: formatDueTime(due, t) })
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
    case "priority": {
      const to = asString(item.to);
      return to
        ? t("tasks.histPriority", { by, priority: t(priorityLabelKey(to)) })
        : t("tasks.histUpdated", { by });
    }
    case "label_added": {
      const name = tagName(item.to);
      return name
        ? t("tasks.histLabelAdded", { by, name })
        : t("tasks.histUpdated", { by });
    }
    case "label_removed": {
      const name = tagName(item.from);
      return name
        ? t("tasks.histLabelRemoved", { by, name })
        : t("tasks.histUpdated", { by });
    }
    case "repeat": {
      const rule = repeatRule(item.to);
      return rule
        ? t("tasks.histRepeat", { by, rule: repeatSummary(rule, t) })
        : t("tasks.histRepeatCleared", { by });
    }
    case "link_added":
    case "link_removed": {
      const link = linkOf(item.event === "link_added" ? item.to : item.from);
      if (!link) return t("tasks.histUpdated", { by });
      const task = `${taskNumberLabel(link.number)} ${link.title}`.trim();
      const key = `tasks.hist${item.event === "link_added" ? "Add" : "Remove"}${LINK_KEYS[link.relation]}`;
      return t(key as MessageKey, { by, task });
    }
    default:
      return t("tasks.histUpdated", { by });
  }
}

const LINK_KEYS = {
  blocked_by: "BlockedBy",
  blocks: "Blocks",
  parent: "Parent",
  sub_task: "SubTask",
} as const;

/** The task and relation a link event carries. */
function linkOf(
  value: unknown,
): { relation: keyof typeof LINK_KEYS; number: number; title: string } | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const relation = v.relation;
  if (typeof relation !== "string" || !(relation in LINK_KEYS)) return null;
  if (typeof v.number !== "number") return null;
  return {
    relation: relation as keyof typeof LINK_KEYS,
    number: v.number,
    title: typeof v.title === "string" ? v.title : "",
  };
}
