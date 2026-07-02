"use client";

import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { useUsage } from "@/lib/api/usage";
import { cn } from "@/lib/utils";

/**
 * Sidebar usage mini-meter (G3), fed by GET /v1/usage: petrol fill turning
 * amber at 80% of the included quota (G8). Copy says "messages" with the
 * segment count carried by the tooltip on /settings/usage (SPEC §2 copy rule).
 */
export function UsageMeter({ compact = false }: { compact?: boolean }) {
  const usage = useUsage();

  if (usage.isPending) {
    return (
      <div className="px-3 py-2" aria-hidden>
        <Skeleton className="h-1.5 w-full rounded-full" />
        {!compact && <Skeleton className="mt-1.5 h-3 w-24" />}
      </div>
    );
  }
  if (usage.isError || !usage.data || usage.data.period_start === null) {
    // No billing period yet (mid-onboarding) — nothing to meter.
    return null;
  }

  const { used_segments, included_segments } = usage.data;
  const ratio =
    included_segments > 0 ? used_segments / included_segments : 0;
  const percent = Math.min(100, Math.round(ratio * 100));
  const warning = ratio >= 0.8;

  const meter = (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={included_segments}
      aria-valuenow={Math.min(used_segments, included_segments)}
      aria-label={`${used_segments} of ${included_segments} included messages used`}
      className="h-1.5 w-full overflow-hidden rounded-full bg-border"
    >
      <div
        className={cn(
          "h-full rounded-full transition-all duration-200 ease-out",
          warning ? "bg-warning" : "bg-primary",
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );

  if (compact) {
    return (
      <Link
        href="/settings/usage"
        className="block rounded-md px-2 py-2 hover:bg-sidebar-accent"
        title={`${used_segments} of ${included_segments} messages`}
      >
        {meter}
      </Link>
    );
  }

  return (
    <Link
      href="/settings/usage"
      className="block rounded-md px-3 py-2 hover:bg-sidebar-accent"
    >
      {meter}
      <p className="mt-1.5 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {used_segments.toLocaleString()} of{" "}
          {included_segments.toLocaleString()}
        </span>{" "}
        messages
      </p>
    </Link>
  );
}
