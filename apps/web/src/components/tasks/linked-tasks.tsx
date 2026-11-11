"use client";

import { taskNumberLabel } from "@loonext/shared";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";
import { SECTION_LABEL_CLASS } from "@/components/ui/section-label";
import { useLinkedTasks } from "@/lib/api/task-links";
import type { LinkedTask } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * #690: the tasks a conversation or a customer is tied to: made from one of its
 * texts, mentioned in one of its notes, or pointing at it from their own words.
 * The list comes already cut to what this member may see. Renders nothing while
 * empty, so a thread with no linked tasks gains no new row.
 */
export function LinkedTasks({
  kind,
  id,
  active = true,
  shownElsewhere = [],
  limit,
  empty,
}: {
  kind: "conversation" | "contact";
  id: string;
  active?: boolean;
  /** Tasks a list beside this one already shows, so none appears twice. */
  shownElsewhere?: readonly string[];
  /** Cap the list at this many rows, with a "Show all" for the rest. */
  limit?: number;
  /** Drawn in place of nothing when no task is linked. */
  empty?: React.ReactNode;
}) {
  const t = useT();
  const linked = useLinkedTasks(kind, id, active);
  const [all, setAll] = useState(false);
  const rows = (linked.data?.data ?? []).filter(
    (row) => !shownElsewhere.includes(row.id),
  );
  if (rows.length === 0) return linked.isPending ? null : (empty ?? null);
  const shown = limit !== undefined && !all ? rows.slice(0, limit) : rows;
  return (
    <section aria-label={t("tasks.linkedTasks")} className="space-y-1">
      <p className={SECTION_LABEL_CLASS}>
        {t("tasks.linkedTasks")}
      </p>
      <ul className="space-y-0.5">
        {shown.map((row) => (
          <LinkedRow key={row.id} row={row} />
        ))}
      </ul>
      {shown.length < rows.length && (
        <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
          {t("appShell.contactShowAll", { count: rows.length })}
        </Button>
      )}
    </section>
  );
}

function LinkedRow({ row }: { row: LinkedTask }) {
  const t = useT();
  const how = row.how.includes("mentioned")
    ? t("tasks.linkedHowMentioned")
    : row.how.includes("points_at")
      ? t("tasks.linkedHowPointsAt")
      : null;
  return (
    <li>
      <Link
        href={`/tasks?task=${row.id}`}
        className="flex items-baseline gap-2 rounded-md px-1 py-0.5 text-[13px] hover:bg-secondary"
      >
        <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
          {taskNumberLabel(row.number)}
        </span>
        <span className={cn("min-w-0 truncate", row.done && "text-muted-foreground line-through")}>
          {row.title}
        </span>
        {how && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{how}</span>}
      </Link>
    </li>
  );
}
