"use client";

import {
  Monitor,
  MonitorSmartphone,
  Smartphone,
  Tablet,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { SessionClient } from "@/lib/api/sessions";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/format/time";
import { cn } from "@/lib/utils";

/**
 * #236 — one signed-in device, in the shape somebody scans a security list in.
 *
 * The whole job of this row is RECOGNITION: the person reads down the list
 * looking for the one that is not theirs. So the two facts that make a device
 * recognisable — which app, and roughly where — are the headline, and
 * everything else (the exact sign-in time, the user agent) is subordinate.
 *
 * The user agent is deliberately not in the primary line even though we have
 * it. "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)…" tells a plumber
 * nothing and pushes the fact that DOES ("Toronto") off the end of the row.
 */

const CLIENT_ICON: Record<SessionClient, LucideIcon> = {
  web: Monitor,
  android: Smartphone,
  ios: Tablet,
  unknown: MonitorSmartphone,
};

const CLIENT_LABEL: Record<SessionClient, string> = {
  web: "Web browser",
  android: "Android app",
  ios: "iPhone or iPad",
  unknown: "Unrecognised device",
};

export function deviceLabel(client: SessionClient): string {
  return CLIENT_LABEL[client] ?? CLIENT_LABEL.unknown;
}

export function DeviceRow({
  client,
  location,
  signedInAt,
  lastActiveAt,
  userAgent,
  current = false,
  secondary,
  action,
}: {
  client: SessionClient;
  location: string | null;
  signedInAt: string;
  lastActiveAt: string;
  userAgent?: string | null;
  current?: boolean;
  /** Overrides the location line — the workspace view names the member here. */
  secondary?: string;
  action?: React.ReactNode;
}) {
  const Icon = CLIENT_ICON[client] ?? CLIENT_ICON.unknown;
  return (
    <div className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
      <Icon
        className={cn(
          "mt-0.5 size-5 shrink-0",
          current ? "text-primary" : "text-muted-foreground",
        )}
        strokeWidth={1.75}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{deviceLabel(client)}</span>
          {current && (
            // The one row nobody should worry about, said before they read
            // any further.
            <Badge variant="secondary" className="font-normal">
              This device
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {secondary ?? location ?? "Location not available"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <span title={formatAbsoluteDateTime(lastActiveAt)}>
            Last active {formatRelativeTime(lastActiveAt)}
          </span>
          {" · "}
          <span title={formatAbsoluteDateTime(signedInAt)}>
            signed in {formatRelativeTime(signedInAt)}
          </span>
        </p>
        {userAgent && (
          // Kept, but at the bottom of the visual hierarchy: it is the thing
          // that settles an argument, not the thing that starts one.
          <p className="mt-1 truncate text-xs text-muted-foreground/70">
            {userAgent}
          </p>
        )}
      </div>
      {action && <div className="shrink-0 pl-2">{action}</div>}
    </div>
  );
}
