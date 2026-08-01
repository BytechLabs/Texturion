"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { LoadError } from "@/components/settings/section";
import { useState } from "react";
import { toast } from "sonner";

import { TaskBulkBar } from "@/components/tasks/task-bulk-bar";
import { Button } from "@/components/ui/button";
import { useBulkTasks, type BulkTasksBody } from "@/lib/api/tasks";
import {
  bulkResultMessage,
  EMPTY_SELECTION,
  isEmpty,
  isRowSelected,
  selectAllMatching,
  selectionIds,
  selectLoaded,
  toggleRow,
  type BulkSelection,
} from "@/lib/inbox/bulk-selection";
import { Skeleton } from "@/components/ui/skeleton";
import { useAllTasks, useTasks } from "@/lib/api/tasks";
import { flattenPages } from "@/lib/api/pagination";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/api/types";

import { TaskDoneCheckbox, TaskStatusPill } from "../task-atoms";
import { EmptyTasks } from "../task-empty";
import { InlineAssignee, InlineDue } from "../task-inline-edit";
import { useTaskDrawer } from "../use-task-drawer";
import { toTaskFilters, type TaskPageState } from "../task-view-url";

/**
 * The List view (T6.1, default) — a calm flat table over GET /v1/tasks. Roomy
 * rows, `--border-subtle` hairlines, one calm column: title (near-black), the
 * linked conversation hint, assignee, derived status, due. The row deep-links
 * back to the source message + conversation; the done checkbox is the one
 * petrol state mark.
 */
