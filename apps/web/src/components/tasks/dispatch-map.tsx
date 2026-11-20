"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";

import { publicEnv } from "@/env";
import { useT } from "@/i18n/provider";
import { readBasemap } from "@/lib/maps/basemap";

interface RoutePoint { id: string; lat: number; lng: number; title: string; stop: number }

const BASEMAP = readBasemap(publicEnv);

function RouteBounds({ points }: { points: RoutePoint[] }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(points.map(({ lat, lng }) => [lat, lng]), { padding: [24, 24], maxZoom: 15 });
  }, [map, points]);
  return null;
}

export function DispatchMap({ points }: { points: RoutePoint[] }) {
  const t = useT();
  return (
    <section aria-label={t("tasks.viewMap")} className="overflow-hidden rounded-xl border">
      <MapContainer className="h-80 bg-muted" scrollWheelZoom={false} bounds={points.map(({ lat, lng }) => [lat, lng])}>
        {BASEMAP && <TileLayer url={BASEMAP.url} attribution={BASEMAP.attribution} maxZoom={BASEMAP.maxZoom} />}
        <RouteBounds points={points} />
        <Polyline positions={points.map(({ lat, lng }): L.LatLngTuple => [lat, lng])} pathOptions={{ color: "var(--app-olive-accent)", dashArray: "4 6" }} />
        {points.map((point) => (
          <Marker key={point.id} position={[point.lat, point.lng]} title={point.title} icon={L.divIcon({
            className: "",
            html: `<span class="grid size-7 place-items-center rounded-full border bg-primary font-semibold text-primary-foreground">${point.stop}</span>`,
            iconSize: [28, 28], iconAnchor: [14, 14],
          })}><Popup>{point.title}</Popup></Marker>
        ))}
      </MapContainer>
    </section>
  );
}
