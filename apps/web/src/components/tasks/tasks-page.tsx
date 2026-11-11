"use client";

import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CalendarDays, LayoutGrid, List, MapPin } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { useT } from "@/i18n/provider";

import { NewTaskButton } from "./new-task";
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
        <PageHeader
          title={t("tasks.pageTitle")}
          secondary={
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
          }
          primary={<NewTaskButton variant="default" size="sm" />}
        />
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
  return (
    <SegmentedControl
      ariaLabel={t("tasks.viewAria")}
      value={view}
      onChange={onChange}
      options={TASK_VIEWS.map(({ id, labelKey }) => {
        const Icon = VIEW_ICONS[id];
        return {
          value: id,
          label: t(labelKey),
          icon: <Icon className="size-4" strokeWidth={1.75} aria-hidden />,
        };
      })}
    />
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
