"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/ui/load-error";
import { RecordContextMenu } from "@/components/ui/record-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";
import { TASK_PAGE_LIMIT, useAllTasks, useTasks } from "@/lib/api/tasks";
import { flattenPages } from "@/lib/api/pagination";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/api/types";

import { TaskAssignee, TaskDue, TaskNumber } from "../task-atoms";
import { groupTasks, type TaskColumn } from "../task-grouping";
import { priorityLabelKey } from "../task-planning";
import { useMemberNames } from "@/components/inbox/member-avatar";
import { LabelChips, PriorityMark, RepeatMark } from "../task-planning-ui";
import { taskThreadId } from "../task-format";
import { useTaskRowActions } from "../task-actions";
import { taskLinkClickHandler, useTaskDrawer } from "../use-task-drawer";
import { EmptyTasks } from "../task-empty";
import { useTaskDone } from "../use-task-mutations";
import { toTaskFilters, type TaskPageState } from "../task-view-url";

/**
 * The Board view (D25): two states, **To do → Done**. Done stays derived
 * (D17/D64), so moving a card goes through the same done path every view uses
 * (`useTaskDone`) and the board stores no status of its own. A job's pipeline
 * state is a conversation tag (D92), not a column here; grouping by assignee or
 * priority changes the columns, not the states.
 *
 * Interaction: HTML5 drag-and-drop between columns (no new DnD lib — the perf
 * guardrail forbids one) AND a keyboard-accessible move button on every card,
 * so the board is fully operable without a pointer.
 */
export function BoardView({ state }: { state: TaskPageState }) {
  // The board shows both states, honoring the tab's assignee scope + chips (so a
  // "Mine" board shows my to-do AND my done). The frozen /v1/tasks contract has
  // no "all statuses, all assignees" query — the route's status filter is a
  // real predicate and its only other opt-out pins an assignee — so the board
  // fetches its two columns as two status-scoped queries (status=open /
  // status=done) that share the tab's assignee scope, then partitions locally.
  // To do drains every page (a card dropped past page 1 would leave it short);
  // Done is the newest page with "Load more", since that history only grows.
  // The derived `done` on each row still governs which column it lands in (a
  // row that raced across a status boundary self-corrects on the next read).
  const t = useT();
  const base = toTaskFilters(state);
  const todoQuery = useAllTasks({ ...base, status: "open" });
  const doneQuery = useTasks(
    { ...base, status: "done", limit: TASK_PAGE_LIMIT },
    { keepPrevious: true },
  );
  // A changed filter still loading behind the last answer: no drops onto it.
  const busy = todoQuery.isPlaceholderData || doneQuery.isPlaceholderData;
  const moreDone = doneQuery.hasNextPage
    ? {
        fetching: doneQuery.isFetchingNextPage,
        fetch: () => void doneQuery.fetchNextPage(),
      }
    : null;

  const isPending = todoQuery.isPending || doneQuery.isPending;
  const isError = todoQuery.isError || doneQuery.isError;

  if (isPending) return <BoardSkeleton />;

  if (isError) {
    return (
      <div className="px-1 py-8">
        <LoadError
          message={t("tasks.tasksLoadFailed")}
          onRetry={() => {
            void todoQuery.refetch();
            void doneQuery.refetch();
          }}
        />
      </div>
    );
  }

  // Merge both status queries, de-duplicating by id: an optimistic done-toggle
  // flips a row's derived `done` IN its origin query's cache (it isn't moved
  // between caches until the refetch settles), and during that overlap a row
  // could momentarily be present in both. Partition on the DERIVED `done` (not
  // which query returned the row) so the flipped card shows in the right column
  // immediately, before either status query refetches.
  const byId = new Map<string, Task>();
  for (const t of [
    ...flattenPages(todoQuery.data),
    ...flattenPages(doneQuery.data),
  ]) {
    byId.set(t.id, t);
  }
  const all = [...byId.values()];
  const todo = all.filter((t) => !t.done);
  const done = all.filter((t) => t.done);

  // An empty last answer says nothing yet about the filter now loading.
  if (all.length === 0) return busy ? <BoardSkeleton /> : <EmptyTasks state={state} />;

  if (state.group === "assignee" || state.group === "priority") {
    return (
      <div aria-busy={busy} className={cn("space-y-4", busy && BUSY_CLASS)}>
        <GroupedBoard tasks={all} group={state.group} busy={busy} />
        {moreDone && <LoadMoreButton more={moreDone} />}
      </div>
    );
  }

  return (
    <div
      aria-busy={busy}
      className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", busy && BUSY_CLASS)}
    >
      <Column title={t("tasks.boardColumnToDo")} tasks={todo} target={false} busy={busy} />
      <Column
        title={t("tasks.boardColumnDone")}
        tasks={done}
        target={true}
        busy={busy}
        more={moreDone}
      />
    </div>
  );
}

