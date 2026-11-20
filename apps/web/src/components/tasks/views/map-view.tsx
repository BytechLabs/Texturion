"use client";

import { MapPin, Navigation } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadError } from "@/components/ui/load-error";
import { ResultsStatus } from "@/components/ui/results-status";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";
import { useAllTasks, useTasks } from "@/lib/api/tasks";
import { flattenPages } from "@/lib/api/pagination";
import type { Task } from "@/lib/api/types";
import { EmptyState } from "@/components/ui/empty-state";
import { browserTimezone } from "@/lib/format/time";

import { EmptyTasks } from "../task-empty";
import { dayFromKey, windowInstants } from "./calendar-create";
import type { TaskPageState } from "../task-view-url";
import { toTaskFilters } from "../task-view-url";
import { compareMapStops, mapDay, mapsRouteHref, taskCoords, taskMapDay } from './map-types';
import type { LocatedTask } from './map-types';
import { useTaskDrawer } from "../use-task-drawer";

/**
 * The map island is imported LAZILY with `ssr:false` so Leaflet + react-leaflet
 * (which touch `window`/`document` at module load) never run on the server AND
 * never land in the main/route bundle — the ~150KB map stack is fetched only
 * when a user actually opens the Map view (D25 / APP-LAYOUT-V2 §7: Board /
 * Calendar / Map are client islands; the map's react-leaflet stays a lazy
 * client island). This is the whole "leaflet is not in the initial bundle"
 * requirement, enforced at the import boundary.
 */
const MapIsland = dynamic(() => import("./map-island").then((m) => m.MapIsland), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] items-center justify-center rounded-xl border border-border bg-secondary/20">
      <Skeleton className="h-full w-full rounded-xl" />
    </div>
  ),
});

export function MapView({ state }: { state: TaskPageState }) {
  const t = useT();
  const [window, setWindow] = useState<"today" | "tomorrow" | "custom" | "all">("today");
  const today = new Date();
  const [pickedDay, setPickedDay] = useState(() => mapDay(today));
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const selectedDay = window === "custom" ? pickedDay : mapDay(window === "tomorrow" ? tomorrow : today);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {([
          ["today", "tasks.mapToday"],
          ["tomorrow", "tasks.mapTomorrow"],
          ["custom", "tasks.mapPickDay"],
          ["all", "tasks.mapAllOpen"],
        ] as const).map(([value, key]) => (
          <Button key={value} variant={window === value ? "secondary" : "outline"} size="sm"
            aria-pressed={window === value} onClick={() => setWindow(value)}>
            {t(key)}
          </Button>
        ))}
        {window === "custom" && (
          <Input type="date" className="w-auto" aria-label={t("tasks.mapPickDay")}
            value={pickedDay} onChange={(event) => setPickedDay(event.target.value)} />
        )}
      </div>
      <MapDayContent state={state} day={window === "all" ? undefined : selectedDay} />
    </div>
  );
}

