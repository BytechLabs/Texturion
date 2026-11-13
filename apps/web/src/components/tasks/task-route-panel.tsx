"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { useT } from "@/i18n/provider";
import { keys } from "@/lib/api/keys";
import { useCompanyId } from "@/lib/company/provider";

import { TaskDetailPanel } from "./task-detail-panel";

/**
 * The /tasks/[id] page body (TASKS-V2 D-A) — the same TaskDetailPanel the drawer
 * renders, framed as a standalone elevated card for a hard refresh / shared
 * link. On delete the panel calls onClose; here that navigates back to /tasks.
 */
export function TaskRoutePanel({ taskId }: { taskId: string }) {
  return (
    <TaskRouteFrame>
      <TaskDetailPanelHost taskId={taskId} />
    </TaskRouteFrame>
  );
}

/** The page's card and its way back, shared with the route's loading state. */
export function TaskRouteFrame({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <Link
        href="/tasks"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-app-muted transition-colors hover:text-app-ink"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden />
        {t("tasks.backToTasks")}
      </Link>
      <div className="overflow-hidden rounded-app-card border border-app-line bg-app-paper">
        <div className="h-[calc(100svh-11rem)] min-h-[420px]">{children}</div>
      </div>
    </div>
  );
}

/** Wraps the panel with a client-side "back to /tasks" close. */
function TaskDetailPanelHost({ taskId }: { taskId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const companyId = useCompanyId();
  const deleted = useRef(false);
  useEffect(
    () => () => {
      // Dropped once the page is gone, so nothing still on screen refetches it,
      // and a later visit cannot paint the deleted task from cache.
      if (deleted.current) {
        queryClient.removeQueries({ queryKey: keys.tasks.detail(companyId, taskId) });
      }
    },
    [queryClient, companyId, taskId],
  );
  return (
    <TaskDetailPanel
      taskId={taskId}
      onClose={() => {
        deleted.current = true;
        router.replace("/tasks");
      }}
    />
  );
}
