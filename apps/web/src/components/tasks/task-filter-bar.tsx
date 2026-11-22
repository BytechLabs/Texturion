"use client";

import { MemberAvatar } from "@/components/inbox/member-avatar";
import { Check, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SavedViewsMenu } from "@/components/saved-views/saved-views-menu";
import { usePhoneLine } from "@/components/shell/phone-line";
import { FilterButton } from "@/components/ui/filter-button";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useT } from '@/i18n/provider';
import type { MessageKey } from '@/i18n/provider';
import { flattenPages } from "@/lib/api/pagination";
import { useContact, useContacts } from "@/lib/api/contacts";
import { useTags } from "@/lib/api/tags";
import { useMembers } from "@/lib/api/team";
import type { TaskPriority } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";
import { SearchField } from "@/components/ui/search-field";

import { PRIORITY_PICKER, priorityLabelKey } from "./task-planning";
import { DUE_LABEL_KEYS, TASK_COLUMNS } from './task-view-url';
import type { DueFilter, TaskGroup, TaskPageState, TaskSort, TaskSource } from './task-view-url';

import {
  suggestTaskViewName,
  taskStateToView,
  taskViewMatches,
  viewToTaskState,
} from "./task-saved-views";

type OptionalTaskField = Exclude<keyof TaskPageState, "tab" | "view">;
const COLUMN_LABELS = {
  assignee: "tasks.assignee",
  due: "tasks.due",
  scheduled: "tasks.scheduledTime",
  status: "tasks.columnStatus",
} as const;

export function TaskFilterBar({
  state: input,
  onChange,
}: {
  state: TaskPageState;
  onChange: (next: TaskPageState) => void;
}) {
  const t = useT();
  const { userId } = useActiveCompany();
  const state: TaskPageState = {
    ...input,
    tab: "all",
    assignee: input.assignee ?? (input.unassigned || input.tab === "all" ? undefined : "me"),
    status: input.status ?? (input.tab === "open" || input.tab === "done" ? input.tab : undefined),
  };
  const count = taskFilterCount(state);
  let selected = "custom";
  if (count === 0) selected = "all";
  if (count === 1 && state.assignee === "me") selected = "mine";
  if (count === 1 && state.unassigned) selected = "unassigned";
  return (
    <div className="space-y-2.5">
      <TaskSearch state={state} onChange={onChange} />
      <div className="flex flex-wrap items-center gap-1.5">
        <SimpleSelect ariaLabel={t("tasks.taskPresets")} value={selected} className="w-auto"
          onValueChange={(value) => {
            const base = { view: state.view, tab: "all" as const };
            onChange({ ...base, ...(value === "mine" && { assignee: "me" }), ...(value === "unassigned" && { unassigned: true }) });
          }}
          options={[
            { value: "all", label: t("tasks.allTasks") },
            { value: "mine", label: t("tasks.myWork") },
            { value: "unassigned", label: t("tasks.unassigned") },
            ...(selected === "custom" ? [{ value: "custom", label: t("tasks.customTasks"), disabled: true }] : []),
          ]}
        />
        <FilterPopover state={state} onChange={onChange} />
        {state.view === "list" && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="min-h-10 rounded-md border border-input bg-background px-3 text-sm">{t("tasks.columns")}</button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56">
              {TASK_COLUMNS.map((column) => {
                const selectedColumns = state.columns ?? TASK_COLUMNS;
                return <label key={column} className="flex min-h-10 items-center gap-2 text-sm">
                  <input type="checkbox" checked={selectedColumns.includes(column)} onChange={(event) => {
                    const { checked } = event.target;
                    onChange({ ...state, columns: TASK_COLUMNS.filter((value) =>
                      value === column ? checked : selectedColumns.includes(value)) });
                  }} />{t(COLUMN_LABELS[column])}
                </label>;
              })}
            </PopoverContent>
          </Popover>
        )}
        <SavedViewsMenu
          surface="tasks"
          isCurrent={(view) => taskViewMatches(view, state, userId)}
          onApply={(view) => onChange(viewToTaskState(view, userId, state))}
          currentFilters={() => taskStateToView(state, userId)}
          suggestName={() => suggestTaskViewName(state, t)}
          hasFilters={count > 0 || state.view !== "list" || state.columns !== undefined}
          saveDescription={t("tasks.viewSaveDescription")}
          shareNote={t("tasks.viewShareNote")}
        />
      </div>
      {/* #711: only while something is applied. */}
      {taskFilterCount(state) > 0 && <ChipRow state={state} onChange={onChange} />}
    </div>
  );
}

