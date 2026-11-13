"use client";

import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarClock, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { LoadError } from "@/components/ui/load-error";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SECTION_LABEL_CLASS } from "@/components/ui/section-label";
import { Button } from "@/components/ui/button";
import {
  RecordContextMenu,
  RecordOverflowMenu,
} from "@/components/ui/record-menu";
import { useT, type MessageKey } from "@/i18n/provider";
import { useCompany } from "@/lib/api/companies";
import { useAllTasks } from "@/lib/api/tasks";
import {
  browserTimezone,
  formatWallDay,
  formatWallHour,
} from "@/lib/format/time";
import { flattenPages } from "@/lib/api/pagination";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/api/types";

import { openNewTask } from "../new-task";
import { taskThreadId } from "../task-format";
import { taskLinkClickHandler, useTaskDrawer } from "../use-task-drawer";
import { useTaskRowActions } from "../task-actions";
import { useTaskReschedule } from "../use-task-mutations";
import { toTaskFilters, type TaskPageState } from "../task-view-url";
import {
  dayKey,
  dueCell,
  droppedDueAt,
  slotDueValue,
  todayInZone,
  windowInstants,
} from "./calendar-create";

type CalMode = "month" | "week";

/** The weekday strip, Sunday-first, as catalogue keys rather than words. */
const DOW_KEYS: readonly MessageKey[] = [
  "tasks.dowSun",
  "tasks.dowMon",
  "tasks.dowTue",
  "tasks.dowWed",
  "tasks.dowThu",
  "tasks.dowFri",
  "tasks.dowSat",
];

/** The two range buttons, whose visible word is lower-cased and CSS-capitalized. */
const RANGE_KEYS: Record<CalMode, MessageKey> = {
  month: "tasks.calendarRangeMonth",
  week: "tasks.calendarRangeWeek",
};

/**
 * The Calendar view (D25) — the scheduling view, tasks laid out by `due_at`.
 * Month or week grid; each dated task is a chip on its day; drag a chip to
 * another day to reschedule (optimistic `PATCH /v1/tasks/:id {due_at}` via
 * `useTaskReschedule`). Click a chip → its source message + conversation. A
 * separate Gantt/timeline is intentionally NOT built (D25 — calendar covers
 * scheduling for this ICP).
 */
