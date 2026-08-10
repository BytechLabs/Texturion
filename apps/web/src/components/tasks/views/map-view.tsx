"use client";

import { MapPin, Navigation } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/settings/section";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";
import { useGeocodeProgress, useAllTasks } from "@/lib/api/tasks";
import { flattenPages } from "@/lib/api/pagination";
import type { Task } from "@/lib/api/types";

import { EmptyTasks } from "../task-empty";
import type { TaskPageState } from "../task-view-url";
import { toTaskFilters } from "../task-view-url";
import { taskCoords, type LocatedTask } from "./map-types";

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

/**
 * The Map view (D25) — the field-service differentiator: the day's jobs on a
 * map. Tasks are plotted at their conversation→contact address (geocoded once,
 * cached on the contact — HOME-AND-VIEWS "Map view technology"). Tasks whose
 * contact has no geocodable location simply don't appear; they're surfaced as a
 * quiet "N without a location" count instead of blocking the view.
 */
export function MapView({ state }: { state: TaskPageState }) {
  const t = useT();
  // `has_location=true` narrows to tasks whose contact has cached coords (the
  // frozen route uses the geocode to filter; `taskCoords` plots whatever
  // coordinates the row actually carries and counts the rest as unlocated).
  const filters = { ...toTaskFilters(state), status: undefined, has_location: true };
  // Drain every page so all located tasks are plotted, not just the first 25.
  const query = useAllTasks(filters);
  const tasks = flattenPages(query.data);

  const [nearMe, setNearMe] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const { located, missing } = useMemo(() => partitionLocated(tasks), [tasks]);
  // #440: the backfill's outstanding count, so an in-progress Map says so.
  const geocodeProgress = useGeocodeProgress();
  const pendingGeocodes = geocodeProgress.data?.contacts_pending ?? 0;

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
    return (
      <div className="space-y-3">
        <EmptyTasks state={state} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
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
        {/* #440: the sentence that turns "broken" into "busy". A switcher who has
            just imported 2,000 contacts opens this view before the hourly, 1-req/s
            backfill has finished, and an empty Map with nothing saying why reads as
            a feature that does not work. Shown only while work is outstanding. */}
        {pendingGeocodes > 0 && (
          <p
            role="status"
            className="basis-full text-[13px] leading-relaxed text-muted-foreground"
          >
            {t("tasks.mapStillLocating")}{" "}
            <span className="tabular-nums">{pendingGeocodes}</span>{" "}
            {pendingGeocodes === 1
              ? t("tasks.mapAddressOne")
              : t("tasks.mapAddressMany")}
            . {t("tasks.mapGeocodeBacklogNote")}
          </p>
        )}
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
        <div className="flex h-[320px] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-secondary/20 text-center">
          <MapPin className="size-6 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          <p className="max-w-xs text-[13px] text-muted-foreground">
            {t("tasks.mapNoMappedAddress")}
          </p>
        </div>
      ) : (
        <MapIsland tasks={located} nearMe={nearMe} />
      )}
    </div>
  );
}

/** Split the fetched tasks into ones with usable coordinates and a missing count. */
function partitionLocated(tasks: Task[]): { located: LocatedTask[]; missing: number } {
  const located: LocatedTask[] = [];
  let missing = 0;
  for (const task of tasks) {
    const coords = taskCoords(task);
    if (coords) located.push({ ...task, lat: coords.lat, lng: coords.lng, contactName: coords.name });
    else missing += 1;
  }
  return { located, missing };
}
