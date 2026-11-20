"use client";

import { roleHasCapability } from "@loonext/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Layers3, Route, UserRound } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ListSkeleton } from "@/components/ui/list-skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SimpleSelect } from "@/components/ui/simple-select";
import { useT } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/translate";
import { useCompany } from "@/lib/api/companies";
import { keys } from "@/lib/api/keys";
import { useActiveCompany } from "@/lib/company/provider";
import { formatScheduledTime } from "@/lib/format/time";

import { blocksOnDay, dispatchEdit, fetchDispatch, previewDispatch, publishDispatch } from "./dispatch-data";
import type { DispatchBlock, DispatchDetail, DispatchDraft, DispatchEdit, DispatchPreview, DispatchTask } from "./dispatch-data";
import { DispatchEditor } from "./dispatch-editor";
import type { SlotRequest } from "./dispatch-editor";
import { DispatchRoutesView, DispatchSchedule, DispatchWorkload } from "./dispatch-views";
import { dayFromKey, dayKey, todayInZone } from "./views/calendar-create";

const EMPTY_DRAFT: DispatchDraft = { blocks: [], details: [] };
const WEEK_DAYS = 7;
const CONFLICT_TEXT = {
  address: "apiRefusals.dispatchAddress",
  hours: "apiRefusals.dispatchHours",
  window: "apiRefusals.dispatchWindow",
  overlap: "apiRefusals.dispatchOverlap",
  travel: "tasks.dispatchIssueTravel",
} satisfies Record<DispatchPreview["conflicts"][number]["reason"], MessageKey>;
const PANES = [
  { id: "schedule", label: "tasks.schedule", icon: CalendarDays },
  { id: "workload", label: "tasks.workload", icon: Layers3 },
  { id: "routes", label: "tasks.routes", icon: Route },
  { id: "day", label: "tasks.myDay", icon: UserRound },
] as const;
type Pane = (typeof PANES)[number]["id"];

interface EditorSelection {
  task: string;
  block?: string;
  assignee?: string;
  time?: string;
}

function shift(date: string, days: number): string {
  const value = dayFromKey(date);
  value.setDate(value.getDate() + days);
  return dayKey(value);
}

function weekOf(date: string): string {
  return shift(date, -(dayFromKey(date).getDay() + 6) % WEEK_DAYS);
}

function replace<T>(values: T[], item: T, find: (value: T) => boolean): T[] {
  return [...values.filter((value) => !find(value)), item];
}

export function DispatchPlanner() {
  const t = useT();
  const { companyId } = useActiveCompany();
  const company = useCompany();
  const search = useSearchParams();
  const job = search.get("job") ?? undefined;
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-4 py-6 md:px-6 md:py-8">
      <Button asChild variant="ghost" size="sm"><Link href="/tasks"><ChevronLeft aria-hidden />{t("tasks.pageTitle")}</Link></Button>
      {company.isPending
        ? <ListSkeleton rows={5} />
        : <DispatchWorkspace key={companyId} job={job} timezone={company.data?.timezone ?? "UTC"} />}
    </div>
  );
}

