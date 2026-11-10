"use client";

import {
  tagSelectionState,
  tagToggleAction,
  type TagSelectionState,
} from "@loonext/shared";
import { Tag as TagIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ChecklistTag {
  id: string;
  name: string;
}

/**
 * #713: one control for a tag or label across a selection, in place of an
 * "add" list and a "remove" list. The menu stays open so several change in a row.
 *
 * A filter selection's rows are not loaded, so every row starts mixed; each
 * change is remembered here until the selection changes, which is what lets a
 * second click on a tag just added take it off again.
 *
 * Applying: Zen of Clarity (one control, not two) and Smart Defaults (the
 * selection's current state is the starting point).
 */
export function TagChecklist({
  label,
  tags,
  itemTagIds,
  selectionKey,
  emptyLabel,
  disabled,
  asSubmenu = false,
  onToggle,
}: {
  label: string;
  tags: readonly ChecklistTag[];
  /** Each selected item's tag ids; null when the selection is a filter. */
  itemTagIds: readonly (readonly string[])[] | null;
  /** Changes whenever the selection does, clearing remembered changes. */
  selectionKey: string;
  emptyLabel?: string;
  disabled?: boolean;
  asSubmenu?: boolean;
  onToggle: (tag: ChecklistTag, action: "add" | "remove") => void;
}) {
  const [changed, setChanged] = useState<Record<string, TagSelectionState>>({});
  // A string, because callers build `itemTagIds` fresh on every render. Fresh
  // server data replaces what was remembered.
  const dataKey = itemTagIds === null ? "" : JSON.stringify(itemTagIds);
  useEffect(() => setChanged({}), [selectionKey, dataKey]);

  const rows =
    tags.length === 0 ? (
      emptyLabel && (
        <p className="max-w-56 px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</p>
      )
    ) : (
      tags.map((tag) => {
        const state = changed[tag.id] ?? tagSelectionState(itemTagIds, tag.id);
        return (
          <DropdownMenuCheckboxItem
            key={tag.id}
            checked={state === "all" ? true : state === "none" ? false : "indeterminate"}
            onSelect={(event) => {
              event.preventDefault();
              const action = tagToggleAction(state);
              setChanged((prev) => ({ ...prev, [tag.id]: action === "add" ? "all" : "none" }));
              onToggle(tag, action);
            }}
          >
            {tag.name}
          </DropdownMenuCheckboxItem>
        );
      })
    );

  const icon = <TagIcon className="size-3.5" strokeWidth={1.75} aria-hidden />;
  if (asSubmenu) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={disabled}>
          {icon}
          {label}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-72 overflow-y-auto">{rows}</DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          {icon}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {rows}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
