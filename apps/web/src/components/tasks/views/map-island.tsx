"use client";

// Leaflet's stylesheet is imported HERE (inside the lazily-loaded island) so it
// travels with the island chunk, never the main bundle. The container div gets
// an explicit height — Leaflet requires a sized parent or the map is 0px tall.
import "leaflet/dist/leaflet.css";

import L from "leaflet";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";

import { taskThreadHref } from "../task-format";
import type { LocatedTask } from "./map-types";

/**
 * The Leaflet map island (D25 "Map view technology"): Leaflet + OpenStreetMap
 * RASTER tiles — no API key, free, self-attributed. No Google/Mapbox. This
 * module is only ever imported via `next/dynamic({ ssr:false })` from map-view,
 * so it (and the whole leaflet stack + its CSS) is a separate chunk fetched on
 * demand, never in the initial/route bundle.
 *
 * Pins come from the task→conversation→contact coordinates. Dense areas are
 * clustered (a lightweight grid clusterer — no extra plugin dep); a pin/cluster
 * click opens a peek popup that deep-links to the task's message + conversation.
 * "Near me" (from map-view's optional geolocation) drops a distinct marker and
 * recenters.
 */

/** A petrol teardrop pin (divIcon — no external marker-image asset to 404 on). */
const taskIcon = L.divIcon({
  className: "",
  html:
    '<span style="display:block;width:18px;height:18px;border-radius:50% 50% 50% 0;' +
    "background:#0f766e;transform:rotate(-45deg);border:2px solid #fff;" +
    'box-shadow:0 1px 3px rgba(41,37,36,.35)"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 18],
  popupAnchor: [0, -16],
});

