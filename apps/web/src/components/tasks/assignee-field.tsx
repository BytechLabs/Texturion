"use client";

import { Check } from "lucide-react";
import { useState } from "react";

import { MemberAvatar, useMemberNames } from "@/components/inbox/member-avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useLocale, useT } from "@/i18n/provider";
import { useMe } from "@/lib/api/me";
import { useMembers } from "@/lib/api/team";
import { cn } from "@/lib/utils";

import {
  MAX_ASSIGNEES,
  sameCrew,
  STACK_LIMIT,
  toggleAssignee,
} from "./task-assignees";

/**
 * Up to three overlapping avatars, then "+N". The whole stack is one image to
 * a screen reader that says who is on the task, so the letters are never read.
 */
export function AssigneeStack({
  names,
  className,
}: {
  names: readonly string[];
  className?: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  if (names.length === 0) return null;
  const shown = names.slice(0, STACK_LIMIT);
  const extra = names.length - shown.length;
  const spoken = new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(names);
  return (
    <span
      role="img"
      aria-label={t("tasks.assigneesAria", { names: spoken })}
      className={cn("flex shrink-0 items-center", className)}
    >
      {shown.map((name, index) => (
        <MemberAvatar
          key={`${index}-${name}`}
          name={name}
          className={cn("ring-2 ring-background", index > 0 && "-ml-1.5")}
        />
      ))}
      {extra > 0 && (
        <span
          aria-hidden
          className="-ml-1.5 flex size-[18px] shrink-0 select-none items-center justify-center rounded-full bg-primary/10 text-[9px] font-medium text-primary ring-2 ring-background"
        >
          {t("tasks.assigneeMoreChip", { count: extra })}
        </span>
      )}
    </span>
  );
}

/** "Ana", or "Ana and 2 more". */
export function assigneeSummary(
  names: readonly string[],
  t: ReturnType<typeof useT>,
): string {
  if (names.length === 0) return t("tasks.unassigned");
  if (names.length === 1) return names[0];
  return t("tasks.assigneesNameAndMore", {
    name: names[0],
    count: names.length - 1,
  });
}

/**
 * The multi-select the task form, the drawer and the list rows share: a
 * trigger showing who is on the task, and a checklist of members in a popover.
 * Closing the popover commits the change, so ticking three people is one save
 * and one history line each, not three round trips.
 */
export function AssigneeField({
  value,
  onCommit,
  id,
  ariaLabel,
  triggerClassName,
  compact = false,
}: {
  value: readonly string[];
  onCommit: (ids: string[]) => void;
  id?: string;
  ariaLabel: string;
  triggerClassName?: string;
  /** A quiet inline trigger for list rows, rather than a full-width field. */
  compact?: boolean;
}) {
  const t = useT();
  const me = useMe();
  const members = useMembers().data?.data ?? [];
  const roster = useMemberNames();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([...value]);

  const names = value.map((userId) => roster.get(userId) ?? t("tasks.teammate"));
  const atMax = draft.length >= MAX_ASSIGNEES;

  function onOpenChange(next: boolean) {
    if (next) setDraft([...value]);
    else if (!sameCrew(draft, value)) onCommit(draft);
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            compact
              ? "flex min-h-8 items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] hover:bg-app-hover focus-visible:ring-2 focus-visible:ring-ring"
              : "flex min-h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:ring-[3px] focus-visible:ring-ring",
            triggerClassName,
          )}
        >
          <AssigneeStack names={names} />
          <span
            className={cn(
              "truncate",
              names.length === 0 ? "text-muted-foreground" : "text-app-muted",
            )}
          >
            {assigneeSummary(names, t)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-1"
        onClick={(event) => event.stopPropagation()}
      >
        <ul role="listbox" aria-multiselectable aria-label={ariaLabel} className="max-h-64 overflow-y-auto">
          {members.map((member) => {
            const selected = draft.includes(member.user_id);
            const blocked = !selected && atMax;
            const name =
              member.display_name.trim() !== ""
                ? member.display_name
                : t("tasks.teammate");
            return (
              <li key={member.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={blocked}
                  onClick={() =>
                    setDraft((ids) => toggleAssignee(ids, member.user_id))
                  }
                  className="tap-target flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-app-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <MemberAvatar name={name} />
                  <span className="flex-1 truncate">
                    {name}
                    {me.data?.user_id === member.user_id
                      ? t("tasks.youSuffix")
                      : ""}
                  </span>
                  {selected && <Check className="size-4 text-primary" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
        {atMax && (
          <p className="px-2 pb-1 pt-2 text-xs text-muted-foreground">
            {t("tasks.assigneesMax", { max: MAX_ASSIGNEES })}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
