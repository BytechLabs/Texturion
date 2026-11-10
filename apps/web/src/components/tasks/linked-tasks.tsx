"use client";

import { taskNumberLabel } from "@loonext/shared";
import Link from "next/link";

import { useT } from "@/i18n/provider";
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
}: {
  kind: "conversation" | "contact";
  id: string;
  active?: boolean;
}) {
  const t = useT();
  const linked = useLinkedTasks(kind, id, active);
  const rows = linked.data?.data ?? [];
  if (rows.length === 0) return null;
  return (
    <section aria-label={t("tasks.linkedTasks")} className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("tasks.linkedTasks")}
      </p>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <LinkedRow key={row.id} row={row} />
        ))}
      </ul>
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
