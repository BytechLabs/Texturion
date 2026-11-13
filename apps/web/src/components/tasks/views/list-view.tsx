"use client";

import { ListSkeleton } from "@/components/ui/list-skeleton";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { LoadError } from "@/components/ui/load-error";
import { SECTION_LABEL_CLASS } from "@/components/ui/section-label";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { TaskBulkBar } from "@/components/tasks/task-bulk-bar";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";
import {
  TASK_PAGE_LIMIT,
  useAllTasks,
  useBulkTasks,
  usePrefetchTask,
  useTasks,
  type BulkTasksBody,
  type TaskListFilters,
} from "@/lib/api/tasks";
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
import { RecordContextMenu } from "@/components/ui/record-menu";
import { flattenPages } from "@/lib/api/pagination";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/api/types";

import { TaskNumber } from "../task-atoms";
import { TaskStatusPicker } from "../task-status-picker";
import { LabelChips, PriorityMark, RepeatMark } from "../task-planning-ui";
import { EmptyTasks } from "../task-empty";
import { InlineAssignee, InlineDue } from "../task-inline-edit";
import { useTaskRowActions } from "../task-actions";
import { useIsXl } from "@/lib/use-is-xl";
import { useTaskDrawer } from "../use-task-drawer";
import { toTaskFilters, type TaskPageState } from "../task-view-url";
import { taskSourceLink } from "../task-format";

/** How long the pointer rests on a row before its detail is fetched ahead. */
const PREFETCH_HOVER_MS = 100;

/** What every row needs from the list, built once so a memoized row stays put. */
interface RowContext {
  wide: boolean;
  onOpen: (taskId: string) => void;
  onPrefetch: (taskId: string) => void;
}

interface LoadMore {
  fetching: boolean;
  fetch: () => void;
}

/**
 * The List view (T6.1, default) — a calm flat table over GET /v1/tasks. Roomy
 * rows, `--border-subtle` hairlines, one calm column: title (near-black), the
 * linked conversation hint, assignee, derived status, due. The row deep-links
 * back to the source message + conversation; the Status cell is the
 * one control for changing status (#743).
 */
export function ListView({ state }: { state: TaskPageState }) {
  const filters = toTaskFilters(state);
  const wide = useIsXl();
  const { openTask } = useTaskDrawer();
  const onPrefetch = usePrefetchTask();
  const row: RowContext = { wide, onOpen: openTask, onPrefetch };
  // The Open / Done tabs pin a status. The statusless tabs (All, Mine, an
  // assignee chip) must show open AND done, and a bare /v1/tasks pins
  // status=open, so they union two status-scoped queries, like the Board.
  return filters.status ? (
    <PinnedStatusList state={state} filters={filters} row={row} />
  ) : (
    <UnionList state={state} filters={filters} row={row} />
  );
}

/** One status: one paginated query with "Load more". */
function PinnedStatusList({
  state,
  filters,
  row,
}: {
  state: TaskPageState;
  filters: TaskListFilters;
  row: RowContext;
}) {
  const t = useT();
  const query = useTasks(filters, { keepPrevious: true });

  if (query.isPending) return <ListSkeleton rows={6} className="py-3 px-3" />;
  if (query.isError) {
    return <ListLoadError message={t("tasks.tasksLoadFailed")} onRetry={() => void query.refetch()} />;
  }

  return (
    <TaskListBody
      state={state}
      filters={filters}
      tasks={flattenPages(query.data)}
      hasMore={query.hasNextPage}
      busy={query.isPlaceholderData}
      loadMore={
        query.hasNextPage
          ? { fetching: query.isFetchingNextPage, fetch: () => void query.fetchNextPage() }
          : null
      }
      row={row}
    />
  );
}

/**
 * Every open task, then the newest done ones a page at a time: the open set is
 * what needs doing and stays whole, while the done history only grows.
 */
