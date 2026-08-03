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
import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { LoadError } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  // The status dimension is applied here rather than on the wire: the fetch
  // covers the visible window in one due-sorted query, so narrowing it
  // server-side would cost a refetch per tab. Without this the Open and Done
  // pills stayed lit and changed nothing, which is what both phone apps
  // already got right (matchesCalendarTab).
  const tasks = flattenPages(query.data).filter((task) => {
    if (state.tab === "open") return !task.done;
    if (state.tab === "done") return task.done;
    return true;
  });

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
        <div role="group" aria-label="Calendar range" className="flex rounded-lg bg-muted p-0.5">
          {(["month", "week"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
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
        <LoadError
          message="We couldn't load your scheduled tasks. Check your connection and try again."
          onRetry={() => void query.refetch()}
        />
      )}
      {/* Teach the calendar rather than leave it reading as broken: when no
          task in the visible window has a due date, explain how they appear. */}
      {!query.isPending && !query.isError && tasks.length === 0 && (
        <div className="rounded-app-card border border-app-line bg-app-inset px-4 py-3 text-center">
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
      onDragLeave={(e) => {
        // Only clear when the pointer truly exits the day cell (dragleave also
        // fires when crossing onto a child chip) — otherwise the highlight flickers.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOver(false);
        }
      }}
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

/**
 * The moves the menu offers, and why these.
 *
 * Not a full date picker. WCAG 2.5.7 asks for a way to do the DRAG without
 * dragging, and on a calendar the drag people actually perform is "this job
 * slipped, push it". Three relative moves cover that in one click; an
 * arbitrary date is still reachable by dragging or from the task itself, so
 * nothing is lost by keeping this list short enough to read.
 */
export const RESCHEDULE_MOVES: readonly { label: string; days: number }[] = [
  { label: "A day earlier", days: -1 },
  { label: "A day later", days: 1 },
  { label: "A week later", days: 7 },
];

/**
 * The new instant for a move, keeping the time of day.
 *
 * The same rule the drop handler follows: dragging a chip to another cell
 * moves the DATE and leaves the appointment time alone, and a menu that reset
 * every job to midnight would be a different operation wearing the same name.
 */
export function movedDueAt(dueAt: string | null, days: number, now: Date): string {
  const from = dueAt ? new Date(dueAt) : now;
  const next = new Date(from);
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

/**
 * A calm draggable day chip → its source message + conversation.
 *
 * #238 / WCAG 2.2 2.5.7 — DRAGGING MOVEMENTS. Rescheduling here used to be
 * drag-only: the chip is a link, so clicking it navigated to the thread and
 * there was no other way to change a date from this screen. Anybody who cannot
 * drag — a screen-reader user, somebody on a trackpad with a tremor, anybody
 * on a touch device where the drag never registered — could see the schedule
 * and not change it.
 *
 * Design notes:
 *
 * - **A menu, not a button per chip.** The board view puts a visible "Move
 *   to…" button on each card and that is right there: a card is large and a
 *   column holds a few. A month grid holds thirty-five cells of these, and
 *   thirty-five dashed buttons would bury the schedule the view exists to
 *   show. *Applying: Zen of Clarity — secondary actions collapse into a menu.*
 *
 * - **The trigger is always in the DOM, never hover-only.** A control that
 *   appears on hover cannot be reached by the keyboard or by touch, which are
 *   the users this exists for — it would fail the rule it was added to satisfy.
 *   It is dimmed until focus or hover, so it stays quiet without being absent.
 *
 * - **A sibling of the link, not a child of it.** Interactive elements do not
 *   nest: a button inside an anchor is invalid, and screen readers disagree
 *   about what it even is.
 */
function DayChip({ task }: { task: Task }) {
  const reschedule = useTaskReschedule();

  return (
    <div className="group/chip flex items-center gap-0.5">
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
          "block min-w-0 flex-1 cursor-grab truncate rounded-md px-1.5 py-1 text-[12px] font-medium active:cursor-grabbing",
          task.done
            ? "bg-success/10 text-emerald-700 line-through opacity-70 dark:text-success"
            : "bg-secondary text-secondary-foreground hover:bg-primary/10 hover:text-primary",
        )}
      >
        {task.title}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            // Named for the task, because a screen reader reading thirty of
            // these needs to know which job each one moves.
            aria-label={`Reschedule ${task.title}`}
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-40 transition-opacity duration-150 ease-out hover:bg-primary/10 hover:opacity-100 focus-visible:opacity-100 group-hover/chip:opacity-100 data-[state=open]:opacity-100"
          >
            <CalendarClock className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {RESCHEDULE_MOVES.map((move) => (
            <DropdownMenuItem
              key={move.label}
              onSelect={() =>
                reschedule.mutate({
                  taskId: task.id,
                  conversationId: task.conversation_id,
                  due_at: movedDueAt(task.due_at, move.days, new Date()),
                })
              }
            >
              {move.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
