"use client";

import { CalendarDays, LayoutGrid, List, MapPin } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { cn } from "@/lib/utils";

import { TaskFilterBar } from "./task-filter-bar";
import {
  parseTaskSearchParams,
  serializeTaskState,
  TASK_VIEWS,
  type TaskPageState,
  type TaskView,
} from "./task-view-url";
import { BoardView } from "./views/board-view";
import { CalendarView } from "./views/calendar-view";
import { ListView } from "./views/list-view";
import { MapView } from "./views/map-view";

const VIEW_ICONS: Record<TaskView, typeof List> = {
  list: List,
  board: LayoutGrid,
  calendar: CalendarDays,
  map: MapPin,
};

/**
 * The /tasks page (D25) — a URL-state view switcher over the four views (List /
 * Board / Calendar / Map) sharing one filter bar. All state lives in the URL
 * (`?view=&tab=&assignee=&due=&q=`) so a view is shareable and the back button
 * works. Calm Wealthsimple: the switcher is a quiet segmented control (stone
 * active), the filters are one-glance chips (no drawer), and each row/card/pin
 * deep-links back to its source message + conversation.
 */
export function TasksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo(
    () => parseTaskSearchParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const setState = useCallback(
    (next: TaskPageState) => {
      router.replace(`${pathname}${serializeTaskState(next)}`, { scroll: false });
    },
    [router, pathname],
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 md:px-6 md:py-8">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <ViewSwitcher
            view={state.view}
            onChange={(view) => setState({ ...state, view })}
          />
        </div>
        <TaskFilterBar state={state} onChange={setState} />
      </header>

      <ViewBody state={state} />
    </div>
  );
}

/** The segmented view switcher (quiet stone active pill, never petrol). */
function ViewSwitcher({
  view,
  onChange,
}: {
  view: TaskView;
  onChange: (view: TaskView) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Task view"
      className="flex rounded-lg bg-muted p-0.5"
    >
      {TASK_VIEWS.map(({ id, label }) => {
        const Icon = VIEW_ICONS[id];
        const selected = view === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={label}
            onClick={() => onChange(id)}
            className={cn(
              "flex min-h-9 items-center gap-1.5 rounded-md px-3 py-1 text-[13px] font-medium transition-colors duration-150 ease-out",
              selected
                ? "bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Render the active view. Each reads the shared page state (tab + chips). */
function ViewBody({ state }: { state: TaskPageState }) {
  switch (state.view) {
    case "board":
      return <BoardView state={state} />;
    case "calendar":
      return <CalendarView state={state} />;
    case "map":
      return <MapView state={state} />;
    case "list":
    default:
      return <ListView state={state} />;
  }
}