function UnionList({
  state,
  filters,
  row,
}: {
  state: TaskPageState;
  filters: TaskListFilters;
  row: RowContext;
}) {
  const t = useT();
  const openQuery = useAllTasks({ ...filters, status: "open" });
  const doneQuery = useTasks(
    { ...filters, status: "done", limit: TASK_PAGE_LIMIT },
    { keepPrevious: true },
  );

  if (openQuery.isPending || doneQuery.isPending) {
    return <ListSkeleton rows={6} className="py-3 px-3" />;
  }
  if (openQuery.isError || doneQuery.isError) {
    return (
      <ListLoadError
        message={t("tasks.tasksLoadFailed")}
        onRetry={() => {
          void openQuery.refetch();
          void doneQuery.refetch();
        }}
      />
    );
  }

  // Dedup by id, active tasks first, then done.
  const byId = new Map<string, Task>();
  for (const task of flattenPages(openQuery.data)) byId.set(task.id, task);
  for (const task of flattenPages(doneQuery.data)) {
    if (!byId.has(task.id)) byId.set(task.id, task);
  }
  const merged = [...byId.values()];
  const tasks = [
    ...merged.filter((task) => !task.done),
    ...merged.filter((task) => task.done),
  ];

  return (
    <TaskListBody
      state={state}
      filters={filters}
      tasks={tasks}
      hasMore={doneQuery.hasNextPage || openQuery.hasNextPage}
      busy={openQuery.isPlaceholderData || doneQuery.isPlaceholderData}
      loadMore={
        doneQuery.hasNextPage
          ? {
              fetching: doneQuery.isFetchingNextPage,
              fetch: () => void doneQuery.fetchNextPage(),
            }
          : null
      }
      row={row}
    />
  );
}

function ListLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="px-1 py-8">
      <LoadError message={message} onRetry={onRetry} />
    </div>
  );
}

/**
 * The rows, the bulk bar and "Load more". `busy` is a changed filter still
 * loading behind the last answer: the rows dim, and the bar cannot widen to
 * "all matching" a filter whose rows are not on screen yet.
 */
