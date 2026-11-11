"use client";

import { SimpleSelect } from "@/components/ui/simple-select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Flag, Plus, Repeat, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n/provider";
import { useTags } from "@/lib/api/tags";
import type { Tag, TaskLabel, TaskPriority, TaskRepeat } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import {
  PRIORITY_PICKER,
  allowedUnits,
  capLabels,
  draftProblem,
  draftSummary,
  dueDay,
  isFlaggedPriority,
  isoWeekday,
  nthOfMonth,
  newRepeatDraft,
  normalizePriority,
  priorityLabelKey,
  repeatSummary,
  repeatUnitWord,
  showsRepeatIcon,
  weekdayName,
  type RepeatDraft,
  type RepeatEndKind,
  type RepeatKind,
  type RepeatUnit,
  type TaskScope,
} from "./task-planning";

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

/**
 * The flag on a row, card or map pin. Only high and urgent are drawn: a flag on
 * everything is a flag on nothing. The word travels with the icon so colour is
 * never the only signal.
 */
export function PriorityMark({
  priority,
  className,
}: {
  priority: TaskPriority | undefined;
  className?: string;
}) {
  const t = useT();
  if (!isFlaggedPriority(priority)) return null;
  const urgent = priority === "urgent";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium",
        urgent ? "text-destructive" : "text-warning",
        className,
      )}
    >
      <Flag className="size-3" strokeWidth={2} fill="currentColor" aria-hidden />
      {t(priorityLabelKey(priority))}
    </span>
  );
}

