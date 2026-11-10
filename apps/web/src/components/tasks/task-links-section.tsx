"use client";

import { taskNumberLabel } from "@loonext/shared";
import { Check, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT, type MessageKey } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useAddTaskLink, useRemoveTaskLink, useTaskLinks } from "@/lib/api/task-links";
import type { TaskLink, TaskRelation } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { ReferencePicker } from "./reference-picker";

const RELATIONS: { id: TaskRelation; labelKey: MessageKey }[] = [
  { id: "blocked_by", labelKey: "tasks.relBlockedBy" },
  { id: "blocks", labelKey: "tasks.relBlocks" },
  { id: "parent", labelKey: "tasks.relParent" },
  { id: "sub_task", labelKey: "tasks.relSubTask" },
];

/**
 * #690: what this task waits on, what waits on it, and the job it belongs to.
 *
 * Done stays per task: a finished sub-task shows as finished here and nothing
 * else changes. The server refuses a loop (422) and a second parent (409); the
 * reason is shown as the server states it.
 *
 * Applying: Zen of Clarity (one quiet section, one add control) and Ethical
 * Friction nowhere: a link is cheap to add and cheap to remove.
 */
export function TaskLinksSection({ taskId }: { taskId: string }) {
  const t = useT();
  const links = useTaskLinks(taskId);
  const add = useAddTaskLink(taskId);
  const remove = useRemoveTaskLink(taskId);
  const [adding, setAdding] = useState<TaskRelation | null>(null);

  const rows = links.data?.data ?? [];
  const explain = (cause: unknown) =>
    toast.error(cause instanceof ApiError ? cause.message : t("tasks.linkFailed"));

  return (
    <section className="space-y-2" aria-label={t("tasks.linksAria")}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-app-muted-2">
          {t("tasks.links")}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("tasks.linkAddAria")}
              className="tap-target inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] font-medium text-app-muted transition-colors hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
              {t("tasks.linkAdd")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {RELATIONS.map(({ id, labelKey }) => (
              <DropdownMenuItem key={id} onSelect={() => setAdding(id)}>
                {t(labelKey)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {rows.length === 0 ? (
        <p className="text-[13px] text-app-muted">{t("tasks.linksEmpty")}</p>
      ) : (
        <ul className="space-y-1">
          {RELATIONS.map(({ id, labelKey }) => {
            const group = rows.filter((row) => row.relation === id);
            if (group.length === 0) return null;
            return (
              <li key={id}>
                <p className="text-[12px] text-app-muted-2">{t(labelKey)}</p>
                <ul className="mt-0.5 space-y-0.5">
                  {group.map((row) => (
                    <LinkRow
                      key={`${id}:${row.task_id}`}
                      row={row}
                      onRemove={() =>
                        remove.mutate(
                          { relation: row.relation, otherTaskId: row.task_id },
                          { onError: explain },
                        )
                      }
                    />
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      <ReferencePicker
        open={adding !== null}
        onOpenChange={(open) => !open && setAdding(null)}
        tasksOnly
        onPick={(_text, picked) => {
          const relation = adding;
          setAdding(null);
          if (relation === null || picked.kind !== "task") return;
          add.mutate({ relation, otherTaskId: picked.id }, { onError: explain });
        }}
      >
        <span aria-hidden className="pointer-events-none block h-0" />
      </ReferencePicker>
    </section>
  );
}

function LinkRow({ row, onRemove }: { row: TaskLink; onRemove: () => void }) {
  const t = useT();
  return (
    <li className="flex items-center gap-2 rounded-app-ctrl px-1 py-0.5 hover:bg-app-inset">
      <Link
        href={`/tasks?task=${row.task_id}`}
        className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-app-ink"
      >
        <span className="shrink-0 tabular-nums text-xs text-app-muted">
          {taskNumberLabel(row.number)}
        </span>
        <span className={cn("truncate", row.done && "text-app-muted line-through")}>
          {row.title}
        </span>
        {row.done && (
          <>
            <Check className="size-3.5 shrink-0 text-app-muted" strokeWidth={2} aria-hidden />
            <span className="sr-only">{t("tasks.statusDone")}</span>
          </>
        )}
      </Link>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("tasks.linkRemoveAria", {
          task: `${taskNumberLabel(row.number)} ${row.title}`,
        })}
        className="tap-target shrink-0 rounded-full p-0.5 text-app-muted-2 hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3.5" strokeWidth={1.75} aria-hidden />
      </button>
    </li>
  );
}