export function ListView({ state }: { state: TaskPageState }) {
  const filters = toTaskFilters(state);
  // The Open / Done tabs pin a status → one paginated query with "Load more".
  // The statusless tabs (All, Mine, an assignee chip) must show open AND done —
  // the frozen /v1/tasks route has no "all statuses" mode (a bare request pins
  // status=open), so, exactly like the Board, we union two status-scoped
  // drain-all queries. Both hook sets are always called (rules of hooks); the
  // inactive pair is disabled so it never fires a request.
  const hasStatus = Boolean(filters.status);
  const single = useTasks(filters, { enabled: hasStatus });
  const openQuery = useAllTasks(
    { ...filters, status: "open" },
    { enabled: !hasStatus },
  );
  const doneQuery = useAllTasks(
    { ...filters, status: "done" },
    { enabled: !hasStatus },
  );

  // #478: selection lives here rather than in the bar, because the bar is
  // hidden when nothing is selected and unmounting it would throw the selection
  // away. The primitives are #275's, unchanged — a second implementation would
  // be a second set of rules about what "select all" means.
  const [selection, setSelection] = useState<BulkSelection>(EMPTY_SELECTION);
  const bulk = useBulkTasks();

  const isPending = hasStatus
    ? single.isPending
    : openQuery.isPending || doneQuery.isPending;
  const isError = hasStatus
    ? single.isError
    : openQuery.isError || doneQuery.isError;

  // Union open+done for statusless tabs (dedup by id; active tasks first, then
  // done), or the single paginated list for a pinned status.
  let tasks: Task[];
  if (hasStatus) {
    tasks = flattenPages(single.data);
  } else {
    const byId = new Map<string, Task>();
    for (const t of flattenPages(openQuery.data)) byId.set(t.id, t);
    for (const t of flattenPages(doneQuery.data)) if (!byId.has(t.id)) byId.set(t.id, t);
    const merged = [...byId.values()];
    tasks = [...merged.filter((t) => !t.done), ...merged.filter((t) => t.done)];
  }

  const loadedIds = tasks.map((task) => task.id);
  const hasMore = hasStatus ? single.hasNextPage === true : false;

  const BULK_VERB: Record<BulkTasksBody["action"], string> = {
    mark_done: "Marked done",
    mark_undone: "Marked not done",
    assign: "Assigned",
    delete: "Deleted",
  };

  function runBulk(body: Omit<BulkTasksBody, "ids" | "filter">) {
    // `selectionIds` returns null for the filter mode, which is exactly the
    // shape the route wants — ids OR filter, never both, never neither.
    const ids = selectionIds(selection);
    bulk.mutate(
      ids === null ? { ...body, filter: filters } : { ...body, ids },
      {
        onSuccess: (result) => {
          // The server's count, never one this component worked out. In filter
          // mode the client genuinely does not know how many rows matched.
          toast.success(bulkResultMessage(BULK_VERB[body.action], result, { one: "task", many: "tasks" }));
          setSelection(EMPTY_SELECTION);
        },
        onError: () => toast.error("That didn't go through. Nothing was changed."),
      },
    );
  }

  if (isPending) return <ListSkeleton />;

  if (isError) {
    return (
      <div className="px-1 py-8">
        <LoadError
          message="We couldn't load your tasks. Check your connection and try again."
          onRetry={() => {
            if (hasStatus) void single.refetch();
            else {
              void openQuery.refetch();
              void doneQuery.refetch();
            }
          }}
        />
      </div>
    );
  }

  if (tasks.length === 0) {
    return <EmptyTasks state={state} />;
  }

  return (
    <div className="overflow-x-auto">
      {!isEmpty(selection) && (
        <TaskBulkBar
          selection={selection}
          loadedIds={loadedIds}
          hasMore={hasMore}
          pending={bulk.isPending}
          onSelectLoaded={() => setSelection(selectLoaded(loadedIds))}
          onSelectAllMatching={() => setSelection(selectAllMatching())}
          onClear={() => setSelection(EMPTY_SELECTION)}
          onMarkDone={() => runBulk({ action: "mark_done" })}
          onMarkUndone={() => runBulk({ action: "mark_undone" })}
          onAssign={(userId) => runBulk({ action: "assign", target_user_id: userId })}
          onDelete={() => runBulk({ action: "delete" })}
        />
      )}
      {/* Column header — quiet stone labels, hidden on mobile (the row carries
          its own compact layout there). */}
      <div className="hidden min-w-[640px] grid-cols-[minmax(0,1fr)_160px_128px_96px] items-center gap-4 border-b border-border px-3 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid">
        <span>Task</span>
        <span>Assignee</span>
        <span>Due</span>
        <span>Status</span>
      </div>
      <ul>
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            selected={isRowSelected(selection, task.id)}
            onToggleSelected={() =>
              setSelection((current) => toggleRow(current, task.id, loadedIds))
            }
          />
        ))}
      </ul>
      {/* Only the pinned-status tabs paginate; the statusless union drains all
          pages (useAllTasks), so it has nothing more to load. */}
      {hasStatus && single.hasNextPage && (
        <div className="flex justify-center py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => single.fetchNextPage()}
            disabled={single.isFetchingNextPage}
          >
            {single.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * One roomy list row — desktop grid, mobile stacked. The title opens the task
 * detail drawer (TASKS-V2 D-A); assignee + due are inline quick-edits (D-B); a
 * quiet "Open conversation" link still deep-links to the source thread.
 */
function TaskRow({
  task,
  selected,
  onToggleSelected,
}: {
  task: Task;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const { openTask } = useTaskDrawer();
  return (
    <li className="group border-b border-border-subtle">
      <div className="flex items-center gap-3 px-3 py-3 transition-colors duration-150 ease-out hover:bg-app-hover md:grid md:min-w-[640px] md:grid-cols-[minmax(0,1fr)_160px_128px_96px] md:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3 md:items-center">
          {/* #478: the SELECTION box, distinct from the done box beside it. Two
              checkboxes in a row is a real risk of confusion, so this one is
              only offered on hover or once a selection exists — until then the
              row looks exactly as it did, and the done box keeps its place as
              the one people reach for. */}
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            aria-label={`Select ${task.title}`}
            className={`mt-0.5 size-4 shrink-0 accent-app-olive md:mt-0 ${
              selected ? "" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
            }`}
          />
          <TaskDoneCheckbox task={task} className="mt-0.5 md:mt-0" />
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => openTask(task.id)}
              className={cn(
                "block max-w-full truncate text-left text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:underline",
                task.done && "text-muted-foreground line-through opacity-70",
              )}
            >
              {task.title}
            </button>
            <Link
              href={`/inbox/${task.conversation_id}?message=${task.message_id}`}
              className="mt-0.5 inline-flex items-center gap-1 truncate text-[12px] text-muted-foreground hover:text-foreground"
            >
              Open conversation
              <ArrowUpRight className="size-3" strokeWidth={1.75} aria-hidden />
            </Link>
            {/* Mobile-only meta row (the desktop grid shows these as columns). */}
            <div className="mt-1.5 flex items-center gap-2 md:hidden">
              <InlineAssignee task={task} />
              <InlineDue task={task} />
            </div>
          </div>
        </div>
        <div className="hidden min-w-0 md:block">
          <InlineAssignee task={task} />
        </div>
        <div className="hidden md:block">
          <InlineDue task={task} />
        </div>
        <div className="hidden md:block">
          <TaskStatusPill task={task} />
        </div>
      </div>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3 py-3" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-24 md:block" />
          <Skeleton className="hidden h-4 w-16 md:block" />
        </div>
      ))}
    </div>
  );
}
