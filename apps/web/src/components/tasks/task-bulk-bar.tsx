"use client";

import { Check, Flag, Trash2, Undo2, UserPlus } from "lucide-react";
import { useState } from "react";

import { MemberAvatar, useMemberNames } from "@/components/inbox/member-avatar";
import { Button } from "@/components/ui/button";
import { TagChecklist } from "@/components/ui/tag-checklist";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/i18n/provider";
import { useTags } from "@/lib/api/tags";
import type { TaskPriority } from "@/lib/api/types";
import { useCanDeleteRecords } from "@/lib/hooks/use-records-delete";
import { MAX_ASSIGNEES, toggleAssignee } from "./task-assignees";
import { PRIORITY_PICKER, priorityLabelKey } from "./task-planning";
import {
  canEscalate,
  selectionLabel,
  type BulkSelection,
} from "@/lib/inbox/bulk-selection";

/**
 * #478 — the selection bar over the task list.
 *
 * Every rule here came from #275 and is REUSED rather than restated: the
 * selection type, the escalation test, and the label are the same pure module
 * the inbox uses. What differs is only which four actions a task can take, and
 * that difference is the whole reason this is a separate component rather than
 * a parameter on the inbox bar — a bar that took an action list would be one
 * `if` away from offering "mark read" on a task.
 *
 * The three visible actions are the ones a task list actually gets used for:
 * ticking a batch off, handing a batch to somebody, clearing a batch that
 * should not have been made. Undo lives behind the toast, not here.
 *
 * NEVER INVENTS A COUNT. `selectionLabel` says "all matching" rather than a
 * number when the selection is a filter, because the client does not know how
 * many rows the server will find and a number it guessed would be a number
 * somebody trusted.
 */
/**
 * Pick people, then add them. Assigning here ADDS to each task's crew and takes
 * nobody off, so a batch of jobs that already have different crews keeps them.
 */
function BulkAssign({
  pending,
  onAssign,
}: {
  pending: boolean;
  onAssign: (userIds: string[]) => void;
}) {
  const t = useT();
  const roster = useMemberNames();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const atMax = picked.length >= MAX_ASSIGNEES;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setPicked([]);
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={pending}>
          <UserPlus className="size-3.5" aria-hidden />
          {t("tasks.bulkAssign")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        <ul role="listbox" aria-multiselectable aria-label={t("tasks.bulkAssign")} className="max-h-64 overflow-y-auto">
          {[...roster].map(([userId, name]) => {
            const selected = picked.includes(userId);
            return (
              <li key={userId} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={!selected && atMax}
                  onClick={() => setPicked((ids) => toggleAssignee(ids, userId))}
                  className="tap-target flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-app-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <MemberAvatar name={name} />
                  <span className="flex-1 truncate">{name}</span>
                  {selected && <Check className="size-4 text-primary" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="px-2 pb-2 pt-2 text-xs text-muted-foreground">
          {atMax
            ? t("tasks.assigneesMax", { max: MAX_ASSIGNEES })
            : t("tasks.bulkAssignHint")}
        </p>
        <Button
          size="sm"
          className="w-full"
          disabled={picked.length === 0}
          onClick={() => {
            onAssign(picked);
            setOpen(false);
          }}
        >
          {t("tasks.bulkAssignApply")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function TaskBulkBar({
  selection,
  loadedIds,
  hasMore,
  pending,
  onSelectLoaded,
  onSelectAllMatching,
  onClear,
  onMarkDone,
  onMarkUndone,
  onAssign,
  onDelete,
  onSetPriority,
  onAddLabel,
  onRemoveLabel,
  selectedLabelIds = null,
}: {
  selection: BulkSelection;
  loadedIds: readonly string[];
  hasMore: boolean;
  pending: boolean;
  onSelectLoaded: () => void;
  onSelectAllMatching: () => void;
  onClear: () => void;
  onMarkDone: () => void;
  onMarkUndone: () => void;
  onAssign: (userIds: string[]) => void;
  onDelete: () => void;
  onSetPriority: (priority: TaskPriority) => void;
  onAddLabel: (tagId: string) => void;
  onRemoveLabel: (tagId: string) => void;
  /** #713: each selected task's label ids; null when the selection is a filter. */
  selectedLabelIds?: readonly (readonly string[])[] | null;
}) {
  const t = useT();
  const canDelete = useCanDeleteRecords();
  const tags = useTags().data?.data ?? [];
  const showEscalate = canEscalate(selection, loadedIds, hasMore);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-app-line-soft bg-app-inset px-4 py-2">
      <span className="text-[13px] font-medium">{selectionLabel(selection)}</span>

      {/* The step BEFORE the escalation, so "everything matching" is a second
          deliberate tap rather than the first thing the bar offers. */}
      {selection.mode === "ids" && loadedIds.length > selection.ids.size && (
        <Button size="sm" variant="ghost" onClick={onSelectLoaded} disabled={pending}>
          {t("tasks.bulkSelectThese", { count: loadedIds.length })}
        </Button>
      )}
      {showEscalate && (
        <Button size="sm" variant="ghost" onClick={onSelectAllMatching} disabled={pending}>
          {t("tasks.bulkSelectAllMatching")}
        </Button>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onMarkDone} disabled={pending}>
          <Check className="size-3.5" aria-hidden />
          {t("tasks.markDoneAction")}
        </Button>

        <BulkAssign pending={pending} onAssign={onAssign} />

        {/* Behind the menu, not on the bar. Un-ticking a batch is rare enough
            that a button for it would crowd out the one people came for, and
            deleting is destructive enough that it should take a deliberate
            second move. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" disabled={pending}>
              {t("tasks.bulkMore")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onMarkUndone}>
              <Undo2 className="size-3.5" aria-hidden />
              {t("tasks.markNotDone")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1.5">
              <Flag className="size-3.5" aria-hidden />
              {t("tasks.bulkSetPriority")}
            </DropdownMenuLabel>
            {PRIORITY_PICKER.map((priority) => (
              <DropdownMenuItem key={priority} onSelect={() => onSetPriority(priority)}>
                {t(priorityLabelKey(priority))}
              </DropdownMenuItem>
            ))}
            {tags.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <TagChecklist
                  asSubmenu
                  label={t("tasks.labels")}
                  tags={tags}
                  itemTagIds={selectedLabelIds}
                  selectionKey={
                    selection.mode === "ids" ? [...selection.ids].sort().join(",") : "filter"
                  }
                  onToggle={(tag, action) =>
                    action === "add" ? onAddLabel(tag.id) : onRemoveLabel(tag.id)
                  }
                />
              </>
            )}
            {canDelete && (
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 className="size-3.5" aria-hidden />
                {t("common.delete")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button size="sm" variant="ghost" onClick={onClear} disabled={pending}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