/** #711: the chips the row shows, which is also the Filter button's count. */
export function taskFilterCount(state: TaskPageState): number {
  return [
    state.status,
    state.scheduled !== undefined,
    state.assignee,
    state.unassigned,
    state.notConfirmed,
    state.due,
    state.priority && state.priority.length > 0,
    state.tag,
    state.contact,
    state.createdBy,
    state.source,
    state.sourceLine,
    state.files,
    state.refs,
    state.dueFrom || state.dueTo,
    state.group && state.group !== "status",
    state.sort && state.sort !== "created",
  ].filter(Boolean).length;
}

function withoutTaskFields(state: TaskPageState, keys: readonly OptionalTaskField[]): TaskPageState {
  let next = state;
  for (const key of keys) {
    const { [key]: _removed, ...remaining } = next;
    next = remaining;
  }
  return next;
}

/** Every filter off; the tab, view and search stay. */
function clearTaskFilters(state: TaskPageState): TaskPageState {
  return withoutTaskFields(state, [
    "status", "scheduled", "assignee", "unassigned", "due", "priority", "tag", "contact", "createdBy",
    "source", "sourceLine", "files", "refs", "dueFrom", "dueTo", "group", "sort", "notConfirmed",
  ]);
}

/** Debounced title search (250ms → `q`). */
function TaskSearch({
  state,
  onChange,
}: {
  state: TaskPageState;
  onChange: (next: TaskPageState) => void;
}) {
  const t = useT();
  const [text, setText] = useState(state.q ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const urlQ = state.q ?? "";
  const lastUrlQ = useRef(urlQ);
  useEffect(() => {
    if (urlQ !== lastUrlQ.current) {
      lastUrlQ.current = urlQ;
      setText(urlQ);
    }
  }, [urlQ]);

  const setSearch = (value: string) => {
    setText(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      lastUrlQ.current = value;
      const next = { ...stateRef.current };
      if (value.trim() === "") delete next.q;
      else next.q = value;
      onChange(next);
    }, 250);
  };
  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  return (
    <SearchField
      containerClassName="max-w-md"
      value={text}
      onValueChange={setSearch}
      placeholder={t("tasks.searchPlaceholder")}
      aria-label={t("tasks.searchAria")}
      clearLabel={t("tasks.clearSearch")}
    />
  );
}

