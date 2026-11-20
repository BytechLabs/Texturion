"use client";

import { ArrowDown, ArrowUp, CalendarClock, Lock, Navigation, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";
import { formatScheduleDay, formatScheduledTime, zonedWallClock } from "@/lib/format/time";
import { cn } from "@/lib/utils";

import { blocksOnDay } from "./dispatch-data";
import type { DispatchBlock, DispatchDay, DispatchPlan, DispatchPreview, DispatchRoute, DispatchTask } from "./dispatch-data";
import { useTaskDrawer } from "./use-task-drawer";

const RouteMap = dynamic(() => import("./dispatch-map").then((module) => module.DispatchMap), { ssr: false });
const HOUR = 3_600_000;
const MIME = "application/x-loonext-task";
const panel = "rounded-xl border bg-card text-card-foreground";
const note = "text-sm text-app-muted";

function taskForBlock(plan: DispatchPlan, block: DispatchBlock) {
  return plan.tasks.find((task) => task.id === block.task_id);
}

function timeSpan(plan: DispatchPlan, block: DispatchBlock, locale: string) {
  return `${formatScheduledTime(block.starts_at, locale, plan.timezone)}–${formatScheduledTime(block.ends_at, locale, plan.timezone)}`;
}

export function DispatchSchedule({ plan, day, focused, editable, onSelect }: {
  plan: DispatchPlan;
  day: DispatchDay;
  focused: string;
  editable: boolean;
  onSelect: (task: DispatchTask, block?: DispatchBlock, assignee?: string, time?: string) => void;
}) {
  const t = useT();
  const { openTask } = useTaskDrawer();
  const id = useId();
  const dayStart = Date.parse(day.start);
  const dayEnd = Date.parse(day.end);
  const blocks = blocksOnDay(plan, day.date);
  const unplanned = plan.tasks.filter((task) => !task.done && task.scheduled_count === 0).slice(0, 200);
  const first = Math.max(dayStart, Math.min(Date.parse(day.opens_at ?? day.start), ...blocks.map((b) => Date.parse(b.starts_at))));
  const last = Math.min(dayEnd, Math.max(Date.parse(day.closes_at ?? day.end), ...blocks.map((b) => Date.parse(b.ends_at))));
  const range = Math.max(HOUR, last - first);
  const hours = Array.from({ length: Math.ceil(range / HOUR) }, (_, index) => first + index * HOUR);
  const labelStep = hours.length > 12 ? 2 : 1;
  const percent = (ms: number) => 100 * (ms - first) / range;

  return (
    <div className="grid items-start gap-3 lg:grid-cols-[minmax(230px,1fr)_minmax(0,3fr)]">
      <section className={panel} aria-labelledby={`${id}-queue`}>
        <h2 id={`${id}-queue`} className="border-b px-4 py-3 text-sm font-semibold">{t("tasks.dispatchQueue")}</h2>
        {unplanned.length === 0 && <p className={cn(note, "p-4")}>{t("tasks.dispatchQueueEmpty")}</p>}
        <ul className="max-h-120 divide-y overflow-y-auto">
          {unplanned.map((task) => (
            <li key={task.id} className="flex items-center gap-2 px-4 py-2">
              <div className="min-w-0 flex-1">
                <button type="button" className="min-h-8 max-w-full text-left text-sm font-medium hover:underline"
                  draggable={editable} onDragStart={(event) => event.dataTransfer.setData(MIME, task.id)}
                  onClick={() => openTask(task.id)}>{task.title}</button>
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
      <section className={cn(panel, "overflow-x-auto")} aria-label={t("tasks.schedule")}>
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
              <h3 className="w-32 shrink-0 break-words px-3 py-3 text-sm font-medium">{member.name ?? t("tasks.teammate")}</h3>
              <div className="relative min-h-24 grow border-l" onDragOver={(event) => {
                if (editable && event.dataTransfer.types.includes(MIME)) event.preventDefault();
              }} onDrop={(event) => {
                if (!editable) return;
                const item = unplanned.find((task) => task.id === event.dataTransfer.getData(MIME));
                if (!item) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const at = first + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * range;
                const wall = zonedWallClock(new Date(Math.floor(at / 900_000) * 900_000).toISOString(), plan.timezone);
                const time = wall && `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;
                onSelect(item, undefined, member.id, time ?? undefined);
              }}>
                {hours.map((hour) => <div key={hour} aria-hidden className="absolute inset-y-0 border-l" style={{ left: `${percent(hour)}%` }} />)}
                {blocks.filter((item) => item.assignee_id === member.id).map((item, index) => {
                  const task = taskForBlock(plan, item);
                  if (!task) return null;
                  const left = Math.max(0, percent(Date.parse(item.starts_at)));
                  const right = Math.min(100, percent(Date.parse(item.ends_at)));
                  return <button key={item.id} type="button"
                    className="absolute z-1 min-h-9 min-w-28 overflow-hidden rounded-md border bg-secondary px-1.5 text-left text-xs text-secondary-foreground hover:bg-accent hover:text-accent-foreground focus-visible:z-2 focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={`${task.title} · ${timeSpan(plan, item, t.locale)}${item.locked ? ` · ${t("tasks.dispatchLocked")}` : ""}`}
                    title={`${task.title} · ${timeSpan(plan, item, t.locale)}`}
                    style={{ left: `min(${left}%, calc(100% - 7rem))`, width: `${right - left}%`, top: index % 2 ? 49 : 8 }}
                    onClick={() => editable ? onSelect(task, item) : openTask(task.id)}>
                    <span className="flex items-center gap-1 truncate">{item.locked && <Lock className="size-3 shrink-0" aria-hidden />}{task.title}</span>
                    <span className="block truncate">{formatScheduledTime(item.starts_at, t.locale, plan.timezone)}</span>
                  </button>;
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function DispatchWorkload({ plan, rows, onFocus }: {
  plan: DispatchPlan;
  rows: DispatchPreview["workload"];
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

  return (
    <div className="space-y-3">
      <section className={cn(panel, "overflow-x-auto")} aria-label={t("tasks.workload")}>
        <table className="w-full min-w-180 text-left text-sm">
          <thead><tr className="border-b">
            <th scope="col" className="px-4 py-3">{t("tasks.dispatchBooked")}</th>
            {plan.days.map((day) => <th scope="col" key={day.date} className="px-3 py-3">{formatScheduleDay(day.date, t.locale)}</th>)}
          </tr></thead>
          <tbody>
            {plan.members.map((member) => (
              <tr className="border-b last:border-0" key={member.id}>
                <th scope="row" className="px-4 py-3 font-medium">{member.name ?? t("tasks.teammate")}</th>
                {plan.days.map((day) => {
                  const cell = rows.find((value) => value.assignee_id === member.id && value.date === day.date);
                  const available = cell?.available;
                  const booked = Math.round(cell?.booked ?? 0);
                  const overloaded = available != null && booked > available;
                  return <td key={day.date} className="p-1">
                    <button type="button" className={cn("min-h-12 w-full rounded-md p-2 text-left tabular-nums hover:bg-muted", overloaded && "text-destructive")}
                      onClick={() => onFocus(member.id, day.date)}>
                      {t("tasks.dispatchDurationValue", { minutes: booked })} / {available == null
                        ? "–" : t("tasks.dispatchDurationValue", { minutes: Math.round(available) })}
                      {overloaded && <span className="block text-xs">{t("tasks.dispatchOverload")}</span>}
                      {available == null && <span className="block text-xs">{t("tasks.dispatchAvailabilityUnknown")}</span>}
                    </button>
                  </td>;
                })}
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
          {editable && <Button variant="outline" size="sm" disabled={busy || movable.length === 0}
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