function TaskListBody({
  state,
  filters,
  tasks,
  hasMore,
  busy,
  loadMore,
  row,
}: {
  state: TaskPageState;
  filters: TaskListFilters;
  tasks: Task[];
  hasMore: boolean;
  busy: boolean;
  loadMore: LoadMore | null;
  row: RowContext;
}) {
  const t = useT();
  // #478: selection lives here rather than in the bar, because the bar is
  // hidden when nothing is selected and unmounting it would throw the selection
  // away. The primitives are #275's, unchanged — a second implementation would
  // be a second set of rules about what "select all" means.
  const [selection, setSelection] = useState<BulkSelection>(EMPTY_SELECTION);
  const bulk = useBulkTasks();

  const loadedIds = tasks.map((task) => task.id);
  const loadedRef = useRef(loadedIds);
  useEffect(() => {
    loadedRef.current = loadedIds;
  });
  const onToggleSelected = useCallback(
    (taskId: string) =>
      setSelection((current) => toggleRow(current, taskId, loadedRef.current)),
    [],
  );

  const BULK_VERB: Record<BulkTasksBody["action"], string> = {
    mark_done: t("tasks.bulkVerbMarkedDone"),
    mark_undone: t("tasks.bulkVerbMarkedNotDone"),
    assign: t("tasks.bulkVerbAssigned"),
    delete: t("tasks.bulkVerbDeleted"),
    set_priority: t("tasks.bulkVerbUpdated"),
    add_label: t("tasks.bulkVerbUpdated"),
    remove_label: t("tasks.bulkVerbUpdated"),
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
          toast.success(
            bulkResultMessage(BULK_VERB[body.action], result, {
              one: t("tasks.bulkNounOne"),
              many: t("tasks.bulkNounMany"),
            }),
          );
          setSelection(EMPTY_SELECTION);
        },
        onError: () => toast.error(t("tasks.bulkFailed")),
      },
    );
  }

  if (tasks.length === 0) {
    // An empty last answer says nothing yet about the filter now loading.
    return busy ? <ListSkeleton rows={6} className="py-3 px-3" /> : <EmptyTasks state={state} />;
  }

  return (
    <div className="overflow-x-auto" aria-busy={busy}>
      {!isEmpty(selection) && (
        <TaskBulkBar
          selection={selection}
          loadedIds={loadedIds}
          // POST /v1/tasks/bulk has no search, so "all matching" would reach past the results.
          hasMore={hasMore && !busy && !filters.q}
          pending={bulk.isPending}
          onSelectLoaded={() => setSelection(selectLoaded(loadedIds))}
          onSelectAllMatching={() => setSelection(selectAllMatching())}
          onClear={() => setSelection(EMPTY_SELECTION)}
          onMarkDone={() => runBulk({ action: "mark_done" })}
          onMarkUndone={() => runBulk({ action: "mark_undone" })}
          onAssign={(userIds) => runBulk({ action: "assign", assignee_ids: userIds })}
          onDelete={() => runBulk({ action: "delete" })}
          onSetPriority={(priority) =>
            runBulk({ action: "set_priority", priority })
          }
          onAddLabel={(tagId) => runBulk({ action: "add_label", tag_id: tagId })}
          onRemoveLabel={(tagId) =>
            runBulk({ action: "remove_label", tag_id: tagId })
          }
          selectedLabelIds={
            selection.mode === "ids"
              ? tasks
                  .filter((task) => selection.ids.has(task.id))
                  .map((task) => (task.labels ?? []).map((label) => label.id))
              : null
          }
        />
      )}
      {/* Column header — quiet stone labels, hidden on mobile (the row carries
          its own compact layout there). */}
      <div className={cn(SECTION_LABEL_CLASS, "hidden min-w-[640px] grid-cols-[minmax(0,1fr)_160px_128px_96px] items-center gap-4 border-b border-border px-3 pb-2 md:grid")}>
        <span>{t("tasks.columnTask")}</span>
        <span>{t("tasks.assignee")}</span>
        <span>{t("tasks.due")}</span>
        <span>{t("tasks.columnStatus")}</span>
      </div>
      <ul className={cn("transition-opacity duration-150", busy && "opacity-60")}>
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            selected={isRowSelected(selection, task.id)}
            onToggleSelected={onToggleSelected}
            {...row}
          />
        ))}
      </ul>
      {loadMore && (
        <div className="flex justify-center py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore.fetch}
            disabled={loadMore.fetching}
          >
            {loadMore.fetching ? t("tasks.loadingMore") : t("tasks.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * One roomy list row — desktop grid, mobile stacked. The title opens the task
 * detail drawer (TASKS-V2 D-A); assignee + due are inline quick-edits (D-B); a
 * quiet link names the source and deep-links to it, and only when there is one.
 * Focus, a resting pointer or a touch on the title fetches the detail ahead.
 */
const TaskRow = memo(function TaskRow({
  task,
  selected,
  onToggleSelected,
  wide,
  onOpen,
  onPrefetch,
}: {
  task: Task;
  selected: boolean;
  onToggleSelected: (taskId: string) => void;
} & RowContext) {
  const t = useT();
  const source = taskSourceLink(task, t, { besideTask: wide });
  // #712: right-click, long-press or the menu key opens the task's one action list.
  const { actions, dialogs } = useTaskRowActions(task);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHover = () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  return (
    <RecordContextMenu actions={actions}>
    <li className="group border-b border-border-subtle">
      <div
        onFocus={() => onPrefetch(task.id)}
        onPointerEnter={() => {
          cancelHover();
          hoverTimer.current = setTimeout(() => onPrefetch(task.id), PREFETCH_HOVER_MS);
        }}
        onPointerLeave={cancelHover}
        className="flex items-center gap-3 px-3 py-3 transition-colors duration-150 ease-out hover:bg-app-hover md:grid md:min-w-[640px] md:grid-cols-[minmax(0,1fr)_160px_128px_96px] md:gap-4"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3 md:items-center">
          {/* #743: the row's one checkbox selects. Status changes from the
              Status cell, so there is no second look-alike box to mistake for
              it. Shown on hover or once a selection exists. */}
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected(task.id)}
            aria-label={t("tasks.selectRowAria", { title: task.title })}
            className={`mt-0.5 size-4 shrink-0 accent-app-olive md:mt-0 ${
              selected ? "" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2">
              <TaskNumber task={task} />
              <button
                type="button"
                onClick={() => onOpen(task.id)}
                onTouchStart={() => onPrefetch(task.id)}
                className={cn(
                  "block min-w-0 max-w-full truncate text-left text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:underline",
                  task.done && "text-muted-foreground line-through opacity-70",
                )}
              >
                {task.title}
              </button>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 empty:hidden">
              <PriorityMark priority={task.priority} />
              <RepeatMark repeat={task.repeat} />
              <LabelChips labels={task.labels} />
            </div>
            {source && (
              <Link
                href={source.href}
                className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-[12px] text-muted-foreground hover:text-foreground"
              >
                {source.label}
                <ArrowUpRight className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
              </Link>
            )}
            {/* Mobile-only meta row (the desktop grid shows these as columns). */}
            <div className="mt-1.5 flex items-center gap-2 md:hidden">
              <InlineAssignee task={task} />
              <InlineDue task={task} />
              <TaskStatusPicker task={task} />
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
          <TaskStatusPicker task={task} />
        </div>
      </div>
      {dialogs}
    </li>
    </RecordContextMenu>
  );
});