/** The always-visible removable chips + the `+ Filter` popover. */
function ChipRow({
  state,
  onChange,
}: {
  state: TaskPageState;
  onChange: (next: TaskPageState) => void;
}) {
  const t = useT();
  const members = useMembers();
  const tags = useTags();
  const { lines } = usePhoneLine();
  const tagName = state.tag
    ? (tags.data?.data.find((tag) => tag.id === state.tag)?.name ??
      t("tasks.label"))
    : null;
  const assigneeName = state.assignee === "me" ? t("tasks.myWork")
    : members.data?.data.find((m) => m.user_id === state.assignee)?.display_name;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {state.status && <Chip label={t(state.status === "open" ? "tasks.statusOpen" : "tasks.statusDone")}
        onRemove={() => onChange(withoutTaskFields(state, ["status"]))} />}
      {state.scheduled !== undefined && <Chip label={t(state.scheduled ? "tasks.dispatchAdded" : "tasks.dispatchRemoved")}
        onRemove={() => onChange(withoutTaskFields(state, ["scheduled"]))} />}
      {state.notConfirmed && (
        <Chip label={t("tasks.notConfirmed")} onRemove={() => onChange(withoutTaskFields(state, ["notConfirmed"]))} />
      )}
      {state.sourceLine && (
        <Chip
          label={lines.find((line) => line.id === state.sourceLine)?.name ?? t("shell.sourceLine")}
          onRemove={() => onChange(withoutTaskFields(state, ["sourceLine"]))}
        />
      )}
      {state.assignee && (
        <Chip
          label={assigneeName || t("tasks.assigneeChipFallback")}
          memberId={state.assignee === "me" ? undefined : state.assignee}
          onRemove={() => {
            const next = { ...state };
            delete next.assignee;
            onChange(next);
          }}
        />
      )}
      {state.unassigned && (
        <Chip
          label={t("tasks.unassigned")}
          onRemove={() => {
            const next = { ...state };
            delete next.unassigned;
            onChange(next);
          }}
        />
      )}
      {state.due && (
        <Chip
          label={t(DUE_LABEL_KEYS[state.due])}
          onRemove={() => {
            const next = { ...state };
            delete next.due;
            onChange(next);
          }}
        />
      )}
      {state.priority && state.priority.length > 0 && (
        <Chip
          label={
            state.priority.length === 1
              ? t(priorityLabelKey(state.priority[0]))
              : t("tasks.priorityMany", { count: state.priority.length })
          }
          onRemove={() => {
            const next = { ...state };
            delete next.priority;
            onChange(next);
          }}
        />
      )}
      {tagName && (
        <Chip
          label={tagName}
          onRemove={() => {
            const next = { ...state };
            delete next.tag;
            onChange(next);
          }}
        />
      )}
      {state.contact && (
        <ContactChip
          contactId={state.contact}
          onRemove={() => {
            const next = { ...state };
            delete next.contact;
            onChange(next);
          }}
        />
      )}
      {state.createdBy && (
        <Chip
          label={t("tasks.chipCreatedBy", {
            name:
              state.createdBy === "me"
                ? t("tasks.createdByMe")
                : (members.data?.data.find((m) => m.user_id === state.createdBy)
                    ?.display_name ?? t("tasks.teammate")),
          })}
          onRemove={() => {
            const next = { ...state };
            delete next.createdBy;
            onChange(next);
          }}
        />
      )}
      {state.source && (
        <Chip
          label={t("tasks.chipSource", { source: t(SOURCE_LABEL_KEYS[state.source]) })}
          onRemove={() => {
            const next = { ...state };
            delete next.source;
            onChange(next);
          }}
        />
      )}
      {state.files && (
        <Chip
          label={t("tasks.hasFiles")}
          onRemove={() => {
            const next = { ...state };
            delete next.files;
            onChange(next);
          }}
        />
      )}
      {state.refs && (
        <Chip
          label={t("tasks.hasLinks")}
          onRemove={() => {
            const next = { ...state };
            delete next.refs;
            onChange(next);
          }}
        />
      )}
      {(state.dueFrom || state.dueTo) && (
        <Chip
          label={
            state.dueFrom && state.dueTo
              ? t("tasks.chipDueRange", { from: state.dueFrom, to: state.dueTo })
              : (state.dueFrom
                ? t("tasks.chipDueFrom", { date: state.dueFrom })
                : t("tasks.chipDueUntil", { date: state.dueTo ?? "" }))
          }
          onRemove={() => {
            const next = { ...state };
            delete next.dueFrom;
            delete next.dueTo;
            onChange(next);
          }}
        />
      )}
      {state.group && state.group !== "status" && (
        <Chip
          label={t("tasks.chipGroupedBy", { group: t(GROUP_LABEL_KEYS[state.group]) })}
          onRemove={() => {
            const next = { ...state };
            delete next.group;
            onChange(next);
          }}
        />
      )}
      {state.sort && state.sort !== "created" && (
        <Chip
          label={t("tasks.sortedBy", { sort: t(SORT_LABEL_KEYS[state.sort]) })}
          onRemove={() => {
            const next = { ...state };
            delete next.sort;
            onChange(next);
          }}
        />
      )}
      <button
        type="button"
        onClick={() => onChange(clearTaskFilters(state))}
        className="tap-target inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground underline decoration-border underline-offset-2 transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("inbox.clearAll")}
      </button>
    </div>
  );
}

const SORT_LABEL_KEYS: Record<TaskSort, MessageKey> = {
  created: "tasks.sortCreated",
  due: "tasks.sortDue",
  priority: "tasks.sortPriority",
  updated: "tasks.sortUpdated",
};

const SOURCE_LABEL_KEYS: Record<TaskSource, MessageKey> = {
  text: "tasks.sourceText",
  call: "tasks.sourceCall",
  none: "tasks.sourceNone",
};

const GROUP_LABEL_KEYS: Record<TaskGroup, MessageKey> = {
  status: "tasks.groupStatus",
  assignee: "tasks.groupAssignee",
  priority: "tasks.groupPriority",
};

