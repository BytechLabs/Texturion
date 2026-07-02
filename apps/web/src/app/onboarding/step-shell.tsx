"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

import { ProgressDots } from "./progress-dots";

/**
 * One-question-per-screen frame (G7): back always available, progress dots,
 * big friendly heading, content below. Also exports the shared loading and
 * error states so every step handles them identically (G11: every state
 * designed; G1: no spinners without words).
 */
export function StepShell({
  backHref,
  index,
  total,
  title,
  subtitle,
  children,
}: {
  /** Previous step; omit on the first screen. */
  backHref?: string;
  index: number;
  total: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-8">
      <div className="flex min-h-9 items-center justify-between">
        {backHref ? (
          <Link
            href={backHref}
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden />
            Back
          </Link>
        ) : (
          <span />
        )}
        <ProgressDots index={index} total={total} />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Named skeleton while resume state loads (never a bare spinner — G1). */
export function StepLoading() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div className="flex items-center justify-end">
        <Skeleton className="h-2 w-24" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
      <p className="text-sm text-muted-foreground">Picking up where you left off…</p>
    </div>
  );
}

/** Shared retryable error state (G10: what happened + what to do). */
export function StepError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load your setup progress. Check your connection and
        try again.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
