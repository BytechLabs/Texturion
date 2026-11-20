"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import { useT } from "@/i18n/provider";
import { formatWallWeekday } from "@/lib/format/time";

import type { DispatchPlan, DispatchShift } from "./dispatch-data";
import { dayFromKey } from "./views/calendar-create";

const DEFAULT_SHIFT = { start: "09:00", end: "17:00", breaks: [] };
type ShiftDraft = Omit<DispatchShift, "breaks"> & { breaks: { id: string; start: string; end: string }[] };

export function DispatchShifts({ date, person, plan, busy, error, onSave }: {
  date: string;
  person: string;
  plan: DispatchPlan;
  busy: boolean;
  error: string;
  onSave: (worker: string, weekday: number, shift: DispatchShift | null) => void;
}) {
  const t = useT();
  const day = dayFromKey(date);
  const weekday = day.getDay() || 7;
  const [worker, setWorker] = useState(person);
  const initialShift = (id: string): ShiftDraft | null => {
    const saved = plan.members.find((member) => member.id === id)?.shifts?.[weekday];
    return saved ? { ...saved, breaks: saved.breaks.map((pause) => ({ ...pause, id: `${pause.start}-${pause.end}` })) } : null;
  };
  const [shift, setShift] = useState<ShiftDraft | null>(() => initialShift(person));
  const mode = shift === null ? "workspace" : (shift.start === null ? "off" : "shift");

  return (
    <DialogContent className="max-h-[85dvh] overflow-y-auto">
      <DialogTitle>{t("tasks.dispatchShifts")}</DialogTitle>
      <DialogDescription>{t("tasks.dispatchShiftWeekday", { day: formatWallWeekday(date, t.locale) })}</DialogDescription>
      <form className="grid gap-3" onSubmit={(event) => {
        event.preventDefault();
        onSave(worker, weekday, shift && { ...shift, breaks: shift.breaks.map(({ start, end }) => ({ start, end })) });
      }}>
        <SimpleSelect ariaLabel={t("tasks.assignee")} value={worker} onValueChange={(id) => {
          setWorker(id);
          setShift(initialShift(id));
        }} options={plan.members.map((member) => ({ value: member.id, label: member.name ?? t("tasks.teammate") }))} />
        <SimpleSelect ariaLabel={t("tasks.dispatchAvailability")} value={mode} onValueChange={(value) => {
          setShift(value === "workspace" ? null : (value === "off" ? { start: null, end: null, breaks: [] } : DEFAULT_SHIFT));
        }} options={[
          { value: "workspace", label: t("tasks.dispatchWorkspaceHours") },
          { value: "shift", label: t("tasks.dispatchCustomShift") },
          { value: "off", label: t("tasks.dispatchDayOff") },
        ]} />
        {shift && mode === "shift" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">{t("tasks.dispatchShiftStart")}<Input required type="time" value={shift.start ?? ""}
                onChange={(event) => setShift({ ...shift, start: event.target.value })} /></label>
              <label className="text-sm">{t("tasks.dispatchShiftEnd")}<Input required type="time" value={shift.end ?? ""}
                onChange={(event) => setShift({ ...shift, end: event.target.value })} /></label>
            </div>
            {shift.breaks.map((pause, index) => (
              <div key={pause.id} className="grid grid-cols-2 items-end gap-2">
                <label className="text-sm">{t("tasks.dispatchBreakStart")}<Input required type="time" value={pause.start}
                  onChange={(event) => setShift({ ...shift, breaks: shift.breaks.map((item, i) => i === index ? { ...item, start: event.target.value } : item) })} /></label>
                <label className="text-sm">{t("tasks.dispatchBreakEnd")}<Input required type="time" value={pause.end}
                  onChange={(event) => setShift({ ...shift, breaks: shift.breaks.map((item, i) => i === index ? { ...item, end: event.target.value } : item) })} /></label>
                <Button className="justify-self-start" type="button" variant="ghost" size="sm"
                  onClick={() => setShift({ ...shift, breaks: shift.breaks.filter((_, i) => i !== index) })}>{t("tasks.dispatchRemoveBreak")}</Button>
              </div>
            ))}
            <Button className="justify-self-start" type="button" variant="outline" size="sm" disabled={shift.breaks.length >= 6}
              onClick={() => setShift({ ...shift, breaks: [...shift.breaks, { id: crypto.randomUUID(), start: "12:00", end: "12:30" }] })}>
              {t("tasks.dispatchAddBreak")}
            </Button>
          </>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="submit" disabled={busy || !worker}>{t("common.save")}</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}