/** A "you are here" marker for the near-me point (amber, visually distinct). */
const meIcon = L.divIcon({
  className: "",
  html:
    '<span style="display:block;width:16px;height:16px;border-radius:50%;' +
    'background:#d97706;border:3px solid #fff;box-shadow:0 1px 3px rgba(41,37,36,.4)"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

/** A round cluster badge scaled by count. */
function clusterIcon(count: number): L.DivIcon {
  const size = count < 10 ? 30 : count < 50 ? 38 : 46;
  return L.divIcon({
    className: "",
    html:
      `<span style="display:flex;align-items:center;justify-content:center;` +
      `width:${size}px;height:${size}px;border-radius:50%;background:rgba(15,118,110,.9);` +
      `color:#fff;font:600 12px/1 Inter,system-ui,sans-serif;border:2px solid #fff;` +
      `box-shadow:0 1px 4px rgba(41,37,36,.35)">${count}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

interface Cluster {
  key: string;
  lat: number;
  lng: number;
  tasks: LocatedTask[];
}

/**
 * Grid-cluster the located tasks at the current zoom. Cell size shrinks as you
 * zoom in, so pins split apart the closer you look — the standard cheap
 * clusterer, no plugin. Tasks sharing a cell collapse to one badge.
 */
function clusterTasks(tasks: LocatedTask[], zoom: number): Cluster[] {
  // Degrees-per-cell: coarse when zoomed out, fine when zoomed in.
  const cell = 360 / 2 ** Math.min(zoom + 3, 20);
  const buckets = new Map<string, Cluster>();
  for (const task of tasks) {
    const gx = Math.floor(task.lng / cell);
    const gy = Math.floor(task.lat / cell);
    const key = `${gx}:${gy}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.tasks.push(task);
      // Running centroid keeps the badge near its members.
      bucket.lat += (task.lat - bucket.lat) / bucket.tasks.length;
      bucket.lng += (task.lng - bucket.lng) / bucket.tasks.length;
    } else {
      buckets.set(key, { key, lat: task.lat, lng: task.lng, tasks: [task] });
    }
  }
  return [...buckets.values()];
}

export function MapIsland({
  tasks,
  nearMe,
}: {
  tasks: LocatedTask[];
  nearMe: { lat: number; lng: number } | null;
}) {
  // Fit the initial view to all pins; a single pin gets a sensible zoom.
  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    if (tasks.length === 0) return null;
    return tasks.map((t) => [t.lat, t.lng] as [number, number]);
  }, [tasks]);

  const center = useMemo<[number, number]>(() => {
    if (tasks.length > 0) return [tasks[0].lat, tasks[0].lng];
    return [39.5, -98.35]; // Continental US fallback (never reached — guarded).
  }, [tasks]);

  return (
    <div className="h-[520px] overflow-hidden rounded-xl border border-border">
      <MapContainer
        center={center}
        zoom={tasks.length === 1 ? 13 : 5}
        scrollWheelZoom
        className="h-full w-full"
        style={{ background: "var(--muted)" }}
      >
        <TileLayer
          // OSM raster tiles — free, no key; attribution is required by policy.
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />
        <FitBounds bounds={bounds} nearMe={nearMe} />
        <Clusters tasks={tasks} />
        {nearMe && (
          <Marker position={[nearMe.lat, nearMe.lng]} icon={meIcon}>
            <Popup>You are here</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}

/** Recenter to the pins on first render, and to "near me" when it arrives. */
function FitBounds({
  bounds,
  nearMe,
}: {
  bounds: L.LatLngBoundsExpression | null;
  nearMe: { lat: number; lng: number } | null;
}) {
  const map = useMap();
  // A CONTENT key for the pin set. `bounds` is memoized but keyed on `tasks`,
  // which flattenPages() returns as a fresh array every render, so depending on
  // `bounds` refit on EVERY render — discarding the user's pan/zoom. Keying on
  // the actual coordinates refits only when the pins genuinely change.
  const boundsKey = Array.isArray(bounds)
    ? (bounds as [number, number][])
        .map(([lat, lng]) => `${lat},${lng}`)
        .sort()
        .join("|")
    : "";
  useEffect(() => {
    if (bounds && Array.isArray(bounds) && bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
    // Fit only when the pin CONTENT changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey]);
  useEffect(() => {
    if (nearMe) map.setView([nearMe.lat, nearMe.lng], 12);
  }, [nearMe, map]);
  return null;
}

/** Re-cluster on zoom and render one marker per cluster with a peek popup. */
function Clusters({ tasks }: { tasks: LocatedTask[] }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoomend", onZoom);
    return () => {
      map.off("zoomend", onZoom);
    };
  }, [map]);

  const clusters = useMemo(() => clusterTasks(tasks, zoom), [tasks, zoom]);

  return (
    <>
      {clusters.map((cluster) =>
        cluster.tasks.length === 1 ? (
          <Marker
            key={cluster.key}
            position={[cluster.lat, cluster.lng]}
            icon={taskIcon}
          >
            <Popup>
              <TaskPeek task={cluster.tasks[0]} />
            </Popup>
          </Marker>
        ) : (
          <Marker
            key={cluster.key}
            position={[cluster.lat, cluster.lng]}
            icon={clusterIcon(cluster.tasks.length)}
            eventHandlers={{
              click: () => map.setView([cluster.lat, cluster.lng], map.getZoom() + 2),
            }}
          >
            <Popup>
              <ClusterPeek tasks={cluster.tasks} />
            </Popup>
          </Marker>
        ),
      )}
    </>
  );
}

/** The single-pin peek card → the task's source message + conversation. */
function TaskPeek({ task }: { task: LocatedTask }) {
  return (
    <div className="min-w-[180px] space-y-1">
      <p className="text-[13px] font-medium text-foreground">{task.title}</p>
      {task.contactName && (
        <p className="text-[12px] text-muted-foreground">{task.contactName}</p>
      )}
      <Link
        href={taskThreadHref(task)}
        className="text-[12px] font-medium text-primary hover:underline"
      >
        Open task
      </Link>
    </div>
  );
}

/** The cluster peek card — a short list of the tasks stacked at this point. */
function ClusterPeek({ tasks }: { tasks: LocatedTask[] }) {
  return (
    <div className="min-w-[200px] space-y-1.5">
      <p className="text-[12px] font-semibold text-foreground">
        {tasks.length} tasks here
      </p>
      <ul className="space-y-1">
        {tasks.slice(0, 6).map((task) => (
          <li key={task.id}>
            <Link
              href={taskThreadHref(task)}
              className="block truncate text-[12px] text-foreground hover:text-primary"
            >
              {task.title}
            </Link>
          </li>
        ))}
        {tasks.length > 6 && (
          <li className="text-[12px] text-muted-foreground">
            +{tasks.length - 6} more, zoom in
          </li>
        )}
      </ul>
    </div>
  );
}
