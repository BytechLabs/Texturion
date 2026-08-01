"use client";

import { Check, Trash2, Undo2, UserPlus } from "lucide-react";

import { MemberAvatar, useMemberNames } from "@/components/inbox/member-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  onAssign: (userId: string | null) => void;
  onDelete: () => void;
}) {
  const memberNames = useMemberNames();
  const showEscalate = canEscalate(selection, loadedIds, hasMore);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-app-line-soft bg-app-inset px-4 py-2">
      <span className="text-[13px] font-medium">{selectionLabel(selection)}</span>

      {/* The step BEFORE the escalation, so "everything matching" is a second
          deliberate tap rather than the first thing the bar offers. */}
      {selection.mode === "ids" && loadedIds.length > selection.ids.size && (
        <Button size="sm" variant="ghost" onClick={onSelectLoaded} disabled={pending}>
          Select these {loadedIds.length}
        </Button>
      )}
      {showEscalate && (
        <Button size="sm" variant="ghost" onClick={onSelectAllMatching} disabled={pending}>
          Select all matching
        </Button>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onMarkDone} disabled={pending}>
          <Check className="size-3.5" aria-hidden />
          Done
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={pending}>
              <UserPlus className="size-3.5" aria-hidden />
              Assign
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {Object.entries(memberNames).map(([userId, name]) => (
              <DropdownMenuItem key={userId} onSelect={() => onAssign(userId)}>
                <MemberAvatar name={name} />
                {name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Behind the menu, not on the bar. Un-ticking a batch is rare enough
            that a button for it would crowd out the one people came for, and
            deleting is destructive enough that it should take a deliberate
            second move. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" disabled={pending}>
              More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onMarkUndone}>
              <Undo2 className="size-3.5" aria-hidden />
              Mark not done
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 className="size-3.5" aria-hidden />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button size="sm" variant="ghost" onClick={onClear} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