function MapDayContent({ state, day }: { state: TaskPageState; day: string | undefined }) {
  const t = useT();
  const pickedDay = day ? dayFromKey(day) : null;
  const range = pickedDay ? windowInstants(pickedDay, pickedDay, browserTimezone() ?? "UTC") : null;
  const filters = {
    ...toTaskFilters(state),
    status: "open" as const,
    assigned_user_id: state.assignee,
    ...(range ? { due_after: range.after, due_before: range.before, due_on_after: day, due_on_before: day } : {}),
    has_location: true,
    has_attachments: undefined,
    has_references: undefined,
  };
  // Drain every page so all located tasks are plotted, not just the first one.
  const query = useAllTasks(filters);
  const tasks = flattenPages(query.data).filter((task) => day === undefined || taskMapDay(task) === day);
  // A task without the location filter distinguishes an empty list from an empty map.
  const noneLocated = query.isSuccess && !query.isPlaceholderData && tasks.length === 0;
  const unlocatedQuery = useTasks(
    { ...filters, has_location: undefined, limit: 1 },
    { enabled: noneLocated },
  );
  const anyUnlocated = flattenPages(unlocatedQuery.data).some((task) => day === undefined || taskMapDay(task) === day);

  const [nearMe, setNearMe] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const { located, missing } = useMemo(() => partitionLocated(tasks), [tasks]);
  const status = <ResultsStatus query={state.q} count={query.isPlaceholderData ? null : located.length} />;

  const requestNearMe = () => {
    if (!("geolocation" in navigator)) {
      setGeoError(t("tasks.mapGeoUnsupported"));
      return;
    }
    setLocating(true);
    setGeoError(null);
    // Prompted only on tap (D25) — never a silent permission ambush.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNearMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setGeoError(t("tasks.mapGeoFailed"));
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  };

  if (query.isPending) {
    return (
      <div className="h-[520px] overflow-hidden rounded-xl border border-border">
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="px-1 py-8">
        <LoadError
          message={t("tasks.mapLoadFailed")}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  if (tasks.length === 0) {
    if (unlocatedQuery.isPending) {
      return (
        <div className="h-[320px] overflow-hidden rounded-xl border border-border">
          <Skeleton className="h-full w-full" />
        </div>
      );
    }
    return (
      <>
        {status}
        {anyUnlocated ? (
          <UnmappedTasks />
        ) : (
          <div className="space-y-3">
            <EmptyTasks state={state} />
          </div>
        )}
      </>
    );
  }

  return (
    <div className="space-y-3">
      {status}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <MapPin className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span className="tabular-nums">{located.length}</span> {t("tasks.mapOnTheMap")}
          {missing > 0 && (
            <span className="text-muted-foreground/80">
              · <span className="tabular-nums">{missing}</span> {t("tasks.mapWithoutLocation")}
            </span>
          )}
        </p>
        <Button variant="outline" size="sm" onClick={requestNearMe} disabled={locating}>
          <Navigation className="size-3.5" strokeWidth={1.75} aria-hidden />
          {locating ? t("tasks.mapLocating") : t("tasks.mapNearMe")}
        </Button>
      </div>
      {geoError && (
        <p role="alert" className="text-[13px] text-warning">
          {geoError}
        </p>
      )}
      {located.length === 0 ? (
        <UnmappedTasks count={missing} />
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {t("tasks.mapAddressLookupPaused")}
          </p>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_16rem]">
            <MapIsland tasks={located} nearMe={nearMe} />
            <MapStops stops={located} />
          </div>
        </>
      )}
    </div>
  );
}

function MapStops({ stops }: { stops: LocatedTask[] }) {
  const t = useT();
  const { hrefForTask } = useTaskDrawer();
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <Button asChild size="sm">
        <a href={mapsRouteHref(stops)} target="_blank" rel="noopener noreferrer">
          {t("tasks.mapOpenRoute")}
        </a>
      </Button>
      {stops.length > 9 && <p className="text-xs text-muted-foreground">{t("tasks.mapRouteLimit")}</p>}
      <ol aria-label={t("tasks.mapStops")} className="max-h-96 list-decimal space-y-2 overflow-y-auto pl-6 text-sm">
        {stops.map((task) => (
          <li key={task.id}>
            <Link href={hrefForTask(task.id)} scroll={false} className="hover:text-primary">
              {task.title}{task.confirmed_at ? ` · ${t("tasks.mapConfirmed")}` : ""}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

function UnmappedTasks({ count }: { count?: number }) {
  const t = useT();
  const counted =
    count === undefined
      ? ""
      : `${t(count === 1 ? "tasks.mapUnlocatedOne" : "tasks.mapUnlocatedMany", { count })} `;
  return (
    <div className="flex h-[320px] items-center justify-center rounded-xl border border-border bg-secondary/20">
      <EmptyState
        size="panel"
        icon={<MapPin strokeWidth={1.75} />}
        title={t("tasks.mapNoMappedAddress")}
        description={`${counted}${t("tasks.mapAddressLookupPaused")}`}
      />
    </div>
  );
}

/** Split the fetched tasks into ones with usable coordinates and a missing count. */
function partitionLocated(tasks: Task[]): { located: LocatedTask[]; missing: number } {
  const located: LocatedTask[] = [];
  let missing = 0;
  for (const task of tasks.toSorted(compareMapStops)) {
    const coords = taskCoords(task);
    if (coords) located.push({ ...task, lat: coords.lat, lng: coords.lng, contactName: coords.name, stop: located.length + 1 });
    else missing += 1;
  }
  return { located, missing };
}
