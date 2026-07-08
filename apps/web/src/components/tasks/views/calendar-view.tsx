"use client";

import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAllTasks } from "@/lib/api/tasks";
import { flattenPages } from "@/lib/api/pagination";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/api/types";

import { taskThreadHref } from "../task-format";
import { useTaskReschedule } from "../use-task-mutations";
import { toTaskFilters, type TaskPageState } from "../task-view-url";

type CalMode = "month" | "week";

/**
 * The Calendar view (D25) — the scheduling view, tasks laid out by `due_at`.
 * Month or week grid; each dated task is a chip on its day; drag a chip to
 * another day to reschedule (optimistic `PATCH /v1/tasks/:id {due_at}` via
 * `useTaskReschedule`). Click a chip → its source message + conversation. A
 * separate Gantt/timeline is intentionally NOT built (D25 — calendar covers
 * scheduling for this ICP).
 */
export function CalendarView({ state }: { state: TaskPageState }) {
  const [mode, setMode] = useState<CalMode>("month");
  const [cursor, setCursor] = useState(() => new Date());

  // The visible grid always spans whole weeks so the month grid is rectangular.
  const { gridStart, gridEnd, days } = useMemo(() => {
    if (mode === "week") {
      const s = startOfWeek(cursor);
      const e = endOfWeek(cursor);
      return { gridStart: s, gridEnd: e, days: eachDayOfInterval({ start: s, end: e }) };
    }
    const s = startOfWeek(startOfMonth(cursor));
    const e = endOfWeek(endOfMonth(cursor));
    return { gridStart: s, gridEnd: e, days: eachDayOfInterval({ start: s, end: e }) };
  }, [mode, cursor]);

  // Fetch every task due within the visible window (+ the tab/chip scope). The
  // due-range makes this a due-sorted query; a large page covers a month.
  const filters = {
    ...toTaskFilters(state),
    status: undefined,
    overdue: undefined,
    due_after: gridStart.toISOString(),
    due_before: addDays(gridEnd, 1).toISOString(),
  };
  // Drain every page in the visible window so no dated chip past page 1 is
  // dropped from the month/week grid.
  const query = useAllTasks(filters);
  const tasks = flattenPages(query.data);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (task.due_at === null) continue;
      const key = format(new Date(task.due_at), "yyyy-MM-dd");
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    return map;
  }, [tasks]);

  const step = (dir: 1 | -1) =>
    setCursor((c) => (mode === "week" ? addWeeks(c, dir) : addMonths(c, dir)));

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => step(-1)}
            aria-label={mode === "week" ? "Previous week" : "Previous month"}
          >
            <ChevronLeft className="size-4" strokeWidth={1.75} />
          </Button>
          <h2 className="min-w-[140px] text-center text-sm font-semibold tabular-nums text-foreground">
            {format(cursor, mode === "week" ? "MMM d, yyyy" : "MMMM yyyy")}
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => step(1)}
            aria-label={mode === "week" ? "Next week" : "Next month"}
          >
            <ChevronRight className="size-4" strokeWidth={1.75} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCursor(new Date())}
            className="ml-1"
          >
            Today
          </Button>
        </div>
        <div role="tablist" aria-label="Calendar range" className="flex rounded-lg bg-muted p-0.5">
          {(["month", "week"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "rounded-md px-3 py-1 text-[13px] font-medium capitalize transition-colors duration-150 ease-out",
                mode === m ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </header>

      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-7 border-b border-border">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div
                key={d}
                className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {d}
              </div>
            ))}
          </div>
          <div
            className={cn(
              "grid grid-cols-7",
              mode === "week" ? "grid-rows-1" : "auto-rows-fr",
            )}
          >
            {days.map((day) => (
              <DayCell
                key={day.toISOString()}
                day={day}
                inMonth={mode === "week" || isSameMonth(day, cursor)}
                tasks={byDay.get(format(day, "yyyy-MM-dd")) ?? []}
                weekMode={mode === "week"}
              />
            ))}
          </div>
        </div>
      </div>
      {query.isError && (
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load your scheduled tasks. Try again.
        </p>
      )}
      {/* Teach the calendar rather than leave it reading as broken: when no
          task in the visible window has a due date, explain how they appear. */}
      {!query.isPending && !query.isError && tasks.length === 0 && (
        <div className="rounded-app-card border border-app-line bg-app-stone-1 px-4 py-3 text-center">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            No tasks are scheduled in this range. A task appears here once it has
            a <span className="font-medium text-foreground">due date</span>.
            Set one on a task from its row, the checklist, or its detail drawer,
            then drag it between days to reschedule.
          </p>
        </div>
      )}
    </div>
  );
}

/** One day cell — a drop target for reschedule + its dated task chips. */
function DayCell({
  day,
  inMonth,
  tasks,
  weekMode,
}: {
  day: Date;
  inMonth: boolean;
  tasks: Task[];
  weekMode: boolean;
}) {
  const reschedule = useTaskReschedule();
  const [over, setOver] = useState(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const taskId = e.dataTransfer.getData("text/task-id");
    const conversationId = e.dataTransfer.getData("text/task-conversation");
    const dueRaw = e.dataTransfer.getData("text/task-due");
    if (!taskId || !conversationId) return;
    // Preserve the original time-of-day; only move the calendar date.
    const prev = dueRaw ? new Date(dueRaw) : new Date();
    const next = new Date(day);
    next.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
    if (isSameDay(prev, next)) return;
    reschedule.mutate({ taskId, conversationId, due_at: next.toISOString() });
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex flex-col gap-1 border-b border-r border-border-subtle p-1.5",
        weekMode ? "min-h-[320px]" : "min-h-[104px]",
        !inMonth && "bg-muted/30",
        over && "bg-primary/5 ring-1 ring-inset ring-primary/40",
      )}
    >
      <span
        className={cn(
          "flex size-6 items-center justify-center self-start rounded-full text-[12px] tabular-nums",
          isToday(day)
            ? "bg-primary font-semibold text-primary-foreground"
            : inMonth
              ? "text-foreground"
              : "text-muted-foreground",
        )}
      >
        {format(day, "d")}
      </span>
      <div className="flex flex-col gap-1">
        {tasks.map((task) => (
          <DayChip key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}

/** A calm draggable day chip → its source message + conversation. */
function DayChip({ task }: { task: Task }) {
  return (
    <Link
      href={taskThreadHref(task)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/task-id", task.id);
        e.dataTransfer.setData("text/task-conversation", task.conversation_id);
        e.dataTransfer.setData("text/task-due", task.due_at ?? "");
      }}
      title={task.title}
      className={cn(
        "block cursor-grab truncate rounded-md px-1.5 py-1 text-[12px] font-medium active:cursor-grabbing",
        task.done
          ? "bg-success/10 text-emerald-700 line-through opacity-70 dark:text-success"
          : "bg-secondary text-secondary-foreground hover:bg-primary/10 hover:text-primary",
      )}
    >
      {task.title}
    </Link>
  );
}
