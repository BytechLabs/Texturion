"use client";

import { CalendarDays, LayoutGrid, List, MapPin } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef } from "react";

import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

import { TaskFilterBar } from "./task-filter-bar";
import { ExportTasks } from "./export-tasks";
import {
  coerceTabForView,
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
  const t = useT();
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
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("tasks.pageTitle")}
          </h1>
          <ViewSwitcher
            view={state.view}
            onChange={(view) =>
              // #113: keep the tab meaningful for the new view (Board/Map only
              // support Mine | All, so Open/Done coerce to Mine).
              setState({
                ...state,
                view,
                tab: coerceTabForView(state.tab, view),
              })
            }
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TaskFilterBar state={state} onChange={setState} />
          {/* #304: quiet, beside the filters that already say what it covers.
              Absent for anybody without `contacts.bulk` — every task names a
              customer. */}
          <ExportTasks tab={state.tab} />
        </div>
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
  const t = useT();
  // WAI-ARIA tablist keyboard contract: Arrow/Home/End move focus AND selection
  // with a roving tabindex (one Tab stop) — the role="tab" markup promised it
  // but the arrows were dead.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const currentIndex = TASK_VIEWS.findIndex((v) => v.id === view);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const from = currentIndex === -1 ? 0 : currentIndex;
    let next = from;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (from + 1) % TASK_VIEWS.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (from - 1 + TASK_VIEWS.length) % TASK_VIEWS.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = TASK_VIEWS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange(TASK_VIEWS[next].id);
    tabRefs.current[next]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={t("tasks.viewAria")}
      onKeyDown={onKeyDown}
      className="flex rounded-lg bg-muted p-0.5"
    >
      {TASK_VIEWS.map(({ id, labelKey }, i) => {
        const Icon = VIEW_ICONS[id];
        const selected = view === id;
        const label = t(labelKey);
        return (
          <button
            key={id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={label}
            tabIndex={selected ? 0 : -1}
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
