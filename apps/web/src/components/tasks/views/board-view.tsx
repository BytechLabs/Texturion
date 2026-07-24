"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useAllTasks } from "@/lib/api/tasks";
import { flattenPages } from "@/lib/api/pagination";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/api/types";

import { TaskAssignee, TaskDue } from "../task-atoms";
import { taskThreadHref } from "../task-format";
import { EmptyTasks } from "../task-empty";
import { useTaskDone } from "../use-task-mutations";
import { toTaskFilters, type TaskPageState } from "../task-view-url";

/**
 * The Board view (D25, MVP 2 columns). Per the HOME-AND-VIEWS reconciliation
 * (D25 / TASKS.md T2), completion is DERIVED from the source message, so the
 * board has exactly two states — **To do → Done** — and moving a card to/from
 * Done calls the source message's `PATCH /v1/messages/:id {done}` (the same
 * derived path as every other view, via `useTaskDone`). The richer
 * To do → In progress → Waiting board is a fast-follow gated on the deferred T9
 * status decision; do NOT build a stored multi-status column here.
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
  // Each drains every page (a card dropped past page 1 would leave a column
  // short); the derived `done` on each row still governs which column it lands
  // in (a row that raced across a status boundary self-corrects on the next read).
  const base = toTaskFilters(state);
  const todoQuery = useAllTasks({ ...base, status: "open" });
  const doneQuery = useAllTasks({ ...base, status: "done" });

  const isPending = todoQuery.isPending || doneQuery.isPending;
  const isError = todoQuery.isError || doneQuery.isError;

  if (isPending) return <BoardSkeleton />;

  if (isError) {
    return (
      <p className="px-1 py-8 text-sm text-muted-foreground">
        We couldn&apos;t load your tasks. Check your connection and try again.
      </p>
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

  if (all.length === 0) return <EmptyTasks state={state} />;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Column title="To do" tasks={todo} target={false} />
      <Column title="Done" tasks={done} target={true} />
    </div>
  );
}

/** One board column. `target` is the done-state a card dropped here takes on. */
function Column({
  title,
  tasks,
  target,
}: {
  title: string;
  tasks: Task[];
  target: boolean;
}) {
  const done = useTaskDone();
  const [over, setOver] = useState(false);

  return (
    <section
      onDragOver={(e) => {
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
        if (id && messageId && conversationId && priorDone !== target) {
          done.mutate({ taskId: id, messageId, conversationId, done: target });
        }
      }}
      className={cn(
        "flex min-h-[200px] flex-col gap-2 rounded-xl border p-3 transition-colors duration-150 ease-out",
        // Petrol only on the active over-state (D25 "petrol only on the
        // active/over state"); otherwise border-first, calm.
        over ? "border-primary bg-primary/5" : "border-border bg-secondary/20",
      )}
      aria-label={`${title} column, ${tasks.length} tasks`}
    >
      <header className="flex items-center justify-between px-1 pb-1">
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {tasks.length}
        </span>
      </header>
      {tasks.length === 0 ? (
        <p className="px-1 py-6 text-center text-[13px] text-muted-foreground">
          {target ? "Nothing done yet." : "Nothing to do."}
        </p>
      ) : (
        tasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            onMove={() =>
              done.mutate({
                taskId: task.id,
                messageId: task.message_id,
                conversationId: task.conversation_id,
                done: !task.done,
              })
            }
          />
        ))
      )}
    </section>
  );
}

/** A calm draggable card + a keyboard-accessible "move" button. */
function BoardCard({ task, onMove }: { task: Task; onMove: () => void }) {
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/task-id", task.id);
        e.dataTransfer.setData("text/task-done", task.done ? "1" : "0");
        e.dataTransfer.setData("text/task-message", task.message_id);
        e.dataTransfer.setData("text/task-conversation", task.conversation_id);
      }}
      className="cursor-grab rounded-lg border border-border bg-card p-3 active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={taskThreadHref(task)}
          className={cn(
            "min-w-0 flex-1 text-[13px] font-medium text-foreground hover:text-primary",
            task.done && "text-muted-foreground line-through opacity-70",
          )}
        >
          {task.title}
        </Link>
        <Link
          href={taskThreadHref(task)}
          aria-label="Open conversation"
          className="tap-target shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowUpRight className="size-3.5" strokeWidth={1.75} aria-hidden />
        </Link>
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
        {task.done ? "Move to To do" : "Move to Done"}
      </button>
    </article>
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