const BUSY_CLASS = "opacity-60 transition-opacity duration-150";

function LoadMoreButton({ more }: { more: { fetching: boolean; fetch: () => void } }) {
  const t = useT();
  return (
    <div className="flex justify-center pt-1">
      <Button variant="outline" size="sm" onClick={more.fetch} disabled={more.fetching}>
        {more.fetching ? t("tasks.loadingMore") : t("tasks.loadMore")}
      </Button>
    </div>
  );
}

/**
 * #689 G: the board grouped by assignee or priority. A column here is a person
 * or a priority, not a state, so a card is not dropped between them: moving a
 * card would mean reassigning it, which has its own control. The button on each
 * card still marks it done.
 */
function GroupedBoard({
  tasks,
  group,
  busy,
}: {
  tasks: Task[];
  group: "assignee" | "priority";
  busy: boolean;
}) {
  const t = useT();
  const names = useMemberNames();
  const done = useTaskDone();
  const columns = groupTasks(tasks, group);
  const titleOf = (column: TaskColumn): string =>
    column.kind === "priority"
      ? t(priorityLabelKey(column.priority))
      : column.kind === "unassigned"
        ? t("tasks.unassigned")
        : (names.get(column.key) ?? t("tasks.teammate"));
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {columns.map((column) => {
        const title = titleOf(column);
        return (
          <section
            key={column.key}
            aria-label={t("tasks.boardColumnAria", { title, count: column.tasks.length })}
            className="flex min-h-[120px] flex-col gap-2 rounded-xl border border-border bg-secondary/20 p-3"
          >
            <header className="flex items-center justify-between px-1 pb-1">
              <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {column.tasks.length}
              </span>
            </header>
            {column.tasks.map((task) => (
              <BoardCard
                key={task.id}
                task={task}
                draggable={!busy}
                onMove={() =>
                  done.mutate({
                    taskId: task.id,
                    messageId: task.message_id,
                    conversationId: taskThreadId(task),
                    done: !task.done,
                  })
                }
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

/**
 * One board column. `target` is the done-state a card dropped here takes on.
 * `more` is the rest of a column that loads a page at a time; until it is
 * loaded the count says "100+" rather than a total it does not have.
 */
function Column({
  title,
  tasks,
  target,
  busy,
  more = null,
}: {
  title: string;
  tasks: Task[];
  target: boolean;
  busy: boolean;
  more?: { fetching: boolean; fetch: () => void } | null;
}) {
  const t = useT();
  const done = useTaskDone();
  const [over, setOver] = useState(false);
  const count = more ? `${tasks.length}+` : String(tasks.length);

  return (
    <section
      onDragOver={(e) => {
        if (busy) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        // dragleave fires when the pointer crosses onto a child card too — only
        // clear the highlight when it truly exits the column, or it flickers.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        // The whole task is reconstructed from the drag payload, so a card from
        // EITHER column drops correctly (its home column's `tasks` array isn't
        // needed here). A drop into the column the card already lives in is a
        // no-op (target === prior done).
        const id = e.dataTransfer.getData("text/task-id");
        const priorDone = e.dataTransfer.getData("text/task-done") === "1";
        const messageId = e.dataTransfer.getData("text/task-message");
        const conversationId = e.dataTransfer.getData("text/task-conversation");
        // An empty message id is a call-anchored card (D64): it has no message.
        if (id && conversationId && priorDone !== target) {
          done.mutate({
            taskId: id,
            messageId: messageId === "" ? null : messageId,
            conversationId,
            done: target,
          });
        }
      }}
      className={cn(
        "flex min-h-[200px] flex-col gap-2 rounded-xl border p-3 transition-colors duration-150 ease-out",
        // Petrol only on the active over-state (D25 "petrol only on the
        // active/over state"); otherwise border-first, calm.
        over ? "border-primary bg-primary/5" : "border-border bg-secondary/20",
      )}
      aria-label={t("tasks.boardColumnAria", { title, count })}
    >
      <header className="flex items-center justify-between px-1 pb-1">
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      </header>
      {tasks.length === 0 ? (
        <p className="px-1 py-6 text-center text-[13px] text-muted-foreground">
          {target
            ? t("tasks.boardNothingDone")
            : t("tasks.boardNothingToDo")}
        </p>
      ) : (
        tasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            draggable={!busy}
            onMove={() =>
              done.mutate({
                taskId: task.id,
                messageId: task.message_id,
                conversationId: taskThreadId(task),
                done: !task.done,
              })
            }
          />
        ))
      )}
      {more && <LoadMoreButton more={more} />}
    </section>
  );
}

/** A calm draggable card + a keyboard-accessible "move" button. */
function BoardCard({
  task,
  draggable,
  onMove,
}: {
  task: Task;
  draggable: boolean;
  onMove: () => void;
}) {
  const t = useT();
  const { hrefForTask } = useTaskDrawer();
  // #712: right-click, long-press or the menu key opens the task's one action list.
  const { actions, dialogs } = useTaskRowActions(task);
  return (
    <RecordContextMenu actions={actions}>
    <article
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/task-id", task.id);
        e.dataTransfer.setData("text/task-done", task.done ? "1" : "0");
        e.dataTransfer.setData("text/task-message", task.message_id ?? "");
        e.dataTransfer.setData("text/task-conversation", taskThreadId(task));
      }}
      className={cn(
        "rounded-lg border border-border bg-card p-3",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={hrefForTask(task.id)}
          scroll={false}
          onClick={taskLinkClickHandler(task.id)}
          className={cn(
            "min-w-0 flex-1 text-[13px] font-medium text-foreground hover:text-primary",
            task.done && "text-muted-foreground line-through opacity-70",
          )}
        >
          <TaskNumber task={task} className="mr-1.5" />
          {task.title}
        </Link>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 empty:hidden">
        <PriorityMark priority={task.priority} />
        <RepeatMark repeat={task.repeat} />
        <LabelChips labels={task.labels} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <TaskAssignee task={task} showName={false} />
        <TaskDue task={task} className="text-[12px]" />
      </div>
      {/* Keyboard-accessible move (the DnD alternative, §7 a11y). */}
      <button
        type="button"
        onClick={onMove}
        className="mt-2 w-full rounded-md border border-dashed border-border py-1 text-[12px] font-medium text-muted-foreground transition-colors duration-150 ease-out hover:border-primary/50 hover:text-foreground"
      >
        {task.done
          ? t("tasks.boardMoveToToDo")
          : t("tasks.boardMoveToDone")}
      </button>
      {dialogs}
    </article>
    </RecordContextMenu>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-hidden>
      {[0, 1].map((col) => (
        <div key={col} className="space-y-2 rounded-xl border border-border p-3">
          <Skeleton className="h-4 w-20" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}
