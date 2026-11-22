"use client";

import { ArrowDown, ArrowUp, CalendarClock, GripVertical, Lock, Navigation, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { MemberAvatar } from "@/components/inbox/member-avatar";
import { useT } from "@/i18n/provider";
import { formatScheduleDay, formatScheduledTime, instantFromZonedWallClock, zonedWallClock } from "@/lib/format/time";
import { cn } from "@/lib/utils";

import { blocksOnDay } from "./dispatch-data";
import type { DispatchBlock, DispatchDay, DispatchPlan, DispatchPreview, DispatchRoute, DispatchTask } from "./dispatch-data";
import { useTaskDrawer } from "./use-task-drawer";

const RouteMap = dynamic(() => import("./dispatch-map").then((module) => module.DispatchMap), { ssr: false });
const HOUR = 3_600_000;
const MINUTE = 60_000;
const SLOT = 15 * MINUTE;
const MIME = "application/x-loonext-dispatch";
const panel = "rounded-xl border bg-card text-card-foreground";
const note = "text-sm text-app-muted";

interface DraggedWork {
  task: DispatchTask;
  block?: DispatchBlock;
}

function shiftTime(date: string, time: string, timezone: string) {
  const instant = instantFromZonedWallClock(`${date}T${time}`, timezone);
  return instant.ok ? Date.parse(instant.iso) : null;
}

function taskForBlock(plan: DispatchPlan, block: DispatchBlock) {
  return plan.tasks.find((task) => task.id === block.task_id);
}

function timeSpan(plan: DispatchPlan, block: DispatchBlock, locale: string) {
  return `${formatScheduledTime(block.starts_at, locale, plan.timezone)}–${formatScheduledTime(block.ends_at, locale, plan.timezone)}`;
}

export function DispatchSchedule({ plan, day, focused, editable, onSelect, onStageBlock }: {
  plan: DispatchPlan;
  day: DispatchDay;
  focused: string;
  editable: boolean;
  onSelect: (task: DispatchTask, block?: DispatchBlock, assignee?: string, time?: string) => void;
  onStageBlock: (task: DispatchTask, block: DispatchBlock) => void;
}) {
  const t = useT();
  const { openTask } = useTaskDrawer();
  const id = useId();
  const dragged = useRef<DraggedWork | null>(null);
  const touchOrigin = useRef<{ x: number; y: number } | null>(null);
  const resizeOrigin = useRef<{ x: number; laneWidth: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ assignee: string; start: number } | null>(null);
  const [resize, setResize] = useState<{ id: string; end: number } | null>(null);
  const dayStart = Date.parse(day.start);
  const dayEnd = Date.parse(day.end);
  const blocks = blocksOnDay(plan, day.date);
  const unplanned = plan.tasks.filter((task) => !task.done && task.scheduled_count === 0).slice(0, 200);
  const weekday = new Date(`${day.date}T12:00:00Z`).getUTCDay();
  const shifts = plan.members.flatMap((member) => {
    const shift = member.shifts?.[String(weekday)];
    return shift?.start && shift.end ? [{
      start: shiftTime(day.date, shift.start, plan.timezone),
      end: shiftTime(day.date, shift.end, plan.timezone),
    }] : [];
  });
  const starts = [...shifts.flatMap(({ start }) => start ?? []), ...blocks.map((block) => Date.parse(block.starts_at))];
  const ends = [...shifts.flatMap(({ end }) => end ?? []), ...blocks.map((block) => Date.parse(block.ends_at))];
  const closed = day.closed && !day.opens_at && shifts.length === 0 && blocks.length === 0;
  if (day.opens_at || shifts.length === 0) starts.push(Date.parse(day.opens_at ?? day.start));
  if (day.closes_at || shifts.length === 0) ends.push(Date.parse(day.closes_at ?? day.end));
  const first = Math.max(dayStart, starts.length > 0 ? Math.min(...starts) : dayStart);
  const last = Math.min(dayEnd, ends.length > 0 ? Math.max(...ends) : dayEnd);
  const range = Math.max(HOUR, last - first);
  const hours = Array.from({ length: Math.ceil(range / HOUR) }, (_, index) => first + index * HOUR);
  const labelStep = hours.length > 12 ? 2 : 1;
  const percent = (ms: number) => 100 * (ms - first) / range;

  function startDrag(event: React.DragEvent, item: DraggedWork) {
    dragged.current = item;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(MIME, item.task.id);
  }

  function finishDrag() {
    dragged.current = null;
    setDropTarget(null);
  }

  function slotAt(x: number, lane: Element) {
    const bounds = lane.getBoundingClientRect();
    const slot = Math.floor((x - bounds.left) / bounds.width * range / SLOT);
    const lastSlot = Math.ceil((last - first) / SLOT) - 1;
    return first + Math.max(0, Math.min(lastSlot, slot)) * SLOT;
  }

  function place(item: DraggedWork, assignee: string, start: number) {
    const length = item.block
      ? Date.parse(item.block.ends_at) - Date.parse(item.block.starts_at)
      : (item.task.dispatch_estimate ?? 0) * MINUTE;
    const starts_at = new Date(start).toISOString();
    if (length <= 0) {
      const wall = zonedWallClock(starts_at, plan.timezone);
      const time = wall && `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;
      onSelect(item.task, undefined, assignee, time ?? undefined);
      return;
    }
    const booking = item.block ?? {
      id: crypto.randomUUID(), task_id: item.task.id, visit: false, locked: false, address_confirmed: false,
    };
    onStageBlock(item.task, {
      ...booking, assignee_id: assignee, starts_at, ends_at: new Date(start + length).toISOString(),
    });
  }

  function touchTarget(event: React.PointerEvent<HTMLSpanElement>) {
    const lane = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-dispatch-assignee]");
    const assignee = lane?.dataset.dispatchAssignee;
    return lane && assignee ? { assignee, start: slotAt(event.clientX, lane) } : null;
  }

  function touchGrip(item: DraggedWork) {
    return <span className="grid min-h-8 min-w-6 shrink-0 touch-none cursor-grab place-items-center text-app-muted" aria-hidden
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" || !event.isPrimary) return;
        touchOrigin.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={(event) => {
        const origin = touchOrigin.current;
        if (!event.isPrimary || !origin) return;
        if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6) {
          dragged.current = item;
          setDropTarget(touchTarget(event));
        }
      }} onPointerUp={(event) => {
        if (!event.isPrimary || !touchOrigin.current) return;
        const target = dragged.current ? touchTarget(event) : null;
        touchOrigin.current = null;
        finishDrag();
        if (target && editable) place(item, target.assignee, target.start);
      }} onClick={(event) => {
        if (event.nativeEvent instanceof PointerEvent && event.nativeEvent.pointerType !== "mouse") event.stopPropagation();
      }} onLostPointerCapture={() => {
        touchOrigin.current = null;
        finishDrag();
      }}>
      <GripVertical className="size-4" />
    </span>;
  }

  function resizedEnd(block: DispatchBlock, x: number) {
    const origin = resizeOrigin.current;
    if (!origin) return null;
    const start = Date.parse(block.starts_at);
    const end = Date.parse(block.ends_at) + Math.round((x - origin.x) / origin.laneWidth * range / SLOT) * SLOT;
    return Math.max(start + 5 * MINUTE, Math.min(end, dayEnd, start + 12 * HOUR));
  }

  return (
    <div className="grid items-start gap-3 lg:grid-cols-[minmax(230px,1fr)_minmax(0,3fr)]">
      <section className={panel} aria-labelledby={`${id}-queue`}>
        <h2 id={`${id}-queue`} className="border-b px-4 py-3 text-sm font-semibold">{t("tasks.dispatchQueue")}</h2>
        {unplanned.length === 0 && <p className={cn(note, "p-4")}>{t("tasks.dispatchQueueEmpty")}</p>}
        <ul className="max-h-44 divide-y overflow-y-auto lg:max-h-120">
          {unplanned.map((task) => (
            <li key={task.id} className="flex items-center gap-2 px-4 py-2">
              <div className="min-w-0 flex-1">
                <button type="button" className="flex min-h-8 max-w-full items-center gap-1.5 text-left text-sm font-medium hover:underline"
                  draggable={editable && !closed} onDragStart={(event) => startDrag(event, { task })} onDragEnd={finishDrag}
                  onClick={() => openTask(task.id)}>
                  {editable && !closed && touchGrip({ task })}
                  {task.title}
                </button>
                <p className="text-xs text-app-muted">{task.dispatch_estimate === null
                  ? t("tasks.dispatchEstimateMissing") : t("tasks.dispatchDurationValue", { minutes: task.dispatch_estimate })}</p>
              </div>
              {editable && <Button variant="ghost" size="icon" aria-label={`${t("tasks.dispatchNewBlock")} · ${task.title}`}
                onClick={() => onSelect(task)}><Plus aria-hidden /></Button>}
            </li>
          ))}
        </ul>
        {plan.queue_truncated && <p className={cn(note, "border-t p-4")}>{t("tasks.dispatchQueueLimit")}</p>}
      </section>
      {closed ? <section className={cn(panel, "p-4")} aria-label={t("tasks.schedule")}>
        <p className={note}>{t("tasks.dispatchClosedDay")}</p>
      </section> : <section
        className={cn(panel, "overflow-x-auto")}
        aria-label={t("tasks.schedule")}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The timeline needs keyboard scrolling.
        tabIndex={0}
      >
        <div style={{ minWidth: 128 + Math.ceil(hours.length / labelStep) * 57 }}>
          <div className="flex border-b">
            <h2 className="w-32 shrink-0 px-3 py-3 text-sm font-semibold">{t("tasks.schedule")}</h2>
            <div className="relative h-11 grow">
              {hours.filter((_, index) => index % labelStep === 0).map((hour) => (
                <span className="absolute top-3 border-l pl-1 text-xs whitespace-nowrap text-app-muted" key={hour}
                  style={{ left: `${percent(hour)}%` }}>{formatScheduledTime(new Date(hour).toISOString(), t.locale, plan.timezone)}</span>
              ))}
            </div>
          </div>
          {plan.members.map((member) => (
            <div className={cn("flex border-b last:border-b-0", focused === member.id && "bg-muted")} key={member.id}>
<<<<<<< HEAD
              <h3 className="flex w-32 shrink-0 items-start gap-2 break-words px-3 py-3 text-sm font-medium">
                <MemberAvatar name={member.name ?? t("tasks.teammate")} memberId={member.id} />
                <span>{member.name ?? t("tasks.teammate")}</span>
              </h3>
              <div className="relative min-h-24 grow border-l" onDragOver={(event) => {
=======
              <h3 className="w-32 shrink-0 break-words px-3 py-3 text-sm font-medium">{member.name ?? t("tasks.teammate")}</h3>
              <div data-dispatch-assignee={member.id} className="relative min-h-24 grow border-l" onDragOver={(event) => {
>>>>>>> 9486b6cf3 (fix: keep planner gestures usable on compact screens)
                if (editable && dragged.current && event.dataTransfer.types.includes(MIME)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTarget({ assignee: member.id, start: slotAt(event.clientX, event.currentTarget) });
                }
              }} onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
              }} onDrop={(event) => {
                const item = dragged.current;
                if (!editable || !item || event.dataTransfer.getData(MIME) !== item.task.id) return;
                event.preventDefault();
                finishDrag();
                place(item, member.id, slotAt(event.clientX, event.currentTarget));
              }}>
                {hours.map((hour) => <div key={hour} aria-hidden className="absolute inset-y-0 border-l" style={{ left: `${percent(hour)}%` }} />)}
                {dropTarget?.assignee === member.id && <div aria-hidden className="pointer-events-none absolute inset-y-0 z-3 border-l-2 border-primary"
                  style={{ left: `${percent(dropTarget.start)}%` }}>
                  <span className="rounded-r bg-primary px-1.5 py-0.5 text-xs whitespace-nowrap text-primary-foreground">
                    {formatScheduledTime(new Date(dropTarget.start).toISOString(), t.locale, plan.timezone)}
                  </span>
                </div>}
                {blocks.filter((item) => item.assignee_id === member.id).map((item, index) => {
                  const task = taskForBlock(plan, item);
                  if (!task) return null;
                  const left = Math.max(0, percent(Date.parse(item.starts_at)));
                  const end = resize?.id === item.id ? resize.end : Date.parse(item.ends_at);
                  const right = Math.min(100, percent(end));
                  const movable = editable && !item.locked;
                  const shown = { ...item, ends_at: new Date(end).toISOString() };
                  return <div key={item.id} className="absolute z-1 flex min-h-9 min-w-24 rounded-md border bg-secondary text-secondary-foreground focus-within:z-2"
                    style={{ left: `min(${left}%, calc(100% - 6rem))`, width: `${right - left}%`, top: index % 2 ? 49 : 8 }}>
                    <button type="button" className={cn("min-w-0 flex-1 overflow-hidden rounded-l-md px-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring", movable && "cursor-grab")}
                      title={`${task.title} · ${timeSpan(plan, shown, t.locale)}${item.locked ? ` · ${t("tasks.dispatchLocked")}` : ""}`}
                      draggable={movable} onDragStart={(event) => startDrag(event, { task, block: item })} onDragEnd={finishDrag}
                      onClick={() => editable ? onSelect(task, item) : openTask(task.id)}>
                      <span className="flex items-center gap-1 truncate">
                        {item.locked && <Lock className="size-3 shrink-0" aria-hidden />}
                        {movable && touchGrip({ task, block: item })}
                        {task.title}
                      </span>
                      <span className="block truncate">{timeSpan(plan, shown, t.locale)}</span>
                    </button>
                    {movable && <button type="button" aria-label={t("tasks.dispatchResizeBlock", { title: task.title })}
                      className="grid w-6 shrink-0 touch-none cursor-ew-resize place-items-center rounded-r-md border-l text-app-muted hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={(event) => { if (event.detail === 0) onSelect(task, item); }}
                      onPointerDown={(event) => {
                        if (!event.isPrimary || event.button !== 0) return;
                        resizeOrigin.current = { x: event.clientX, laneWidth: event.currentTarget.parentElement?.parentElement?.clientWidth ?? 1 };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }} onPointerMove={(event) => {
                        const next = resizedEnd(item, event.clientX);
                        if (next !== null) setResize({ id: item.id, end: next });
                      }} onPointerUp={(event) => {
                        const next = resizedEnd(item, event.clientX);
                        resizeOrigin.current = null;
                        setResize(null);
                        if (next !== null && next !== Date.parse(item.ends_at)) {
                          onStageBlock(task, { ...item, ends_at: new Date(next).toISOString() });
                        }
                      }} onLostPointerCapture={() => { resizeOrigin.current = null; setResize(null); }}>
                      <GripVertical className="size-3.5" aria-hidden />
                    </button>}
                  </div>;
                })}
              </div>
            </div>
          ))}
        </div>
      </section>}
    </div>
  );
}

export function DispatchWorkload({ plan, rows, date, onFocus }: {
  plan: DispatchPlan;
  rows: DispatchPreview["workload"];
  date: string;
  onFocus: (assignee: string, date: string) => void;
}) {
  const t = useT();
  const id = useId();
  const { openTask } = useTaskDrawer();
  const lastDay = plan.days.at(-1)?.date ?? "";
  const start = Date.parse(plan.days[0]?.start ?? "");
  const end = Date.parse(plan.days.at(-1)?.end ?? "");
  const queue = plan.tasks.filter((task) => {
    if (task.done || task.assigned_user_id || task.scheduled_count > 0) return false;
    if (task.due_on) return task.due_on >= (plan.days[0]?.date ?? "") && task.due_on <= lastDay;
    const due = Date.parse(task.due_at ?? "");
    return due >= start && due < end;
  });

  function workload(assignee: string, day: string) {
    const cell = rows.find((value) => value.assignee_id === assignee && value.date === day);
    const available = cell?.available;
    const booked = Math.round(cell?.booked ?? 0);
    const overCapacity = cell?.overloaded ?? (available != null && booked > available);
    return <span className={cn("block tabular-nums", overCapacity && "text-destructive")}>
      {t("tasks.dispatchDurationValue", { minutes: booked })} / {available == null
        ? t("tasks.dispatchAvailabilityUnknown") : t("tasks.dispatchDurationValue", { minutes: Math.round(available) })}
      {overCapacity && <span className="block text-xs">{t("tasks.dispatchOverload")}</span>}
    </span>;
  }

  return (
    <div className="space-y-3">
      <section className={cn(panel, "md:hidden")} aria-labelledby={`${id}-booked`}>
        <h2 id={`${id}-booked`} className="border-b px-4 py-3 text-sm font-semibold">{t("tasks.dispatchBooked")}</h2>
        <ul className="divide-y">{plan.members.map((member) => <li key={member.id}>
          <button type="button" className="w-full px-4 py-3 text-left text-sm hover:bg-muted"
            onClick={() => onFocus(member.id, date)}>
            <span className="flex items-center gap-2 font-medium">
              <MemberAvatar name={member.name ?? t("tasks.teammate")} memberId={member.id} />
              {member.name ?? t("tasks.teammate")}
            </span>
            {workload(member.id, date)}
          </button>
        </li>)}</ul>
      </section>
      <section className={cn(panel, "hidden overflow-x-auto md:block")} aria-label={t("tasks.workload")}>
        <table className="w-full min-w-180 text-left text-sm">
          <thead><tr className="border-b">
            <th scope="col" className="px-4 py-3">{t("tasks.dispatchBooked")}</th>
            {plan.days.map((day) => <th scope="col" key={day.date} className="px-3 py-3">{formatScheduleDay(day.date, t.locale)}</th>)}
          </tr></thead>
          <tbody>
            {plan.members.map((member) => (
              <tr className="border-b last:border-0" key={member.id}>
                <th scope="row" className="px-4 py-3 font-medium">
                  <span className="flex items-center gap-2">
                    <MemberAvatar name={member.name ?? t("tasks.teammate")} memberId={member.id} />
                    {member.name ?? t("tasks.teammate")}
                  </span>
                </th>
                {plan.days.map((day) => <td key={day.date} className="p-1">
                  <button type="button" className="min-h-12 w-full rounded-md p-2 text-left hover:bg-muted"
                    onClick={() => onFocus(member.id, day.date)}>{workload(member.id, day.date)}</button>
                </td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className={panel} aria-labelledby={`${id}-unassigned`}>
        <h2 id={`${id}-unassigned`} className="border-b px-4 py-3 text-sm font-semibold">{t("tasks.unassigned")}</h2>
        {queue.length === 0 ? <p className={cn(note, "p-4")}>{t("tasks.dispatchQueueEmpty")}</p> : (
          <ul className="divide-y">{queue.map((task) => <li className="flex items-center justify-between gap-2 px-4 py-2" key={task.id}>
            <button type="button" className="min-h-9 text-left text-sm font-medium hover:underline" onClick={() => openTask(task.id)}>{task.title}</button>
            <span className={note}>{task.dispatch_estimate == null ? t("tasks.dispatchEstimateMissing")
              : t("tasks.dispatchDurationValue", { minutes: task.dispatch_estimate })}</span>
          </li>)}</ul>
        )}
      </section>
    </div>
  );
}

export function DispatchRoutesView({ plan, blocks, route, busy, editable, personal, onOptimize, onApply }: {
  plan: DispatchPlan;
  blocks: DispatchBlock[];
  route: DispatchRoute | null;
  busy: boolean;
  editable: boolean;
  personal?: boolean;
  onOptimize?: (order?: string[]) => void;
  onApply?: () => void;
}) {
  const t = useT();
  const id = useId();
  const { openTask } = useTaskDrawer();
  const stops = blocks.filter((block) => block.visit && block.address_confirmed);
  const other = blocks.filter((block) => !stops.includes(block));
  const proposed = new Map(route?.proposal.map((block) => [block.id, block]));
  const ordered = stops.map((block) => proposed.get(block.id) ?? block)
    .toSorted((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const movable = ordered.filter((block) => !block.locked);
  const points = ordered.flatMap((block, index) => {
    const task = taskForBlock(plan, block);
    return task?.lat == null || task.lng == null ? [] : [{ id: block.id, lat: task.lat, lng: task.lng, title: task.title, stop: index + 1 }];
  });

  function reorder(block: DispatchBlock, move: number) {
    const next = movable.map((item) => item.id);
    const from = next.indexOf(block.id);
    const to = from + move;
    [next[from], next[to]] = [next[to], next[from]];
    onOptimize?.(next);
  }

  const row = (block: DispatchBlock, index: number) => {
    const task = taskForBlock(plan, block);
    if (!task) return null;
    const stop = block.visit && block.address_confirmed;
    const position = movable.indexOf(block);
    return <li key={block.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
      {stop && !personal && <span className="grid size-7 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">{index + 1}</span>}
      <div className="min-w-32 grow">
        <button type="button" className="min-h-8 text-left text-sm font-semibold hover:underline" onClick={() => openTask(task.id)}>{task.title}</button>
        <p className={note}>{timeSpan(plan, block, t.locale)} · {stop ? task.address
          : t(block.visit ? "apiRefusals.dispatchAddress" : "tasks.dispatchRemote")}</p>
      </div>
      {block.locked && <span className="inline-flex items-center gap-1 text-xs text-app-muted"><Lock className="size-3" aria-hidden />{t("tasks.dispatchLocked")}</span>}
      {editable && position !== -1 && <>
        <Button variant="ghost" size="icon" disabled={busy || position === 0} aria-label={`${t("tasks.dispatchEarlier")} · ${task.title}`}
          onClick={() => reorder(block, -1)}><ArrowUp aria-hidden /></Button>
        <Button variant="ghost" size="icon" disabled={busy || position === movable.length - 1} aria-label={`${t("tasks.dispatchLater")} · ${task.title}`}
          onClick={() => reorder(block, 1)}><ArrowDown aria-hidden /></Button>
      </>}
      {stop && task.address && (personal || !editable) && <Button variant="outline" size="sm" asChild>
        <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(task.address)}`}>
          <Navigation aria-hidden />{t("tasks.dispatchInstructions")}
        </a>
      </Button>}
    </li>;
  };

  return (
    <div className={cn("grid items-start gap-3", points.length > 0 && !personal && "lg:grid-cols-2")}>
      <section className={panel} aria-labelledby={`${id}-route`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
          <h2 id={`${id}-route`} className="text-sm font-semibold">{t(personal ? "tasks.myDay" : "tasks.routes")}</h2>
          {editable && movable.length > 0 && <Button variant="outline" size="sm" disabled={busy}
            onClick={() => onOptimize?.()}>{t("tasks.dispatchOptimize")}</Button>}
        </div>
        {(personal ? blocks : ordered).length === 0 && <p className={cn(note, "p-4")}>
          {t(personal ? "tasks.dispatchNoBookings" : "tasks.dispatchStopsEmpty")}
        </p>}
        {route && <div className="space-y-2 border-b px-4 py-3 text-sm">
          {route.proposal.length > 0 && <p className="font-medium">{t("tasks.dispatchRoutePreview")}</p>}
          <p>{t("tasks.dispatchDrive", { before: route.before, after: route.after })}</p>
          {route.skipped.map((skip) => {
            const block = blocks.find((item) => item.id === skip.id);
            return <p className={note} key={skip.id}>
              {block && taskForBlock(plan, block)?.title}
              {" · "}{t(skip.reason === "capacity" ? "tasks.dispatchRouteCapacity" : "tasks.dispatchRouteAddress")}
            </p>;
          })}
          {route.proposal.length > 0 && <Button size="sm" disabled={busy} onClick={onApply}>
            <CalendarClock aria-hidden />{t("tasks.dispatchApplyRoute")}
          </Button>}
        </div>}
        <ol className="divide-y">{(personal ? blocks : ordered).map(row)}</ol>
        {!personal && other.length > 0 && <>
          <h3 className="border-y px-4 py-2 text-sm font-semibold">{t("tasks.dispatchOtherWork")}</h3>
          <ul className="divide-y">{other.map(row)}</ul>
        </>}
      </section>
      {!personal && points.length > 0 && <RouteMap points={points} />}
    </div>
  );
}
