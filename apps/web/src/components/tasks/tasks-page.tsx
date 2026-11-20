"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CalendarClock, CalendarDays, LayoutGrid, List, MapPin } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { useT } from "@/i18n/provider";
import { useSavedViews } from "@/lib/api/saved-views";
import type { SavedView } from "@/lib/api/saved-views";
import { useActiveCompany } from "@/lib/company/provider";
import { viewToTaskState } from "./task-saved-views";
import { replaceSearch } from "@/lib/url/search-state";

import { NewTaskButton } from "./new-task";
import { TaskFilterBar } from "./task-filter-bar";
import { ExportTasks } from "./export-tasks";
import { parseTaskSearchParams, serializeTaskState, TASK_VIEWS, toTaskFilters } from './task-view-url';
import type { TaskPageState, TaskView } from './task-view-url';
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

function writeTaskState(next: TaskPageState): void {
  replaceSearch(serializeTaskState(next));
}

/**
 * The /tasks page (D25) — a URL-state view switcher over the four views (List /
 * Board / Calendar / Map) sharing one filter bar. All state lives in the URL
 * (`?view=&tab=&assignee=&due=&q=`) so a view is shareable and the back button
 * works. Calm Wealthsimple: the switcher is a quiet segmented control (stone
 * active), the filters are one-glance chips (no drawer), and each row/card/pin
 * deep-links back to its source message + conversation.
 */
export function SavedTasksPage({ viewId }: { viewId: string }) {
  const t = useT();
  const { data, isPending, isError, refetch } = useSavedViews("tasks");
  if (isPending) return <div role="status" className="p-6">{t("shell.loading")}</div>;
  if (isError) return <Button onClick={() => void refetch()}>{t("common.retry")}</Button>;
  const saved = data?.data.find((view) => view.id === viewId);
  if (!saved) return <Button asChild variant="link"><Link href="/tasks">{t("shell.navTasks")}</Link></Button>;
  return <TasksPage saved={saved} />;
}

export function TasksPage({ saved }: { saved?: SavedView } = {}) {
  const t = useT();
  const searchParams = useSearchParams();

  const { userId } = useActiveCompany();
  const state = useMemo(() => {
    const query = new URLSearchParams(searchParams.toString());
    const parsed = parseTaskSearchParams(query);
    if (saved && !query.has("edited")) return viewToTaskState(saved.filters, userId, parsed);
    return parsed;
  }, [saved, searchParams, userId]);

  function changeState(next: TaskPageState) {
    if (saved) {
      const query = new URLSearchParams(serializeTaskState(next));
      query.set("edited", "1");
      replaceSearch(query.toString());
    } else {
      writeTaskState(next);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 md:px-6 md:py-8">
      <header className="space-y-4">
        <PageHeader
          title={saved?.name ?? t("tasks.pageTitle")}
          secondary={
            <div className="flex flex-wrap items-center gap-2">
              <ViewSwitcher view={state.view} onChange={(view) => changeState({ ...state, view })} />
              <Button variant="outline" size="sm" asChild>
                <Link href="/tasks/planner"><CalendarClock aria-hidden />{t("tasks.planner")}</Link>
              </Button>
            </div>
          }
          primary={<NewTaskButton variant="default" size="sm" />}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TaskFilterBar state={state} onChange={changeState} />
          {/* #304: quiet, beside the filters that already say what it covers.
              Absent for anybody without `contacts.bulk` — every task names a
              customer. Downloads the current view at once (#745). */}
          <ExportTasks filters={toTaskFilters(state)} />
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
    case "board": {
      return <BoardView state={state} />;
    }
    case "calendar": {
      return <CalendarView state={state} />;
    }
    case "map": {
      return <MapView state={state} />;
    }
    
    default: {
      return <ListView state={state} />;
    }
  }
}