export function CalendarView({ state }: { state: TaskPageState }) {
  const t = useT();
  const [mode, setMode] = useState<CalMode>("month");
  const company = useCompany();
  // Every day, hour and "today" on this grid is the WORKSPACE's clock: a
  // dispatcher in Vancouver looking at a Toronto crew's week sees Toronto's.
  const timeZone = company.data?.timezone ?? browserTimezone() ?? "UTC";
  const today = todayInZone(new Date(), timeZone);
  const [picked, setPicked] = useState<Date | null>(null);
  const cursor = picked ?? today;
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // The fetch always covers the month grid around the cursor, whole weeks so
  // it is rectangular; a week is sliced out of it, so stepping weeks inside a
  // month and switching to Week reuse the month's answer.
  const { gridStart, gridEnd, days } = useMemo(() => {
    const s = startOfWeek(startOfMonth(cursor));
    const e = endOfWeek(endOfMonth(cursor));
    const visible =
      mode === "week"
        ? eachDayOfInterval({ start: startOfWeek(cursor), end: endOfWeek(cursor) })
        : eachDayOfInterval({ start: s, end: e });
    return { gridStart: s, gridEnd: e, days: visible };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `cursor` is derived from picked and the zone
  }, [mode, picked, timeZone]);

  // Fetch every task due within the window (+ the tab/chip scope). The
  // due-range makes this a due-sorted query.
  const range = windowInstants(gridStart, gridEnd, timeZone);
  const filters = {
    ...toTaskFilters(state),
    status: undefined,
    overdue: undefined,
    due_after: range.after,
    due_before: range.before,
  };
  // Drain every page in the window so no dated chip past page 1 is dropped.
  // The workspace clock decides the window, so wait for it rather than ask
  // once in the device's zone and again in the workspace's.
  const query = useAllTasks(filters, {
    enabled: company.isSuccess || company.isError,
  });
  const visibleKeys = useMemo(() => new Set(days.map(dayKey)), [days]);
  // The status dimension is applied here rather than on the wire: the fetch
  // covers the visible window in one due-sorted query, so narrowing it
  // server-side would cost a refetch per tab. Without this the Open and Done
  // pills stayed lit and changed nothing, which is what both phone apps
  // already got right (matchesCalendarTab).
  const tasks = flattenPages(query.data).filter((task) => {
    if (task.due_at === null || !visibleKeys.has(dueCell(task.due_at, timeZone).key)) {
      return false;
    }
    if (state.tab === "open") return !task.done;
    if (state.tab === "done") return task.done;
    return true;
  });

  // Month cells are keyed by day, week slots by day and hour, both on the
  // workspace clock.
  const byCell = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (task.due_at === null) continue;
      const cell = dueCell(task.due_at, timeZone);
      const key = mode === "week" ? `${cell.key}T${cell.hour}` : cell.key;
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tasks` is rebuilt each render; its inputs are the deps
  }, [query.data, state.tab, mode, timeZone, visibleKeys]);

  const step = (dir: 1 | -1) =>
    setPicked(mode === "week" ? addWeeks(cursor, dir) : addMonths(cursor, dir));

  const todayKey = dayKey(today);
  const cellKeys = useMemo(
    () =>
      mode === "week"
        ? days.flatMap((d) => Array.from({ length: 24 }, (_, h) => `${dayKey(d)}T${h}`))
        : days.map(dayKey),
    [mode, days],
  );
  // One tab stop for the whole grid (roving): the arrows move within it.
  const tabStop = cellKeys.includes(activeKey ?? "")
    ? activeKey
    : mode === "week"
      ? (cellKeys.find((k) => k.startsWith(todayKey)) ?? cellKeys[0])
      : cellKeys.includes(todayKey)
        ? todayKey
        : cellKeys[0];

  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Open the week at the working day, not at midnight.
    if (mode === "week" && bodyRef.current) bodyRef.current.scrollTop = 7 * 32;
  }, [mode]);

  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.hasAttribute("data-create-cell")) return;
    const delta: Record<string, number> =
      mode === "week"
        ? { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -24, ArrowRight: 24 }
        : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const move = delta[e.key];
    if (move === undefined) return;
    const cells = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("[data-create-cell]"),
    );
    const next = cells[cells.indexOf(target) + move];
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  const createAt = (day: Date, hour: number | null) =>
    openNewTask({ due: slotDueValue(day, hour), timeZone });

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => step(-1)}
            aria-label={
              mode === "week"
                ? t("tasks.calendarPreviousWeek")
                : t("tasks.calendarPreviousMonth")
            }
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
            aria-label={
              mode === "week"
                ? t("tasks.calendarNextWeek")
                : t("tasks.calendarNextMonth")
            }
          >
            <ChevronRight className="size-4" strokeWidth={1.75} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPicked(null)}
            className="ml-1"
          >
            {t("tasks.today")}
          </Button>
        </div>
        <SegmentedControl
          ariaLabel={t("tasks.calendarRangeAria")}
          value={mode}
          onChange={setMode}
          options={(["month", "week"] as const).map((m) => ({
            value: m,
            label: t(RANGE_KEYS[m]),
          }))}
        />
      </header>

      <div className="overflow-x-auto">
        <div
          className="min-w-[640px]"
          onKeyDown={onGridKeyDown}
          aria-busy={query.isPlaceholderData}
        >
          <div
            className={cn(
              "grid border-b border-border",
              mode === "week" ? WEEK_COLUMNS : "grid-cols-7",
            )}
          >
            {mode === "week" && <div aria-hidden />}
            {/* One header per weekday: the first week of a month grid, or the week itself. */}
            {days.slice(0, 7).map((day) => (
              <div
                key={dayKey(day)}
                className={cn(SECTION_LABEL_CLASS, "flex items-center gap-1.5 px-2 py-1.5")}
              >
                {t(DOW_KEYS[day.getDay()]!)}
                {mode === "week" && (
                  <DayNumber day={day} todayKey={todayKey} inMonth />
                )}
              </div>
            ))}
          </div>
          {mode === "week" ? (
            <div ref={bodyRef} className="max-h-[36rem] overflow-y-auto">
              <div
                className={cn("grid", WEEK_COLUMNS)}
                style={{ gridTemplateRows: "repeat(24, minmax(2rem, auto))" }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    aria-hidden
                    style={{ gridColumn: 1, gridRow: h + 1 }}
                    className="pr-1.5 pt-0.5 text-right text-[10px] tabular-nums text-muted-foreground"
                  >
                    {formatWallHour(h, t.locale)}
                  </div>
                ))}
                {days.map((day, col) =>
                  Array.from({ length: 24 }, (_, h) => {
                    const key = `${dayKey(day)}T${h}`;
                    return (
                      <Cell
                        key={key}
                        day={day}
                        hour={h}
                        cellKey={key}
                        timeZone={timeZone}
                        tabStop={tabStop === key}
                        onActive={setActiveKey}
                        onCreate={createAt}
                        tasks={byCell.get(key) ?? []}
                        style={{ gridColumn: col + 2, gridRow: h + 1 }}
                        className="min-h-8"
                      />
                    );
                  }),
                )}
              </div>
            </div>
          ) : (
            <div className="grid auto-rows-fr grid-cols-7">
              {days.map((day) => (
                <Cell
                  key={day.toISOString()}
                  day={day}
                  hour={null}
                  cellKey={dayKey(day)}
                  timeZone={timeZone}
                  tabStop={tabStop === dayKey(day)}
                  onActive={setActiveKey}
                  onCreate={createAt}
                  tasks={byCell.get(dayKey(day)) ?? []}
                  className="min-h-[104px]"
                  header={
                    <DayNumber
                      day={day}
                      todayKey={todayKey}
                      inMonth={isSameMonth(day, cursor)}
                    />
                  }
                  dim={!isSameMonth(day, cursor)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {query.isError && (
        <LoadError
          message={t("tasks.calendarLoadFailed")}
          onRetry={() => void query.refetch()}
        />
      )}
      {/* Teach the calendar rather than leave it reading as broken: when no
          task in the visible window has a due date, explain how they appear. */}
      {!query.isPending && !query.isPlaceholderData && !query.isError && tasks.length === 0 && (
        <div className="rounded-app-card border border-app-line bg-app-inset px-4 py-3 text-center">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {t("tasks.calendarEmptyBefore")}
            <span className="font-medium text-foreground">
              {t("tasks.calendarEmptyDueDate")}
            </span>
            {t("tasks.calendarEmptyAfter")}
          </p>
        </div>
      )}
    </div>
  );
}

const WEEK_COLUMNS = "grid-cols-[3rem_repeat(7,minmax(0,1fr))]";

function DayNumber({
  day,
  todayKey,
  inMonth,
}: {
  day: Date;
  todayKey: string;
  inMonth: boolean;
}) {
  return (
    <span
      className={cn(
        "flex size-6 items-center justify-center self-start rounded-full text-[12px] tabular-nums",
        dayKey(day) === todayKey
          ? "bg-primary font-semibold text-primary-foreground"
          : inMonth
            ? "text-foreground"
            : "text-muted-foreground",
      )}
    >
      {format(day, "d")}
    </span>
  );
}

/**
 * One day (month) or one hour of one day (week): a drop target for reschedule,
 * its dated task chips, and the way to make a task there.
 *
 * #739: the empty part of the cell is a real button behind the chips, so a
 * click or tap on free space opens New task due then, Enter does the same from
 * the keyboard, and the chips keep their own links. Tasks have no duration, so
 * there is no drag-to-create; the click is the whole gesture, which is also
 * what WCAG 2.5.7 asks for. *Applying: Smart Defaults, Prioritize Intent.*
 */
function Cell({
  day,
  hour,
  cellKey,
  timeZone,
  tabStop,
  onActive,
  onCreate,
  tasks,
  header,
  dim,
  style,
  className,
}: {
  day: Date;
  hour: number | null;
  cellKey: string;
  timeZone: string;
  tabStop: boolean;
  onActive: (key: string) => void;
  onCreate: (day: Date, hour: number | null) => void;
  tasks: Task[];
  header?: React.ReactNode;
  dim?: boolean;
  style?: React.CSSProperties;
  className?: string;
}) {
  const t = useT();
  const reschedule = useTaskReschedule();
  const [over, setOver] = useState(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const taskId = e.dataTransfer.getData("text/task-id");
    const conversationId = e.dataTransfer.getData("text/task-conversation");
    const dueRaw = e.dataTransfer.getData("text/task-due");
    if (!taskId || !conversationId) return;
    // Month: keep the time of day, move the date. Week: the slot names the hour.
    const next = droppedDueAt(dueRaw || null, day, hour, timeZone);
    if (next === null) return;
    reschedule.mutate({ taskId, conversationId, due_at: next });
  };

  const date = formatWallDay(dayKey(day), t.locale);
  const label =
    hour === null
      ? t("tasks.calendarCreateDay", { date })
      : t("tasks.calendarCreateSlot", { date, time: formatWallHour(hour, t.locale) });

  return (
    <div
      style={style}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        // Only clear when the pointer truly exits the cell (dragleave also
        // fires when crossing onto a child chip) — otherwise the highlight flickers.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOver(false);
        }
      }}
      onDrop={onDrop}
      className={cn(
        "relative flex flex-col gap-1 border-b border-r border-border-subtle p-1.5",
        dim && "bg-muted/30",
        over && "bg-primary/5 ring-1 ring-inset ring-primary/40",
        className,
      )}
    >
      <button
        type="button"
        data-create-cell
        aria-label={label}
        tabIndex={tabStop ? 0 : -1}
        onFocus={() => onActive(cellKey)}
        onClick={() => onCreate(day, hour)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // Handled here so Enter never also fires a second click.
          e.preventDefault();
          onCreate(day, hour);
        }}
        className="group/create absolute inset-0 flex items-end justify-end p-1 text-muted-foreground outline-none hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <Plus
          className="size-3.5 opacity-0 transition-opacity duration-150 group-hover/create:opacity-70 group-focus-visible/create:opacity-70"
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
      <div className="pointer-events-none relative flex flex-col gap-1">
        {header}
        <div className="pointer-events-auto flex flex-col gap-1">
          {tasks.map((task) => (
            <DayChip key={task.id} task={task} />
          ))}
        </div>
      </div>
    </div>
  );
}

export { movedDueAt, RESCHEDULE_MOVES } from "../task-reschedule";

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
  const t = useT();
  const { actions, dialogs } = useTaskRowActions(task);
  const { hrefForTask } = useTaskDrawer();

  return (
    <RecordContextMenu actions={actions}>
    <div className="group/chip flex items-center gap-0.5">
      <Link
        href={hrefForTask(task.id)}
        scroll={false}
        onClick={taskLinkClickHandler(task.id)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/task-id", task.id);
          e.dataTransfer.setData("text/task-conversation", taskThreadId(task));
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
      {/* #712: the chip's ⋯ and its right-click menu are the SAME list as the
          board card's and the task panel's. The trigger stays in the DOM, never
          hover-only (#238), and absent only when nothing is allowed. */}
      <RecordOverflowMenu
        actions={actions}
        label={t("tasks.rescheduleAria", { title: task.title })}
        trigger={
          <button
            type="button"
            // Named for the task, because a screen reader reading thirty of
            // these needs to know which job each one moves.
            aria-label={t("tasks.rescheduleAria", { title: task.title })}
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-40 transition-opacity duration-150 ease-out hover:bg-primary/10 hover:opacity-100 focus-visible:opacity-100 group-hover/chip:opacity-100 data-[state=open]:opacity-100"
          >
            <CalendarClock className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        }
      />
      {dialogs}
    </div>
    </RecordContextMenu>
  );
}
