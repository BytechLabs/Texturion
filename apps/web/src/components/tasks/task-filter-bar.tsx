"use client";

import { Check, ListFilter, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMembers } from "@/lib/api/team";
import { useActiveCompany } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

import {
  DUE_LABELS,
  TASK_TABS,
  tabsForView,
  type DueFilter,
  type TaskPageState,
} from "./task-view-url";

/**
 * The /tasks page filter bar (T6.1 / D25) — one-glance, NO fly-out drawer,
 * shared across all four views. Three layers, exactly the inbox model:
 *
 *  1. a debounced title search (→ `q`);
 *  2. the segmented tabs Open | Mine | All | Done (quiet stone active pill —
 *     never petrol; the shared T6.3 contract); and
 *  3. always-visible removable chips (assignee / unassigned / due) + a compact
 *     `+ Filter` cmdk popover that adds a chip.
 *
 * URL is the state — this only calls `onChange` with the next page state; the
 * page writes it to the URL.
 */
export function TaskFilterBar({
  state,
  onChange,
}: {
  state: TaskPageState;
  onChange: (next: TaskPageState) => void;
}) {
  // #113: only the tabs the active view actually applies (Board/Map organize
  // by status themselves, so Open/Done are a no-op there — show Mine | All).
  const visibleTabs = tabsForView(state.view);
  const shownTabs = TASK_TABS.filter(({ id }) => visibleTabs.includes(id));
  // WAI-ARIA tablist keyboard contract the role promises: Arrow/Home/End move
  // selection AND focus (roving tabindex → one Tab stop). Mirrors the inbox
  // FilterBar so the announced `role="tab"` isn't left with dead arrow keys.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = shownTabs.findIndex(({ id }) => id === state.tab);
    if (current === -1) return;
    let next = current;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (current + 1) % shownTabs.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (current - 1 + shownTabs.length) % shownTabs.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = shownTabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange({ ...state, tab: shownTabs[next].id });
    tabRefs.current[next]?.focus();
  };
  return (
    <div className="space-y-2.5">
      <SearchField state={state} onChange={onChange} />
      <div
        role="tablist"
        aria-label="Task status"
        onKeyDown={onTabKeyDown}
        className="flex max-w-md rounded-lg bg-app-line-soft p-0.5"
      >
        {shownTabs.map(({ id, label }, i) => {
            const selected = state.tab === id;
            return (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => onChange({ ...state, tab: id })}
                className={cn(
                  "flex min-h-11 flex-1 items-center justify-center rounded-md px-2 py-1 text-[13px] font-medium transition-colors duration-150 ease-out md:min-h-0",
                  // T6.1: active segment is a QUIET stone pill, never petrol —
                  // petrol is reserved for the page's primary action.
                  selected
                    ? "bg-app-white text-app-ink"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            );
          },
        )}
      </div>
      <ChipRow state={state} onChange={onChange} />
    </div>
  );
}

/** Debounced title search (250ms → `q`). */
function SearchField({
  state,
  onChange,
}: {
  state: TaskPageState;
  onChange: (next: TaskPageState) => void;
}) {
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
    <div className="relative max-w-md">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.75}
      />
      <Input
        type="search"
        value={text}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search tasks"
        aria-label="Search tasks by title"
        className="h-9 pl-8"
      />
      {text !== "" && (
        <button
          type="button"
          onClick={() => setSearch("")}
          aria-label="Clear search"
          className="tap-target absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      )}
    </div>
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
  const members = useMembers();
  const assigneeName = state.assignee
    ? members.data?.data.find((m) => m.user_id === state.assignee)
        ?.display_name || "Assignee"
    : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assigneeName && (
        <Chip
          label={assigneeName}
          onRemove={() => {
            const next = { ...state };
            delete next.assignee;
            onChange(next);
          }}
        />
      )}
      {state.unassigned && (
        <Chip
          label="Unassigned"
          onRemove={() => {
            const next = { ...state };
            delete next.unassigned;
            onChange(next);
          }}
        />
      )}
      {state.due && (
        <Chip
          label={DUE_LABELS[state.due]}
          onRemove={() => {
            const next = { ...state };
            delete next.due;
            onChange(next);
          }}
        />
      )}
      <FilterPopover state={state} onChange={onChange} />
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-2 pr-1 text-[11px] font-medium text-secondary-foreground">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
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
  const [open, setOpen] = useState(false);
  const members = useMembers();
  const { userId } = useActiveCompany();

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
    else next.due = due;
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add filter"
          className="tap-target inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors duration-150 ease-out hover:bg-secondary hover:text-foreground"
        >
          <ListFilter className="size-3" strokeWidth={1.75} aria-hidden />
          Filter
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-64 p-0 shadow-lg">
        <Command
          filter={(_value, search, keywords) => {
            const haystack = (keywords ?? []).join(" ").toLowerCase();
            return haystack.includes(search.toLowerCase().trim()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Filter by…" />
          <CommandList>
            <CommandEmpty>No filters.</CommandEmpty>
            <CommandGroup heading="Assignee">
              <CommandItem
                value="unassigned"
                keywords={["unassigned", "nobody"]}
                onSelect={toggleUnassigned}
              >
                <span>Unassigned</span>
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
                    keywords={[m.display_name || "teammate"]}
                    onSelect={() => setAssignee(active ? undefined : m.user_id)}
                  >
                    <span className="truncate">
                      {m.display_name || "Teammate"}
                      {m.user_id === userId ? " (you)" : ""}
                    </span>
                    {active && (
                      <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandGroup heading="Due">
              {(["overdue", "today", "week"] as const).map((due) => {
                const active = state.due === due;
                return (
                  <CommandItem
                    key={due}
                    value={due}
                    keywords={[DUE_LABELS[due]]}
                    onSelect={() => setDue(active ? undefined : due)}
                  >
                    <span>{DUE_LABELS[due]}</span>
                    {active && (
                      <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
