"use client";

import { CalendarClock, Lock, Plus, Search, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import { useT } from "@/i18n/provider";
import { instantFromZonedWallClock, zonedWallClock } from "@/lib/format/time";

import type { DispatchBlock, DispatchDay, DispatchDetail, DispatchEdit, DispatchPlan, DispatchTask } from "./dispatch-data";
import { useTaskDrawer } from "./use-task-drawer";

export type SlotRequest = {
  id: string; task_id: string; duration: number; visit: boolean; confirm_address: boolean; assignee_id?: string;
};

function localTime(iso: string | undefined, zone: string) {
  const wall = iso ? zonedWallClock(iso, zone) : null;
  return wall ? `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}` : "";
}

function localDateTime(iso: string, zone: string) {
  const clock = zonedWallClock(iso, zone);
  return clock ? `${clock.date}T${localTime(iso, zone)}` : "";
}

function instant(input: string, zone: string) {
  const result = instantFromZonedWallClock(input, zone);
  return result.ok ? result.iso : null;
}

function minutes(value: string): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= 5 && number <= 720 ? number : null;
}

export function DispatchEditor({ plan, task, day, block, initialAssignee, initialTime, busy, slots, onSlots, onEdit, onDetails, onRemove }: {
  plan: DispatchPlan;
  task: DispatchTask;
  day: DispatchDay;
  block?: DispatchBlock;
  initialAssignee?: string;
  initialTime?: string;
  busy: boolean;
  slots: DispatchBlock[] | null;
  onSlots: (slot: SlotRequest, detail: DispatchDetail, day: string) => void;
  onEdit: (edit: DispatchEdit, detail: DispatchDetail) => void;
  onDetails: (detail: DispatchDetail) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const prefix = useId();
  const { openTask } = useTaskDrawer();
  const id = useRef<string | null>(null);
  function blockId() {
    id.current ??= block?.id ?? crypto.randomUUID();
    return id.current;
  }
  const [assignee, setAssignee] = useState(block?.assignee_id ?? initialAssignee ?? task.assigned_user_id ?? "");
  const [date, setDate] = useState(day.date);
  const [time, setTime] = useState(initialTime ?? localTime(block?.starts_at ?? day.opens_at ?? undefined, plan.timezone));
  const [duration, setDuration] = useState(block
    ? String((Date.parse(block.ends_at) - Date.parse(block.starts_at)) / 60_000)
    : String(task.dispatch_estimate ?? ""));
  const [estimate, setEstimate] = useState(String(task.dispatch_estimate ?? ""));
  const [visit, setVisit] = useState(block?.visit ?? false);
  const [address, setAddress] = useState(block?.address_confirmed ?? false);
  const [locked, setLocked] = useState(block?.locked ?? false);
  const [windows, setWindows] = useState(() => task.windows.map((window) => ({
    id: crypto.randomUUID(),
    start: localDateTime(window.start, plan.timezone),
    end: localDateTime(window.end, plan.timezone),
  })));
  const [problem, setProblem] = useState("");
  const label = "grid min-w-0 gap-1.5 text-sm font-medium";
  const bottom = "flex flex-wrap items-center gap-2";

  function details(): DispatchDetail | null {
    const next = windows.map((w) => ({
      start: instant(w.start, plan.timezone),
      end: instant(w.end, plan.timezone),
    }));
    const checked = next.flatMap(({ start, end }) =>
      start && end && Date.parse(start) < Date.parse(end) ? [{ start, end }] : []);
    if (checked.length !== next.length) {
      setProblem(t("tasks.dispatchWindowInvalid"));
      return null;
    }
    if (estimate && minutes(estimate) === null) {
      setProblem(t("apiRefusals.dispatchDuration"));
      return null;
    }
    setProblem("");
    return { task_id: task.id, updated_at: task.updated_at, estimate: minutes(estimate), windows: checked };
  }

  return (
    <section aria-labelledby={`${prefix}-title`} className="space-y-4 rounded-xl border bg-card p-4 text-card-foreground">
      <div>
        <h2 id={`${prefix}-title`} className="flex items-center gap-2 font-semibold">
          {block?.locked ? <Lock className="size-4" aria-hidden /> : <CalendarClock className="size-4" aria-hidden />}
          {t(block ? "tasks.dispatchEditBlock" : "tasks.dispatchNewBlock")}
        </h2>
        <button type="button" className="min-h-9 text-left text-sm text-app-muted hover:underline"
          onClick={() => openTask(task.id)}>{task.title}</button>
      </div>
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        const detail = details();
        const start = instant(`${date}T${time}`, plan.timezone);
        const length = minutes(duration);
        if (!detail || !length) return;
        if (!assignee) {
          setProblem(t("apiRefusals.dispatchAssignee"));
          return;
        }
        if (!start) {
          setProblem(t("apiRefusals.dispatchHours"));
          return;
        }
        onEdit({
          id: blockId(), task_id: task.id, updated_at: task.updated_at, remove: false, assignee_id: assignee,
          starts_at: start, ends_at: new Date(Date.parse(start) + length * 60_000).toISOString(),
          visit, confirm_address: visit && address, locked, reschedule: block?.locked === true,
        }, detail);
      }}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className={label}>
            <label htmlFor={`${prefix}-crew`}>{t("tasks.dispatchAssignee")}</label>
            <SimpleSelect id={`${prefix}-crew`} value={assignee || "unassigned"}
              onValueChange={(value) => setAssignee(value === "unassigned" ? "" : value)}
              options={[
                { value: "unassigned", label: t("tasks.unassigned") },
                ...plan.members.map((member) => ({ value: member.id, label: member.name ?? t("tasks.teammate") })),
              ]} />
          </div>
          <label className={label}>
            {t("tasks.dispatchDate")}
            <Input type="date" required value={date} min={plan.days[0]?.date} max={plan.days.at(-1)?.date}
              onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className={label}>
            {t("tasks.dispatchStart")}
            <Input type="time" value={time} required onChange={(event) => setTime(event.target.value)} />
          </label>
          <label className={label}>
            {t("tasks.dispatchDuration")}
            <Input type="number" min={5} max={720} required value={duration} onChange={(event) => setDuration(event.target.value)} />
          </label>
          <label className={label}>
            {t("tasks.dispatchEstimate")}
            <Input type="number" min={5} max={720} value={estimate} onChange={(event) => setEstimate(event.target.value)} />
          </label>
        </div>
        <div className={bottom}>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={visit} onChange={(event) => setVisit(event.target.checked)} />
            {t("tasks.dispatchOnsite")}
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={locked} onChange={(event) => setLocked(event.target.checked)} />
            {t("tasks.dispatchLock")}
          </label>
        </div>
        {visit && (task.address ? (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" required checked={address} onChange={(event) => setAddress(event.target.checked)} />
            <span>{t("tasks.dispatchConfirmAddress")} <span className="block text-app-muted">{task.address}</span></span>
          </label>
        ) : <p className="text-sm text-app-muted">{t("tasks.dispatchNoAddress")}</p>)}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("tasks.dispatchWindows")}</legend>
          {windows.map((window, index) => (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2" key={window.id}>
              <label className={label}>
                {t("tasks.dispatchWindowStart")}
                <Input type="datetime-local" value={window.start} onChange={(event) => {
                  const { value } = event.target;
                  setWindows((current) => current.map((row) => row.id === window.id ? { ...row, start: value } : row));
                }} />
              </label>
              <label className={label}>
                {t("tasks.dispatchWindowEnd")}
                <Input type="datetime-local" value={window.end} onChange={(event) => {
                  const { value } = event.target;
                  setWindows((current) => current.map((row) => row.id === window.id ? { ...row, end: value } : row));
                }} />
              </label>
              <Button type="button" variant="ghost" size="icon" aria-label={t("tasks.dispatchWindowRemove")}
                onClick={() => setWindows((current) => current.filter((_, i) => i !== index))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" disabled={windows.length >= 20} onClick={() =>
            setWindows((current) => [...current, { id: crypto.randomUUID(), start: "", end: "" }])}>
            <Plus aria-hidden />{t("tasks.dispatchNewWindow")}
          </Button>
        </fieldset>
        {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
        {slots && (slots.length > 0 ? (
          <div className={bottom}>
            {slots.map((slot) => (
              <Button type="button" variant="outline" size="sm" key={slot.assignee_id + slot.starts_at}
                onClick={() => { setAssignee(slot.assignee_id); setTime(localTime(slot.starts_at, plan.timezone)); }}>
                {plan.members.find((member) => member.id === slot.assignee_id)?.name ?? t("tasks.teammate")}
                {localTime(slot.starts_at, plan.timezone)}
              </Button>
            ))}
          </div>
        ) : <p role="status" className="text-sm text-app-muted">{t("tasks.dispatchSlotEmpty")}</p>)}
        <div className={bottom}>
          <Button type="submit" disabled={busy || (visit && !task.address)}>{t("tasks.dispatchAddDraft")}</Button>
          <Button type="button" variant="outline" disabled={busy || !minutes(duration)} onClick={() => {
            const detail = details();
            const length = minutes(duration);
            if (!detail || length === null) return;
            onSlots({ id: blockId(), task_id: task.id, duration: length, visit, confirm_address: address, ...(assignee && { assignee_id: assignee }) }, detail, date);
          }}><Search aria-hidden />{t("tasks.dispatchFindSlot")}</Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => {
            const detail = details();
            if (detail) onDetails(detail);
          }}>{t("tasks.dispatchSaveDetails")}</Button>
          {block && <Button type="button" variant="ghost" disabled={busy} onClick={onRemove}>{t("tasks.dispatchUnscheduled")}</Button>}
        </div>
      </form>
    </section>
  );
}