/** Customers matching what was typed. Mounted only once there is something to match. */
function CustomerGroup({
  search,
  selected,
  onPick,
}: {
  search: string;
  selected: string | undefined;
  onPick: (id: string) => void;
}) {
  const t = useT();
  const contacts = useContacts(search);
  const found = flattenPages(contacts.data).slice(0, 6);
  if (found.length === 0) return null;
  return (
    <CommandGroup heading={t("tasks.customer")}>
      {found.map((contact) => (
        <CommandItem
          key={contact.id}
          value={`contact-${contact.id}`}
          keywords={[search]}
          onSelect={() => onPick(contact.id)}
        >
          <span className="truncate">{contact.name ?? contact.phone_e164}</span>
          {selected === contact.id && (
            <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
          )}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

/** The customer filter, named: the contact's name once it loads. */
function ContactChip({
  contactId,
  onRemove,
}: {
  contactId: string;
  onRemove: () => void;
}) {
  const t = useT();
  const contact = useContact(contactId);
  return (
    <Chip
      label={contact.data?.name ?? contact.data?.phone_e164 ?? t("tasks.customer")}
      onRemove={onRemove}
    />
  );
}

function Chip({ label, memberId, onRemove }: { label: string; memberId?: string; onRemove: () => void }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-2 pr-1 text-[11px] font-medium text-secondary-foreground">
      {memberId && <MemberAvatar name={label} memberId={memberId} />}
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("tasks.removeFilterAria", { label })}
        className="tap-target rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <X className="size-3" strokeWidth={1.75} />
      </button>
    </span>
  );
}

/** The `+ Filter` cmdk popover — assignee / unassigned / due (T6.1, no drawer). */
function FilterPopover({
  state,
  onChange,
}: {
  state: TaskPageState;
  onChange: (next: TaskPageState) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const members = useMembers();
  const tags = useTags();
  const { userId } = useActiveCompany();
  const { lines } = usePhoneLine();

  const assignableMembers = useMemo(
    () => (members.data?.data ?? []).filter((m) => m.deactivated_at === null),
    [members.data],
  );

  const setAssignee = (id: string | undefined) => {
    const next = { ...state };
    if (id === undefined) delete next.assignee;
    else {
      next.assignee = id;
      delete next.unassigned;
    }
    onChange(next);
    setOpen(false);
  };
  const toggleUnassigned = () => {
    const next = { ...state };
    if (next.unassigned) delete next.unassigned;
    else {
      next.unassigned = true;
      delete next.assignee;
    }
    onChange(next);
    setOpen(false);
  };
  const setDue = (due: DueFilter | undefined) => {
    const next = { ...state };
    if (due === undefined) delete next.due;
    else {
      next.due = due;
      // A chip and a range say the same thing two ways; the last one picked wins.
      delete next.dueFrom;
      delete next.dueTo;
    }
    onChange(next);
    setOpen(false);
  };

  // Priority is a set, so a pick toggles one and the popover stays open for the next.
  const togglePriority = (priority: TaskPriority) => {
    const current = state.priority ?? [];
    const picked = current.includes(priority)
      ? current.filter((p) => p !== priority)
      : PRIORITY_PICKER.filter((p) => p === priority || current.includes(p));
    const next = { ...state };
    if (picked.length === 0) delete next.priority;
    else next.priority = picked;
    onChange(next);
  };
  const setTag = (id: string | undefined) => {
    const next = { ...state };
    if (id === undefined) delete next.tag;
    else next.tag = id;
    onChange(next);
    setOpen(false);
  };
  const patch = (
    change: Partial<TaskPageState>,
    remove: OptionalTaskField[] = [],
    close = true,
  ) => {
    const next = withoutTaskFields({ ...state, ...change }, remove);
    onChange(next);
    if (close) setOpen(false);
  };
  const setSort = (sort: TaskSort) => {
    const next = { ...state };
    if (sort === "created") delete next.sort;
    else next.sort = sort;
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterButton count={taskFilterCount(state)} />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-64 p-0 shadow-lg">
        <Command
          filter={(_value, query, keywords) => {
            const haystack = (keywords ?? []).join(" ").toLowerCase();
            return haystack.includes(query.toLowerCase().trim()) ? 1 : 0;
          }}
        >
          <CommandInput
            placeholder={t("tasks.filterPlaceholder")}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{t("tasks.noFilters")}</CommandEmpty>
            <CommandGroup heading={t("tasks.statusTabsAria")}>
              {(["open", "done"] as const).map((status) => (
                <CommandItem key={status} onSelect={() => {
                  onChange({ ...state, status });
                  setOpen(false);
                }}>
                  {t(status === "open" ? "tasks.statusOpen" : "tasks.statusDone")}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading={t("tasks.scheduledTime")}>
              {[true, false].map((scheduled) => (
                <CommandItem key={String(scheduled)} onSelect={() => patch({ scheduled })}>
                  {t(scheduled ? "tasks.dispatchAdded" : "tasks.dispatchRemoved")}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading={t("tasks.assignee")}>
              <CommandItem onSelect={() => setAssignee("me")}>{t("tasks.myWork")}</CommandItem>
              <CommandItem
                value="unassigned"
                keywords={[t("tasks.unassigned"), t("tasks.keywordNobody")]}
                onSelect={toggleUnassigned}
              >
                <span>{t("tasks.unassigned")}</span>
                {state.unassigned && (
                  <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                )}
              </CommandItem>
              {assignableMembers.map((m) => {
                const active = state.assignee === m.user_id;
                return (
                  <CommandItem
                    key={m.user_id}
                    value={`assignee-${m.user_id}`}
                    keywords={[m.display_name || t("tasks.teammate")]}
                    onSelect={() => setAssignee(active ? undefined : m.user_id)}
                  >
                    <MemberAvatar name={m.display_name || t("tasks.teammate")} memberId={m.user_id} />
                    <span className="truncate">
                      {m.display_name || t("tasks.teammate")}
                      {m.user_id === userId ? t("tasks.youSuffix") : ""}
                    </span>
                    {active && (
                      <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandGroup heading={t("tasks.due")}>
              <CommandItem value="not-confirmed" onSelect={() => patch({ notConfirmed: !state.notConfirmed })}>
                {t("tasks.notConfirmed")}
                {state.notConfirmed && <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />}
              </CommandItem>
              {(["overdue", "today", "week"] as const).map((due) => {
                const active = state.due === due;
                return (
                  <CommandItem
                    key={due}
                    value={due}
                    keywords={[t(DUE_LABEL_KEYS[due])]}
                    onSelect={() => setDue(active ? undefined : due)}
                  >
                    <span>{t(DUE_LABEL_KEYS[due])}</span>
                    {active && (
                      <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandGroup heading={t("tasks.priority")}>
              {PRIORITY_PICKER.map((priority) => {
                const active = state.priority?.includes(priority) ?? false;
                return (
                  <CommandItem
                    key={priority}
                    value={`priority-${priority}`}
                    keywords={[t(priorityLabelKey(priority)), t("tasks.priority")]}
                    onSelect={() => togglePriority(priority)}
                  >
                    <span>{t(priorityLabelKey(priority))}</span>
                    {active && (
                      <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {(tags.data?.data.length ?? 0) > 0 && (
              <CommandGroup heading={t("tasks.label")}>
                {(tags.data?.data ?? []).map((tag) => {
                  const active = state.tag === tag.id;
                  return (
                    <CommandItem
                      key={tag.id}
                      value={`tag-${tag.id}`}
                      keywords={[tag.name, t("tasks.label")]}
                      onSelect={() => setTag(active ? undefined : tag.id)}
                    >
                      <span className="truncate">{tag.name}</span>
                      {active && (
                        <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {search.trim().length >= 2 && (
              <CustomerGroup
                search={search}
                selected={state.contact}
                onPick={(id) => patch({ contact: id })}
              />
            )}
            <CommandGroup heading={t("tasks.createdBy")}>
              <CommandItem
                value="created-by-me"
                keywords={[t("tasks.createdByMe"), t("tasks.createdBy")]}
                onSelect={() =>
                  state.createdBy === "me"
                    ? patch({}, ["createdBy"])
                    : patch({ createdBy: "me" })
                }
              >
                <span>{t("tasks.createdByMe")}</span>
                {state.createdBy === "me" && (
                  <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                )}
              </CommandItem>
              {assignableMembers
                .filter((m) => m.user_id !== userId)
                .map((m) => (
                  <CommandItem
                    key={m.user_id}
                    value={`created-by-${m.user_id}`}
                    keywords={[m.display_name || t("tasks.teammate"), t("tasks.createdBy")]}
                    onSelect={() =>
                      state.createdBy === m.user_id
                        ? patch({}, ["createdBy"])
                        : patch({ createdBy: m.user_id })
                    }
                  >
                    <span className="truncate">{m.display_name || t("tasks.teammate")}</span>
                    {state.createdBy === m.user_id && (
                      <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                    )}
                  </CommandItem>
                ))}
            </CommandGroup>
            <CommandGroup heading={t("tasks.source")}>
              {(["text", "call", "none"] as const).map((source) => (
                <CommandItem
                  key={source}
                  value={`source-${source}`}
                  keywords={[t(SOURCE_LABEL_KEYS[source]), t("tasks.source")]}
                  onSelect={() =>
                    state.source === source ? patch({}, ["source"]) : patch({ source })
                  }
                >
                  <span>{t(SOURCE_LABEL_KEYS[source])}</span>
                  {state.source === source && (
                    <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {lines.length > 0 && (
              <CommandGroup heading={t("shell.sourceLine")}>
                {lines.map((line) => (
                  <CommandItem
                    key={line.id}
                    value={`source-line-${line.id}`}
                    keywords={[line.name, line.number, t("shell.sourceLine")]}
                    onSelect={() => state.sourceLine === line.id
                      ? patch({}, ["sourceLine"])
                      : patch({ sourceLine: line.id })}
                  >
                    <span>{line.name}</span>
                    {state.sourceLine === line.id && (
                      <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading={t("tasks.carries")}>
              <CommandItem
                value="has-files"
                keywords={[t("tasks.hasFiles"), t("tasks.carries")]}
                onSelect={() => (state.files ? patch({}, ["files"]) : patch({ files: true }))}
              >
                <span>{t("tasks.hasFiles")}</span>
                {state.files && <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />}
              </CommandItem>
              <CommandItem
                value="has-links"
                keywords={[t("tasks.hasLinks"), t("tasks.carries")]}
                onSelect={() => (state.refs ? patch({}, ["refs"]) : patch({ refs: true }))}
              >
                <span>{t("tasks.hasLinks")}</span>
                {state.refs && <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />}
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading={t("tasks.groupHeading")}>
              {(["status", "assignee", "priority"] as const).map((group) => (
                <CommandItem
                  key={group}
                  value={`group-${group}`}
                  keywords={[t(GROUP_LABEL_KEYS[group]), t("tasks.groupHeading")]}
                  onSelect={() =>
                    group === "status" ? patch({}, ["group"]) : patch({ group })
                  }
                >
                  <span>{t(GROUP_LABEL_KEYS[group])}</span>
                  {(state.group ?? "status") === group && (
                    <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading={t("tasks.sortHeading")}>
              {(["created", "due", "priority", "updated"] as const).map((sort) => {
                const active = (state.sort ?? "created") === sort;
                return (
                  <CommandItem
                    key={sort}
                    value={`sort-${sort}`}
                    keywords={[t(SORT_LABEL_KEYS[sort]), t("tasks.sortHeading")]}
                    onSelect={() => setSort(sort)}
                  >
                    <span>{t(SORT_LABEL_KEYS[sort])}</span>
                    {active && (
                      <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        <fieldset className="grid grid-cols-2 gap-2 border-t border-border p-3">
          <legend className="sr-only">{t("tasks.dueRange")}</legend>
          <label className="space-y-1 text-[11px] text-muted-foreground">
            {t("tasks.dueFrom")}
            <Input
              type="date"
              value={state.dueFrom ?? ""}
              max={state.dueTo}
              onChange={(e) =>
                e.target.value
                  ? patch({ dueFrom: e.target.value }, ["due"], false)
                  : patch({}, ["dueFrom"], false)
              }
              className="h-8 text-[13px]"
            />
          </label>
          <label className="space-y-1 text-[11px] text-muted-foreground">
            {t("tasks.dueTo")}
            <Input
              type="date"
              value={state.dueTo ?? ""}
              min={state.dueFrom}
              onChange={(e) =>
                e.target.value
                  ? patch({ dueTo: e.target.value }, ["due"], false)
                  : patch({}, ["dueTo"], false)
              }
              className="h-8 text-[13px]"
            />
          </label>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