function DispatchWorkspace({ job, timezone }: { job?: string; timezone: string }) {
  const t = useT();
  const { companyId, userId, role } = useActiveCompany();
  const client = useQueryClient();
  const editable = roleHasCapability(role, "conversations.note");
  const [date, setDate] = useState(() => dayKey(todayInZone(new Date(), timezone)));
  const [pane, setPane] = useState<Pane>("schedule");
  const [person, setPerson] = useState("");
  const initialEditor = job ? { task: job } : null;
  const [editor, setEditor] = useState<EditorSelection | null>(initialEditor);
  const [slots, setSlots] = useState<DispatchBlock[] | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [preview, setPreview] = useState<DispatchPreview | null>(null);
  const [route, setRoute] = useState<{ key: string; result: DispatchPreview["route"] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const dirty = draft.blocks.length > 0 || draft.details.length > 0;
  const week = weekOf(date);
  const range = { day: week, days: WEEK_DAYS, task: job };
  const query = useQuery({
    queryKey: ["dispatch", companyId, week, job],
    queryFn: ({ signal }) => fetchDispatch(companyId, range, signal),
    refetchOnWindowFocus: !dirty,
  });

  const baseline = query.data?.plan;
  if (!baseline) {
    if (query.isError) {
      return <div className="space-y-4">
        <PageHeader title={t("tasks.planner")} />
        <p role="alert">{t("tasks.dispatchUnavailable")}</p>
        <Button onClick={() => void query.refetch()}>{t("tasks.dispatchReload")}</Button>
      </div>;
    }
    return <div className="space-y-4"><PageHeader title={t("tasks.planner")} /><ListSkeleton rows={6} /></div>;
  }

  const plan = preview?.plan ?? baseline;
  const effectivePerson = person || plan.members[0]?.id || "";
  const day = plan.days.find((value) => value.date === date);
  const dayBlocks = blocksOnDay(plan, date);
  const task = plan.tasks.find((item) => item.id === editor?.task);
  const block = plan.blocks.find((item) => item.id === editor?.block);
  const original = new Map(baseline.blocks.map((item) => [item.id, item]));
  const routeKey = `${date}:${effectivePerson}`;
  const routeResult = route?.key === routeKey ? route.result : null;
  const request = { ...range, revision: preview?.plan.revision ?? baseline.revision };
  const conflicts = preview?.conflicts ?? [];

  function displayError(failure: unknown) {
    setError(failure instanceof Error ? failure.message : t("tasks.dispatchUnavailable"));
  }

  function select(item: DispatchTask, edit?: DispatchBlock, assignee?: string, time?: string) {
    setEditor({ task: item.id, block: edit?.id, assignee, time });
    setSlots(null);
    setError("");
  }

  function changeDate(next: string) {
    if (!next || (dirty && weekOf(next) !== week)) return;
    setDate(next);
    setEditor(null);
    setSlots(null);
    setError("");
  }

  function withDetails(detail: DispatchDetail): DispatchDetail[] {
    const before = baseline?.tasks.find((item) => item.id === detail.task_id);
    const windows = (list: DispatchDetail["windows"]) => list.map(({ start, end }) =>
      `${Date.parse(start)}/${Date.parse(end)}`).toSorted().join(",");
    if (before && before.dispatch_estimate === detail.estimate && windows(before.windows) === windows(detail.windows)) {
      return draft.details.filter((entry) => entry.task_id !== detail.task_id);
    }
    return replace(draft.details, detail, (entry) => entry.task_id === detail.task_id);
  }

  async function stage(next: DispatchDraft) {
    setBusy(true);
    setError("");
    try {
      const result = await previewDispatch(companyId, { ...request, ...next, focus: date });
      setDraft(next);
      setPreview(result);
      setRoute(null);
      if (result.conflicts.length === 0) setEditor(null);
      setSlots(null);
    } catch (error_) {
      displayError(error_);
    } finally {
      setBusy(false);
    }
  }

  async function findSlots(slot: SlotRequest, detail: DispatchDetail, focus: string) {
    setBusy(true);
    setError("");
    try {
      const result = await previewDispatch(companyId, { ...request, ...draft, details: withDetails(detail), slot, focus });
      setSlots(result.slots);
    } catch (error_) {
      displayError(error_);
    } finally {
      setBusy(false);
    }
  }

  async function calculateRoute(order?: string[]) {
    if (!effectivePerson) return;
    setBusy(true);
    setError("");
    try {
      const result = await previewDispatch(companyId, {
        ...request, ...draft, focus: date, route: { assignee_id: effectivePerson, optimize: true, order },
      });
      setRoute({ key: routeKey, result: result.route });
    } catch (error_) {
      displayError(error_);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setError("");
    try {
      await publishDispatch(companyId, { ...request, ...draft });
      void client.invalidateQueries({ queryKey: keys.tasks.lists(companyId) });
      for (const taskId of new Set(draft.blocks.map((edit) => edit.task_id))) {
        void client.invalidateQueries({ queryKey: keys.tasks.detail(companyId, taskId) });
      }
      discard();
      await query.refetch();
      toast.success(t("tasks.dispatchPublished"));
    } catch (error_) {
      setReview(false);
      displayError(error_);
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    setReview(false);
    setDraft(EMPTY_DRAFT);
    setPreview(null);
    setSlots(null);
    setEditor(null);
    setRoute(null);
    setError("");
  }

  function remove(item: DispatchBlock, from: DispatchTask) {
    const previous = original.get(item.id);
    const changes = draft.blocks.filter((entry) => entry.id !== item.id);
    if (previous) {
      changes.push({
        id: item.id, task_id: from.id, updated_at: from.updated_at, remove: true, reschedule: previous.locked,
      });
    }
    void stage({ ...draft, blocks: changes });
  }

  return (
    <>
      <PageHeader title={t("tasks.planner")} secondary={dirty && (
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={discard}>{t("tasks.dispatchDiscard")}</Button>
          <Button size="sm" disabled={busy || conflicts.length > 0} onClick={() => setReview(true)}>{t("tasks.dispatchReview")}</Button>
        </>
      )} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl ariaLabel={t("tasks.planner")} value={pane} onChange={setPane}
          options={PANES.map(({ id, label, icon: Icon }) => ({ value: id, label: t(label), icon: <Icon className="size-4" aria-hidden /> }))} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon" disabled={busy || dirty} aria-label={t("tasks.dispatchPrevWeek")}
            onClick={() => changeDate(shift(date, -WEEK_DAYS))}><ChevronLeft aria-hidden /></Button>
          <Input type="date" className="w-auto" aria-label={t("tasks.dispatchDate")} value={date}
            min={dirty ? week : undefined} max={dirty ? shift(week, 6) : undefined} disabled={busy}
            onChange={(event) => changeDate(event.target.value)} />
          <Button variant="ghost" size="icon" disabled={busy || dirty} aria-label={t("tasks.dispatchNextWeek")}
            onClick={() => changeDate(shift(date, WEEK_DAYS))}><ChevronRight aria-hidden /></Button>
          {pane === "routes" && <SimpleSelect ariaLabel={t("tasks.assignee")}
            className="w-auto" value={effectivePerson} disabled={busy} onValueChange={setPerson}
            options={plan.members.map((member) => ({ value: member.id, label: member.name ?? t("tasks.teammate") }))} />}
        </div>
      </div>
      {error && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm text-destructive">
        <p>{error}</p>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { discard(); void query.refetch(); }}>
          {t("tasks.dispatchReload")}
        </Button>
      </div>}
      {conflicts.length > 0 && <ul className="space-y-1 rounded-lg border p-3 text-sm text-destructive" aria-live="polite">
        {conflicts.map((conflict) => <li key={conflict.id}>
          {plan.tasks.find((item) => item.id === plan.blocks.find((entry) => entry.id === conflict.id)?.task_id)?.title}
          {" · "}{t(CONFLICT_TEXT[conflict.reason], { minutes: conflict.minutes ?? 0 })}
        </li>)}
      </ul>}
      {pane === "schedule" && day && (
        <>
          {editable && task && editor && <DispatchEditor key={JSON.stringify({ editor, date })} plan={plan} task={task} day={day}
            block={block} initialAssignee={editor.assignee} initialTime={editor.time} busy={busy} slots={slots}
            onSlots={(slot, detail, focus) => void findSlots(slot, detail, focus)}
            onEdit={(edit: DispatchEdit, detail) => void stage({
              blocks: replace(draft.blocks, edit, (entry) => entry.id === edit.id), details: withDetails(detail),
            })}
            onDetails={(detail) => void stage({ ...draft, details: withDetails(detail) })}
            onRemove={() => { if (block) remove(block, task); }}
          />}
          {block && dayBlocks.some((item) => item.assignee_id === block.assignee_id && item.starts_at > block.starts_at) && (
            <p className="px-1 text-sm text-app-muted">{t("tasks.dispatchUpcoming")}: {dayBlocks
              .filter((item) => item.assignee_id === block.assignee_id && item.starts_at > block.starts_at)
              .map((item) => plan.tasks.find((entry) => entry.id === item.task_id)?.title).filter(Boolean).join(", ")}</p>
          )}
          <DispatchSchedule plan={plan} day={day} focused={person} editable={editable && !busy} onSelect={select} />
        </>
      )}
      {pane === "workload" && <DispatchWorkload plan={plan} rows={preview?.workload ?? query.data?.workload ?? []} onFocus={(id, when) => {
        setPerson(id);
        changeDate(when);
        setPane("schedule");
      }} />}
      {pane === "routes" && <DispatchRoutesView plan={plan} blocks={dayBlocks.filter((item) => item.assignee_id === effectivePerson)}
        route={routeResult} busy={busy} editable={editable}
        onOptimize={(order) => void calculateRoute(order)}
        onApply={() => {
          const edits = (routeResult?.proposal ?? []).flatMap((candidate) => {
            const jobTask = plan.tasks.find((item) => item.id === candidate.task_id);
            return jobTask ? [dispatchEdit(candidate, jobTask, false)] : [];
          });
          const ids = new Set(edits.map((edit) => edit.id));
          void stage({ ...draft, blocks: [...draft.blocks.filter((edit) => !ids.has(edit.id)), ...edits] });
        }} />}
      {pane === "day" && <DispatchRoutesView plan={baseline} blocks={blocksOnDay(baseline, date).filter((item) => item.assignee_id === userId)}
        route={null} busy={false} editable={false} personal />}
      <Dialog open={review} onOpenChange={setReview}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto">
          <DialogTitle>{t("tasks.dispatchPreview")}</DialogTitle>
          <DialogDescription>{t("tasks.dispatchReview")}</DialogDescription>
          <ul className="divide-y text-sm">
            {draft.blocks.map((edit) => {
              const previous = original.get(edit.id);
              const member = plan.members.find((item) => item.id === (edit.remove ? previous?.assignee_id : edit.assignee_id));
              return <li key={edit.id} className="py-2">
                <strong>{plan.tasks.find((entry) => entry.id === edit.task_id)?.title}</strong>
                <p className="text-app-muted">
                  {t(edit.remove ? "tasks.dispatchRemoved" : (previous ? "tasks.dispatchMoved" : "tasks.dispatchAdded"))}
                  {member && ` · ${member.name ?? t("tasks.teammate")}`}
                  {previous && ` · ${formatScheduledTime(previous.starts_at, t.locale, timezone, true)}`}
                  {!edit.remove && ` ${previous ? "→" : "·"} ${formatScheduledTime(edit.starts_at, t.locale, timezone, true)}`}
                </p>
              </li>;
            })}
            {draft.details.map((edit) => <li className="py-2" key={edit.task_id}>
              <strong>{plan.tasks.find((entry) => entry.id === edit.task_id)?.title}</strong>
              <p className="text-app-muted">{t("tasks.dispatchDetails")}</p>
            </li>)}
          </ul>
          {preview && preview.notify.length > 0 && <p className="text-sm text-app-muted">
            {t("tasks.dispatchNotify")}{" · "}{preview.notify
              .map((id) => plan.members.find((member) => member.id === id)?.name ?? t("tasks.teammate")).join(", ")}
          </p>}
          <DialogFooter><Button disabled={busy || conflicts.length > 0} onClick={() => void publish()}>
            <CalendarClock aria-hidden />{t("tasks.dispatchPublish")}
          </Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
