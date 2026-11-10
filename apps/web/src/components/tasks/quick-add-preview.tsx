"use client";

import type { QuickAddResult } from "@loonext/shared";
import { format } from "date-fns";

import { useT } from "@/i18n/provider";

import { priorityLabelKey } from "./task-planning";

/**
 * #689 A: what the quick-add line was understood to mean, shown before anything
 * is saved. One row per field the line set; a word the line looked like it
 * meant (an `@name` nobody matches, a `#word` that is not a label) is named as
 * staying in the title, so nothing is dropped silently.
 *
 * Renders nothing for a plain title, so the common case gains no new row.
 */
export function QuickAddPreview({ parsed }: { parsed: QuickAddResult }) {
  const t = useT();
  const rows: { label: string; value: string }[] = [];
  if (parsed.assignee) {
    rows.push({ label: t("tasks.quickAssignee"), value: parsed.assignee.name });
  }
  if (parsed.dueAt) {
    const due = new Date(parsed.dueAt);
    rows.push({
      label: t("tasks.quickDue"),
      value: format(due, parsed.dueHasTime ? "EEE MMM d, h:mm a" : "EEE MMM d, h:mm a"),
    });
  }
  if (parsed.priority) {
    rows.push({ label: t("tasks.quickPriority"), value: t(priorityLabelKey(parsed.priority)) });
  }
  if (parsed.labels.length > 0) {
    rows.push({
      label: t("tasks.quickLabels"),
      value: parsed.labels.map((label) => label.name).join(", "),
    });
  }
  if (rows.length === 0 && parsed.ignored.length === 0) return null;
  return (
    <div
      className="rounded-app-ctrl border border-app-line bg-app-inset px-3 py-2 text-[13px]"
      aria-live="polite"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-app-muted-2">
        {t("tasks.quickUnderstood")}
      </p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-app-muted">{t("tasks.quickTitle")}</dt>
        <dd className="truncate font-medium text-app-ink">
          {parsed.title === "" ? t("tasks.quickNeedsTitle") : parsed.title}
        </dd>
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-app-muted">{row.label}</dt>
            <dd className="truncate text-app-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
      {parsed.ignored.length > 0 && (
        <p className="mt-1 text-[12px] text-app-muted">
          {t("tasks.quickStays", { words: parsed.ignored.join(" ") })}
        </p>
      )}
    </div>
  );
}