/** A priority picker: the field in the New task form and the detail panel. */
export function PrioritySelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: TaskPriority | undefined;
  onChange: (next: TaskPriority) => void;
}) {
  const t = useT();
  return (
    <SimpleSelect
      id={id}
      value={normalizePriority(value)}
      onValueChange={(next) => onChange(next as TaskPriority)}
      options={PRIORITY_PICKER.map((p) => ({
        value: p,
        label: t(priorityLabelKey(p)),
      }))}
    />
  );
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const CHIP =
  "inline-flex max-w-[9rem] items-center rounded-full bg-app-line-soft px-2 py-[2.5px] text-[11px] font-semibold leading-none text-app-muted";

/** Read-only chips for a row or card, capped with "+N". */
export function LabelChips({
  labels,
  max = 2,
  className,
}: {
  labels: readonly TaskLabel[] | undefined;
  max?: number;
  className?: string;
}) {
  const t = useT();
  const { shown, more } = capLabels(labels, max);
  if (shown.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {shown.map((label) => (
        <span key={label.id} className={CHIP}>
          <span className="truncate">{label.name}</span>
        </span>
      ))}
      {more > 0 && (
        <span className={CHIP}>{t("tasks.labelMore", { count: more })}</span>
      )}
    </span>
  );
}

/** Chips with a remove control each, for the editors. */
export function EditableLabelChips({
  labels,
  onRemove,
  disabled,
}: {
  labels: { key: string; name: string }[];
  onRemove: (key: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  if (labels.length === 0) {
    return <span className="text-[13px] text-muted-foreground">{t("tasks.noLabels")}</span>;
  }
  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {labels.map((label) => (
        <li
          key={label.key}
          className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-secondary py-0.5 pl-2.5 pr-0.5 text-[12px] font-medium text-secondary-foreground"
        >
          <span className="truncate">{label.name}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemove(label.key)}
            aria-label={t("tasks.labelRemoveAria", { name: label.name })}
            className="tap-target rounded-full p-1 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <X className="size-3" strokeWidth={1.75} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Add label": the workspace's tags, plus whatever is typed as a new one.
 * `excludeIds` hides what is already on the task.
 */
export function LabelPicker({
  excludeIds,
  excludeNames,
  onPick,
  onCreate,
  disabled,
}: {
  excludeIds: ReadonlySet<string>;
  excludeNames?: readonly string[];
  onPick: (tag: Tag) => void;
  onCreate: (name: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const tags = useTags();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const all = tags.data?.data ?? [];
  const taken = new Set((excludeNames ?? []).map((n) => n.toLowerCase()));
  const options = all.filter(
    (tag) => !excludeIds.has(tag.id) && !taken.has(tag.name.toLowerCase()),
  );
  const typed = text.trim();
  const exists =
    typed !== "" &&
    (all.some((tag) => tag.name.toLowerCase() === typed.toLowerCase()) ||
      taken.has(typed.toLowerCase()));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setText("");
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <Plus className="size-3.5" aria-hidden />
          {t("tasks.addLabel")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-64 p-0 shadow-lg">
        <Command
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0
          }
        >
          <CommandInput
            value={text}
            onValueChange={setText}
            placeholder={t("tasks.addOrCreateLabel")}
          />
          <CommandList>
            {options.length === 0 && typed === "" && (
              <CommandEmpty>{t("tasks.noLabelsYet")}</CommandEmpty>
            )}
            <CommandGroup>
              {options.map((tag) => (
                <CommandItem
                  key={tag.id}
                  value={tag.name}
                  onSelect={() => {
                    onPick(tag);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{tag.name}</span>
                </CommandItem>
              ))}
              {typed !== "" && !exists && (
                <CommandItem
                  value={`create-${typed}`}
                  forceMount
                  onSelect={() => {
                    onCreate(typed);
                    setOpen(false);
                  }}
                >
                  <Plus className="size-4" aria-hidden />
                  <span className="truncate">
                    {t("tasks.createLabelNamed", { name: typed })}
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Repeat
// ---------------------------------------------------------------------------

/** The repeat icon on a row, card or timeline entry; nothing for a stopped one. */
export function RepeatMark({
  repeat,
  className,
}: {
  repeat: Pick<TaskRepeat, "stopped"> | null | undefined;
  className?: string;
}) {
  const t = useT();
  if (!showsRepeatIcon(repeat)) return null;
  return (
    <span
      className={cn("inline-flex items-center text-muted-foreground", className)}
      title={t("tasks.repeats")}
    >
      <Repeat className="size-3.5" strokeWidth={1.75} aria-hidden />
      <span className="sr-only">{t("tasks.repeats")}</span>
    </span>
  );
}

/**
 * The one-row Repeat control. `draft` null means not repeating. A schedule
 * needs a due date, which the dialog explains rather than hides.
 */
export function RepeatField({
  id,
  draft,
  due,
  linked,
  existing,
  onChange,
}: {
  id: string;
  draft: RepeatDraft | null;
  /** The task's due value (ISO instant or datetime-local), or empty. */
  due: string | null | undefined;
  /** Linked to a conversation or contact: defaults to "after it's done". */
  linked: boolean;
  /** The task already repeats, so Pause and Stop are offered. */
  existing: boolean;
  onChange: (next: RepeatDraft | null) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        id={id}
        type="button"
        variant="outline"
        className="h-auto min-h-9 w-full justify-start whitespace-normal py-2 text-left font-normal"
        onClick={() => setOpen(true)}
      >
        <Repeat className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1">
          {draft ? draftSummary(draft, due, t) : t("tasks.repeatNone")}
        </span>
      </Button>
      {open && (
        <RepeatDialog
          draft={draft}
          due={due}
          linked={linked}
          existing={existing}
          onClose={() => setOpen(false)}
          onApply={(next) => {
            onChange(next);
            setOpen(false);
          }}
          onStop={() => {
            onChange(null);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

function RepeatDialog({
  draft,
  due,
  linked,
  existing,
  onClose,
  onApply,
  onStop,
}: {
  draft: RepeatDraft | null;
  due: string | null | undefined;
  linked: boolean;
  existing: boolean;
  onClose: () => void;
  onApply: (next: RepeatDraft) => void;
  onStop: () => void;
}) {
  const t = useT();
  const [work, setWork] = useState<RepeatDraft>(
    () => draft ?? newRepeatDraft(linked),
  );
  const anchor = dueDay(due);
  const problem = draftProblem(work, due);
  const patch = (next: Partial<RepeatDraft>) =>
    setWork((current) => ({ ...current, ...next }));

  const setKind = (kind: RepeatKind) =>
    setWork((current) => ({
      ...current,
      kind,
      unit:
        kind === "after_done" && current.unit === "year" ? "month" : current.unit,
    }));

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("tasks.repeat")}</DialogTitle>
          <DialogDescription>
            {t(
              work.kind === "schedule"
                ? "tasks.repeatKindScheduleHint"
                : "tasks.repeatKindAfterDoneHint",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <SegmentedControl
            fill
            ariaLabel={t("tasks.repeat")}
            value={work.kind}
            onChange={setKind}
            options={(
              [
                ["schedule", "tasks.repeatKindSchedule"],
                ["after_done", "tasks.repeatKindAfterDone"],
              ] as const
            ).map(([kind, key]) => ({ value: kind, label: t(key) }))}
          />

          <div className="flex items-end gap-2">
            <div className="flex w-24 flex-col gap-1.5">
              <Label htmlFor="repeat-every">{t("tasks.repeatEveryLabel")}</Label>
              <Input
                id="repeat-every"
                type="number"
                inputMode="numeric"
                min={1}
                value={Number.isFinite(work.every) ? work.every : ""}
                onChange={(e) =>
                  patch({ every: e.target.value === "" ? 0 : Number(e.target.value) })
                }
              />
            </div>
            <div className="min-w-0 flex-1">
              <SimpleSelect
                ariaLabel={t("tasks.repeatEveryLabel")}
                value={work.unit}
                onValueChange={(unit) => patch({ unit: unit as RepeatUnit })}
                options={allowedUnits(work.kind).map((unit) => ({
                  value: unit,
                  label: repeatUnitWord(unit, work.every, t),
                }))}
              />
            </div>
          </div>

          {work.kind === "schedule" && work.unit === "week" && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium">
                {t("tasks.repeatDays")}
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((day) => {
                  const name = weekdayName(day, t.locale);
                  const on = work.weekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      aria-label={name}
                      onClick={() =>
                        patch({
                          weekdays: on
                            ? work.weekdays.filter((d) => d !== day)
                            : [...work.weekdays, day].sort((a, b) => a - b),
                        })
                      }
                      className={cn(
                        "tap-target min-h-11 min-w-11 rounded-md border px-2 text-[13px] font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9 md:min-w-10",
                        on
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {name.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {work.kind === "schedule" && work.unit === "month" && anchor && (
            <SegmentedControl
              fill
              ariaLabel={t("misc.repeatMonthlyAria")}
              value={work.monthly}
              onChange={(mode) => patch({ monthly: mode })}
              options={[
                {
                  value: "date" as const,
                  label: t("tasks.repeatOnDay", { date: String(anchor.getDate()) }),
                },
                {
                  value: "nth" as const,
                  label: t("tasks.repeatOnNth", {
                    nth: nthName(nthOfMonth(anchor), t),
                    day: weekdayName(isoWeekday(anchor), t.locale),
                  }),
                },
              ]}
            />
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="repeat-ends">{t("tasks.repeatEnds")}</Label>
            <SimpleSelect
              id="repeat-ends"
              value={work.endKind}
              onValueChange={(endKind) => patch({ endKind: endKind as RepeatEndKind })}
              options={[
                { value: "never", label: t("tasks.repeatEndsNever") },
                { value: "on", label: t("tasks.repeatEndsOn") },
                { value: "after", label: t("tasks.repeatEndsAfter") },
              ]}
            />
            {work.endKind === "on" && (
              <Input
                type="date"
                aria-label={t("tasks.repeatPickEndDate")}
                value={work.endOn}
                onChange={(e) => patch({ endOn: e.target.value })}
              />
            )}
            {work.endKind === "after" && (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  className="w-24"
                  aria-label={t("tasks.repeatTimesLabel")}
                  value={Number.isFinite(work.endAfter) ? work.endAfter : ""}
                  onChange={(e) =>
                    patch({
                      endAfter: e.target.value === "" ? 0 : Number(e.target.value),
                    })
                  }
                />
                <span className="text-[13px] text-muted-foreground">
                  {t("tasks.repeatTimesLabel")}
                </span>
              </div>
            )}
          </div>

          {existing && (
            <div className="flex items-center justify-between gap-2 rounded-app-ctrl border border-app-line px-3 py-2">
              <Label htmlFor="repeat-pause" className="text-[13px] font-medium">
                {t("tasks.repeatPause")}
              </Label>
              <Switch
                id="repeat-pause"
                checked={work.paused}
                onCheckedChange={(paused) => patch({ paused })}
              />
            </div>
          )}

          {problem && (
            <p role="alert" className="text-[13px] text-warning">
              {t(problem)}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {existing ? (
            <Button type="button" variant="ghost" size="sm" onClick={onStop}>
              {t("tasks.repeatStop")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={problem !== null}
              onClick={() => onApply(work)}
            >
              {t("tasks.repeatApply")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function nthName(nth: number, t: ReturnType<typeof useT>): string {
  switch (nth) {
    case 1:
      return t("tasks.nthFirst");
    case 2:
      return t("tasks.nthSecond");
    case 3:
      return t("tasks.nthThird");
    case 4:
      return t("tasks.nthFourth");
    default:
      return t("tasks.nthLast");
  }
}

/** The detail panel's repeat line: the saved rule's sentence, or "Never". */
export function RepeatSummaryText({ repeat }: { repeat: TaskRepeat | null | undefined }) {
  const t = useT();
  return <>{repeat ? repeatSummary(repeat, t) : t("tasks.repeatNone")}</>;
}

// ---------------------------------------------------------------------------
// Scope: this one / this and future
// ---------------------------------------------------------------------------

/**
 * Asks which occurrences an edit or a delete reaches on a repeating task.
 * Nothing has been saved yet when this is open; closing it keeps it that way.
 */
export function ScopeDialog({
  open,
  mode,
  onChoose,
  onCancel,
}: {
  open: boolean;
  mode: "edit" | "delete";
  onChoose: (scope: TaskScope) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const del = mode === "delete";
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t(del ? "tasks.deleteScopeTitle" : "tasks.scopeTitle")}
          </DialogTitle>
          <DialogDescription>{t("tasks.scopeBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:flex-col sm:space-x-0">
          <Button
            type="button"
            variant={del ? "destructive" : "default"}
            onClick={() => onChoose("this")}
          >
            {t(del ? "tasks.deleteScopeThis" : "tasks.scopeThis")}
          </Button>
          <Button
            type="button"
            variant={del ? "destructive" : "outline"}
            onClick={() => onChoose("future")}
          >
            {t(del ? "tasks.deleteScopeFuture" : "tasks.scopeFuture")}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
